"use server";

/** Bulk lead upload — validate a workbook, then grind through it in chunks.
 *
 *  Nothing here re-implements what a lead is. Rows are written through the same
 *  server actions the UI uses (`createLead`, `updateLead`, `changeStage`,
 *  `assignOwner`, `createCompany`, `logActivity`), so scoring, stage history,
 *  notifications and RLS all behave exactly as they do for a hand-typed lead.
 *  What this file adds is the bookkeeping around them: validation, the
 *  create-vs-update decision, batching, claiming, and an auditable outcome per row.
 *
 *  The uploaded file is never stored. Each row's sanitized values live in
 *  `lead_import_rows.payload`, which is what makes resume, retry and the error
 *  report possible without a storage bucket to secure.
 */

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin";
import { isManagerUp } from "../permissions";
import { loosely } from "../import/normalize";
import { ACCEPTED_EXTENSIONS, CHUNK_SIZE, MAX_FILE_BYTES } from "../import/schema";
import { parseWorkbook, WorkbookError } from "../import/workbook";
import { planRows, rowKeysOf, type ExistingLead, type ValidationContext } from "../import/validate";
import type {
  ChunkProgress,
  ImportBatch,
  ImportFieldId,
  ImportRowRecord,
  PlannedRow,
  ValidationPreview,
} from "../import/types";
import { createCompany } from "./accounts";
import { logActivity } from "./activities";
import { assignOwner, changeStage, createLead, updateLead } from "./leads";
import { currentActor, fail, loadStages, ok, type ActionResult } from "./shared";

/** Lead columns the importer reads back for the "did anything change?" test. */
const LEAD_COLUMNS =
  "id,name,email,phone,whatsapp,linkedin,title,company_id,source,status,owner_id,next_action,next_action_date,expected_value,close_date,priority";

/** A claim older than this belonged to a request that never came back. */
const STALE_CLAIM_MS = 5 * 60_000;

function revalidateImportViews(): void {
  revalidatePath("/leads/import");
  revalidatePath("/leads");
  revalidatePath("/");
}

/* ------------------------------------------------------------------- upload */

export async function prepareImport(formData: FormData): Promise<ActionResult<ValidationPreview>> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile?.is_active) return fail("Your account is not active, so it cannot import leads.");

  /* ------------------------------------------------------------ the file */
  const file = formData.get("file");
  if (!(file instanceof File)) return fail("No file was uploaded.");
  if (file.size === 0) return fail("That file is empty.");
  if (file.size > MAX_FILE_BYTES) {
    return fail(
      `That file is ${(file.size / 1_048_576).toFixed(1)} MB. The limit is ${MAX_FILE_BYTES / 1_048_576} MB — split it into smaller files.`,
    );
  }
  const name = file.name ?? "upload.xlsx";
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))) {
    return fail("Only .xlsx files are accepted. Download the template and fill that in.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(buffer).digest("hex");

  let parsed;
  try {
    parsed = await parseWorkbook(buffer);
  } catch (error) {
    if (error instanceof WorkbookError) return fail(error.message);
    return fail("The file could not be read. Re-save it as .xlsx and try again.");
  }

  if (parsed.duplicateColumns.length) {
    return fail(
      `These columns appear more than once: ${parsed.duplicateColumns.join(", ")}. Remove the extra copies so it is clear which one to read.`,
    );
  }
  if (parsed.missingColumns.length) {
    return fail(
      `The sheet is missing ${parsed.missingColumns.length} column${parsed.missingColumns.length === 1 ? "" : "s"}: ${parsed.missingColumns.join(", ")}. Download the template again — the header row must stay intact.`,
    );
  }
  if (parsed.empty) {
    return fail(
      parsed.blankRows > 0
        ? "Every row in the sheet is empty. Fill in at least one lead before uploading."
        : "The sheet has a header but no rows.",
    );
  }
  /* --------------------------------------------------- the decision context */
  const context = await buildContext(supabase, userId, isManagerUp(profile), rowKeysOf(parsed.rows));
  const planned = planRows(parsed.rows, context);

  const counts = tally(planned);

  /* -------------------------------------------------------- the audit rows */
  const previous = await findEarlierUpload(supabase, fileHash, userId, profile.full_name ?? profile.email);

  const { data: batch, error: batchError } = await supabase
    .from("lead_import_batches")
    .insert({
      created_by: userId,
      file_name: name.slice(0, 200),
      file_size: file.size,
      file_hash: fileHash,
      total_rows: planned.length,
      valid_rows: counts.creates + counts.updates,
      processed_count: counts.skips + counts.invalid,
      skipped_count: counts.skips,
      invalid_count: counts.invalid,
      status: "pending",
    })
    .select("id")
    .maybeSingle();

  if (batchError || !batch) {
    return fail(batchError?.message ?? "Could not start the upload. Has the import migration been applied?");
  }
  const batchId = batch.id as string;

  const records = planned.map((row) => ({
    batch_id: batchId,
    created_by: userId,
    row_number: row.rowNumber,
    row_key: row.rowKey,
    payload: row.values,
    identifier: row.identifier.slice(0, 200),
    status: row.status,
    action: row.action,
    // an update row carries its target from here on: processing never re-matches,
    // so the row cannot drift onto a different lead between preview and write
    lead_id: row.leadId,
    error: firstMessage(row),
    error_field: row.issues[0]?.field ?? null,
    hint: row.issues[0]?.hint ?? row.warnings[0]?.hint ?? null,
    processed_at: row.status === "pending" ? null : new Date().toISOString(),
  }));

  for (let i = 0; i < records.length; i += 500) {
    const { error } = await supabase.from("lead_import_rows").insert(records.slice(i, i + 500));
    if (error) {
      await supabase
        .from("lead_import_batches")
        .update({ status: "failed", error: error.message, completed_at: new Date().toISOString() })
        .eq("id", batchId);
      return fail(`Could not record the upload: ${error.message}`);
    }
  }

  revalidateImportViews();

  return ok({
    batchId,
    fileName: name,
    fileSize: file.size,
    totalRows: planned.length,
    validRows: counts.creates + counts.updates,
    creates: counts.creates,
    updates: counts.updates,
    skips: counts.skips,
    invalid: counts.invalid,
    blankRows: parsed.blankRows,
    extraColumns: parsed.extraColumns,
    duplicateOf: previous,
    problems: planned
      .filter((row) => row.status === "invalid" || row.status === "skipped")
      .slice(0, 200)
      .map((row) => ({
        rowNumber: row.rowNumber,
        identifier: row.identifier,
        status: row.status,
        action: row.action,
        message: firstMessage(row) ?? "Rejected",
        field: row.issues[0]?.field ?? null,
        hint: row.issues[0]?.hint ?? null,
      })),
  });
}

function firstMessage(row: PlannedRow): string | null {
  const all = [...row.issues, ...row.warnings];
  if (!all.length) return null;
  return all.map((i) => i.message).join(" · ").slice(0, 500);
}

function tally(rows: PlannedRow[]) {
  let creates = 0;
  let updates = 0;
  let skips = 0;
  let invalid = 0;
  for (const row of rows) {
    if (row.status === "invalid") invalid += 1;
    else if (row.status === "skipped") skips += 1;
    else if (row.action === "create") creates += 1;
    else if (row.action === "update") updates += 1;
  }
  return { creates, updates, skips, invalid };
}

/** The same bytes, uploaded before, by this user. Reported so a double upload is
 *  an informed choice rather than a surprise. */
async function findEarlierUpload(
  supabase: SupabaseClient,
  fileHash: string,
  userId: string,
  by: string | null,
): Promise<ValidationPreview["duplicateOf"]> {
  const { data } = await supabase
    .from("lead_import_batches")
    .select("id,file_name,created_at")
    .eq("file_hash", fileHash)
    .eq("created_by", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    fileName: data.file_name as string,
    createdAt: data.created_at as string,
    by,
  };
}

/* ------------------------------------------------------------------ context */

async function buildContext(
  supabase: SupabaseClient,
  userId: string,
  canAssignOthers: boolean,
  rowKeys: string[],
): Promise<ValidationContext> {
  const [stages, companies, profiles, leads] = await Promise.all([
    loadStages(supabase),
    supabase.from("companies").select("id,name").limit(20_000),
    supabase.from("profiles").select("id,email,is_active").limit(5_000),
    supabase.from("leads").select(LEAD_COLUMNS).limit(50_000),
  ]);

  const companiesByName = new Map<string, string>();
  for (const row of (companies.data ?? []) as { id: string; name: string }[]) {
    const key = loosely(row.name ?? "");
    if (key && !companiesByName.has(key)) companiesByName.set(key, row.id);
  }

  const ownersByEmail = new Map<string, { id: string }>();
  for (const row of (profiles.data ?? []) as { id: string; email: string | null; is_active: boolean }[]) {
    if (row.is_active && row.email) ownersByEmail.set(row.email.toLowerCase(), { id: row.id });
  }

  const leadsById = new Map<string, ExistingLead>();
  const leadsByEmail = new Map<string, ExistingLead>();
  const visibleEmails = new Set<string>();
  for (const lead of (leads.data ?? []) as ExistingLead[]) {
    leadsById.set(lead.id, lead);
    const email = lead.email?.trim().toLowerCase();
    if (email) {
      visibleEmails.add(email);
      // first one wins, the same rule convertSignup follows
      if (!leadsByEmail.has(email)) leadsByEmail.set(email, lead);
    }
  }

  return {
    stages: stages.map((s) => ({
      key: s.key,
      label: s.label,
      category: s.category,
      isActive: s.is_active,
    })),
    companiesByName,
    ownersByEmail,
    leadsById,
    leadsByEmail,
    importedKeys: await loadImportedKeys(supabase, userId, rowKeys),
    invisibleEmails: await loadInvisibleEmails(visibleEmails),
    me: { id: userId },
    canAssignOthers,
  };
}

/** Business keys this user has already turned into a lead. Looked up only for the
 *  keys in this file, so the table can grow without slowing an upload down. */
async function loadImportedKeys(
  supabase: SupabaseClient,
  userId: string,
  rowKeys: string[],
): Promise<Map<string, { leadId: string; batchId: string }>> {
  const found = new Map<string, { leadId: string; batchId: string }>();
  const keys = [...new Set(rowKeys)];

  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await supabase
      .from("lead_import_rows")
      .select("row_key,lead_id,batch_id")
      .eq("created_by", userId)
      .not("lead_id", "is", null)
      .in("status", ["created", "updated"])
      .in("row_key", keys.slice(i, i + 200));

    for (const row of (data ?? []) as { row_key: string; lead_id: string; batch_id: string }[]) {
      if (!found.has(row.row_key)) found.set(row.row_key, { leadId: row.lead_id, batchId: row.batch_id });
    }
  }
  return found;
}

/** Emails that already sit on a lead somewhere in the CRM but not in this user's
 *  slice of it. Read with the service key on purpose: without it a rep would
 *  quietly create a second lead on an address a colleague already owns.
 *
 *  Only membership ever leaves this function — never a name, an owner or an id —
 *  and only for addresses the user typed into their own spreadsheet. */
async function loadInvisibleEmails(visible: Set<string>): Promise<Set<string>> {
  const invisible = new Set<string>();
  const admin = createAdminClient();
  if (!admin) return invisible; // no service key configured: degrade, do not guess

  const { data, error } = await admin.from("leads").select("email").not("email", "is", null).limit(50_000);
  if (error || !data) return invisible;

  for (const row of data as { email: string | null }[]) {
    const email = row.email?.trim().toLowerCase();
    if (email && !visible.has(email)) invisible.add(email);
  }
  return invisible;
}

/* --------------------------------------------------------------- processing */

export async function processChunk(batchId: string): Promise<ActionResult<ChunkProgress>> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile?.is_active) return fail("Your account is not active.");

  const batch = await loadBatch(supabase, batchId);
  if (!batch) return fail("That upload could not be found.");
  if (batch.created_by !== userId && profile.role !== "admin") {
    return fail("Only the person who uploaded a file can process it.");
  }
  if (batch.status === "cancelled") return ok(progressOf(batch, false));
  if (batch.status === "completed" || batch.status === "partially_completed" || batch.status === "failed") {
    return ok(progressOf(batch, false));
  }

  const startedAt = batch.started_at ?? new Date().toISOString();
  if (batch.status !== "processing") {
    await supabase
      .from("lead_import_batches")
      .update({ status: "processing", started_at: startedAt })
      .eq("id", batchId);
  }

  // hand back rows a dead request is still holding
  await supabase
    .from("lead_import_rows")
    .update({ status: "pending", claimed_at: null })
    .eq("batch_id", batchId)
    .eq("status", "processing")
    .lt("claimed_at", new Date(Date.now() - STALE_CLAIM_MS).toISOString());

  const claimed = await claimRows(supabase, batchId);
  if (!claimed.length) {
    const finished = await recount(supabase, batchId, startedAt);
    revalidateImportViews();
    return ok(progressOf(finished, false));
  }

  const stageKeys = new Set((await loadStages(supabase)).map((s) => s.key));
  const companyCache = new Map<string, string>();

  for (const row of claimed) {
    const outcome = await processRow(supabase, row, { stageKeys, companyCache, canAssign: isManagerUp(profile) });
    await supabase
      .from("lead_import_rows")
      .update({
        status: outcome.status,
        // Only ever set, never cleared: a row that failed *after* its lead was
        // created keeps pointing at it, so the retry updates rather than doubles.
        ...(outcome.leadId ? { lead_id: outcome.leadId } : {}),
        error: outcome.error,
        error_field: outcome.field,
        hint: outcome.hint,
        processed_at: new Date().toISOString(),
        claimed_at: null,
      })
      .eq("id", row.id);
  }

  const updated = await recount(supabase, batchId, startedAt);
  const hasMore = updated.processed_count < updated.total_rows;
  // Revalidating costs a full re-render of the CRM shell, which loads every lead
  // for the ⌘K palette. Once per upload is right; once per chunk is not.
  if (!hasMore) revalidateImportViews();
  return ok(progressOf(updated, hasMore));
}

/** Takes ownership of the next slice of pending rows. The `status = pending`
 *  filter on the update is what makes a double-click harmless: whichever request
 *  gets there first is handed the rows, the other is handed none. */
async function claimRows(supabase: SupabaseClient, batchId: string): Promise<ImportRowRecord[]> {
  const { data: candidates } = await supabase
    .from("lead_import_rows")
    .select("id")
    .eq("batch_id", batchId)
    .eq("status", "pending")
    .order("row_number")
    .limit(CHUNK_SIZE);

  const ids = ((candidates ?? []) as { id: string }[]).map((r) => r.id);
  if (!ids.length) return [];

  const { data } = await supabase
    .from("lead_import_rows")
    .update({ status: "processing", claimed_at: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "pending")
    .select("*")
    .order("row_number");

  return (data ?? []) as unknown as ImportRowRecord[];
}

interface RowOutcome {
  status: "created" | "updated" | "failed";
  leadId: string | null;
  error: string | null;
  field: ImportFieldId | null;
  hint: string | null;
}

interface ProcessDeps {
  stageKeys: Set<string>;
  companyCache: Map<string, string>;
  canAssign: boolean;
}

/** One row, start to finish.
 *
 *  Idempotent by design: the lead id is written the moment it exists, so a retry
 *  after a mid-row failure updates that lead rather than creating a twin. */
async function processRow(
  supabase: SupabaseClient,
  record: ImportRowRecord,
  deps: ProcessDeps,
): Promise<RowOutcome> {
  const values = (record.payload ?? {}) as Partial<Record<ImportFieldId, string>>;

  try {
    const companyId = values.company
      ? await resolveCompany(supabase, values.company, deps.companyCache)
      : null;
    if (values.company && !companyId) {
      return failure("The company could not be created.", "company", "Create it under Companies first, then retry.");
    }

    let leadId = record.lead_id;
    let created = false;

    if (!leadId) {
      const form = new FormData();
      form.set("name", values.name ?? "");
      if (companyId) form.set("company_id", companyId);
      for (const field of ["title", "email", "phone", "whatsapp", "linkedin", "source", "next_action", "next_action_date", "expected_value", "close_date"] as const) {
        if (values[field]) form.set(field, values[field]!);
      }
      form.set("status", values.status ?? "New");
      if (values.owner_email) {
        const ownerId = await ownerIdFor(supabase, values.owner_email);
        if (ownerId) form.set("owner_id", ownerId);
      }

      const result = await createLead(form);
      if (!result.ok) return failure(result.error, null, null);
      leadId = result.data!.id;
      created = true;

      // Written before anything else touches the lead: if the request dies here,
      // the retry sees a lead id and updates instead of creating a second lead.
      await supabase.from("lead_import_rows").update({ lead_id: leadId }).eq("id", record.id);

      // createLead has no priority field — it is a plain column with no rules
      // attached, so it is set directly rather than through a second round-trip
      // of the whole form.
      if (values.priority) {
        await supabase.from("leads").update({ priority: values.priority }).eq("id", leadId);
      }
    } else {
      const { data: existing } = await supabase
        .from("leads")
        .select(LEAD_COLUMNS)
        .eq("id", leadId)
        .maybeSingle();
      if (!existing) {
        return failure(
          "That lead no longer exists, or it is no longer yours to edit.",
          "lead_id",
          "Clear the Lead ID to create a new lead instead.",
        );
      }
      const lead = existing as unknown as ExistingLead;

      // A blank cell means "leave it alone", so the update starts from what is
      // already stored and only the filled cells are laid over it.
      const form = new FormData();
      form.set("name", values.name ?? lead.name);
      form.set("title", values.title ?? lead.title ?? "");
      form.set("email", values.email ?? lead.email ?? "");
      form.set("phone", values.phone ?? lead.phone ?? "");
      form.set("whatsapp", values.whatsapp ?? lead.whatsapp ?? "");
      form.set("linkedin", values.linkedin ?? lead.linkedin ?? "");
      form.set("company_id", companyId ?? lead.company_id ?? "");
      form.set("source", values.source ?? lead.source ?? "");
      form.set("next_action", values.next_action ?? lead.next_action ?? "");
      form.set("next_action_date", values.next_action_date ?? lead.next_action_date ?? "");
      form.set(
        "expected_value",
        values.expected_value ?? (lead.expected_value === null ? "" : String(lead.expected_value)),
      );
      form.set("close_date", values.close_date ?? lead.close_date ?? "");
      form.set("priority", values.priority ?? lead.priority ?? "");

      const result = await updateLead(leadId, form);
      if (!result.ok) return failure(result.error, null, null);

      if (values.owner_email && deps.canAssign) {
        const ownerId = await ownerIdFor(supabase, values.owner_email);
        if (ownerId && ownerId !== lead.owner_id) {
          const assigned = await assignOwner(leadId, ownerId);
          if (!assigned.ok) return failure(assigned.error, "owner_email", null);
        }
      }

      // Stage moves go through changeStage so history, the reason rule, the
      // StageChange activity and the owner's notification all still happen.
      if (values.status && values.status !== lead.status && deps.stageKeys.has(values.status)) {
        const moved = await changeStage(leadId, values.status, values.lost_reason ?? null);
        if (!moved.ok) return failure(moved.error, "status", null);
      }
    }

    if (values.notes) await addNoteOnce(supabase, leadId, values.notes);

    return { status: created ? "created" : "updated", leadId, error: null, field: null, hint: null };
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Something went wrong while writing this row.",
      null,
      "Use “Retry failed rows” — rows that already succeeded are not touched again.",
    );
  }
}

function failure(error: string, field: ImportFieldId | null, hint: string | null): RowOutcome {
  return { status: "failed", leadId: null, error: error.slice(0, 500), field, hint };
}

/** Retrying a row must not stack up identical notes on the timeline. */
async function addNoteOnce(supabase: SupabaseClient, leadId: string, notes: string): Promise<void> {
  const { data: already } = await supabase
    .from("activities")
    .select("id")
    .eq("lead_id", leadId)
    .eq("type", "Note")
    .eq("notes", notes)
    .limit(1)
    .maybeSingle();
  if (already) return;
  await logActivity(leadId, { type: "Note", notes });
}

async function ownerIdFor(supabase: SupabaseClient, email: string): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Finds the account by name, or creates it. The re-read before creating closes
 *  most of the window where two chunks would otherwise make two companies. */
async function resolveCompany(
  supabase: SupabaseClient,
  name: string,
  cache: Map<string, string>,
): Promise<string | null> {
  const key = loosely(name);
  const cached = cache.get(key);
  if (cached) return cached;

  const { data: existing } = await supabase
    .from("companies")
    .select("id,name")
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    cache.set(key, existing.id as string);
    return existing.id as string;
  }

  const form = new FormData();
  form.set("name", name);
  const created = await createCompany(form);
  if (!created.ok || !created.data) return null;
  cache.set(key, created.data.id);
  return created.data.id;
}

/* ------------------------------------------------------------- bookkeeping */

async function loadBatch(supabase: SupabaseClient, batchId: string): Promise<ImportBatch | null> {
  const { data } = await supabase.from("lead_import_batches").select("*").eq("id", batchId).maybeSingle();
  return (data as ImportBatch) ?? null;
}

/** Counters are derived from the rows themselves rather than incremented in
 *  place, so a retried or concurrently processed batch can never drift. */
async function recount(
  supabase: SupabaseClient,
  batchId: string,
  startedAt: string,
): Promise<ImportBatch> {
  const { data } = await supabase
    .from("lead_import_rows")
    .select("row_number,status")
    .eq("batch_id", batchId)
    .order("row_number");

  const rows = (data ?? []) as { row_number: number; status: string }[];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let invalid = 0;
  let failed = 0;
  let processed = 0;
  /** The row where *writing* broke — validation rejects are reported separately,
   *  because they never reached the database and never stopped anything. */
  let firstFailed: number | null = null;
  let lastSuccess: number | null = null;

  for (const row of rows) {
    switch (row.status) {
      case "created":
        created += 1;
        lastSuccess = row.row_number;
        break;
      case "updated":
        updated += 1;
        lastSuccess = row.row_number;
        break;
      case "skipped":
        skipped += 1;
        break;
      case "invalid":
        invalid += 1;
        break;
      case "failed":
        failed += 1;
        if (firstFailed === null) firstFailed = row.row_number;
        break;
      default:
        continue; // pending / processing
    }
    processed += 1;
  }

  const remaining = rows.length - processed;
  const patch: Record<string, unknown> = {
    processed_count: processed,
    created_count: created,
    updated_count: updated,
    skipped_count: skipped,
    invalid_count: invalid,
    failed_count: failed,
    first_failed_row: firstFailed,
    last_success_row: lastSuccess,
  };

  if (remaining === 0) {
    patch.status = failed + invalid === 0 ? "completed" : created + updated + skipped > 0 ? "partially_completed" : "failed";
    patch.completed_at = new Date().toISOString();
    patch.duration_ms = Math.max(0, Date.now() - new Date(startedAt).getTime());
  }

  const { data: batch } = await supabase
    .from("lead_import_batches")
    .update(patch)
    .eq("id", batchId)
    .select("*")
    .maybeSingle();

  return (batch as ImportBatch) ?? ({ id: batchId, ...patch } as unknown as ImportBatch);
}

function progressOf(batch: ImportBatch, hasMore: boolean): ChunkProgress {
  return {
    batchId: batch.id,
    status: batch.status,
    totalRows: batch.total_rows,
    processed: batch.processed_count,
    created: batch.created_count,
    updated: batch.updated_count,
    skipped: batch.skipped_count,
    invalid: batch.invalid_count,
    failed: batch.failed_count,
    firstFailedRow: batch.first_failed_row,
    lastSuccessRow: batch.last_success_row,
    hasMore,
    durationMs: batch.duration_ms,
    error: batch.error,
  };
}

/* ------------------------------------------------------------ retry / cancel */

/** Re-queues the rows that errored while being written. Rows rejected by
 *  validation are left alone — their data has not changed, so a retry would
 *  reject them again; those need a corrected file. */
export async function retryFailedRows(batchId: string): Promise<ActionResult<{ queued: number }>> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");

  const batch = await loadBatch(supabase, batchId);
  if (!batch) return fail("That upload could not be found.");
  if (batch.created_by !== userId && profile?.role !== "admin") {
    return fail("Only the person who uploaded a file can retry it.");
  }

  const { data, error } = await supabase
    .from("lead_import_rows")
    .update({ status: "pending", error: null, error_field: null, hint: null, claimed_at: null })
    .eq("batch_id", batchId)
    .eq("status", "failed")
    .select("id");
  if (error) return fail(error.message);

  const queued = data?.length ?? 0;
  if (!queued) return fail("There are no failed rows to retry. Rejected rows need a corrected file.");

  await supabase
    .from("lead_import_batches")
    .update({ status: "processing", completed_at: null, duration_ms: null })
    .eq("id", batchId);

  revalidateImportViews();
  return ok({ queued });
}

export async function cancelImport(batchId: string): Promise<ActionResult> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");

  const batch = await loadBatch(supabase, batchId);
  if (!batch) return fail("That upload could not be found.");
  if (batch.created_by !== userId && profile?.role !== "admin") {
    return fail("Only the person who uploaded a file can cancel it.");
  }
  if (batch.status === "completed") return fail("That upload has already finished.");

  await supabase
    .from("lead_import_rows")
    .update({ status: "invalid", error: "Cancelled before this row was processed." })
    .eq("batch_id", batchId)
    .in("status", ["pending", "processing"]);

  await supabase
    .from("lead_import_batches")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", batchId);

  revalidateImportViews();
  return ok();
}
