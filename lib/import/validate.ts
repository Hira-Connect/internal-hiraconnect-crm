/** Row validation and the create-vs-update decision.
 *
 *  Pure on purpose: every database fact it needs is passed in as an index, so the
 *  whole decision table is unit-testable without a network. The action layer
 *  builds the indexes, this decides, and only then does anything get written.
 *
 *  Identity rules, taken from the application as it stands rather than invented
 *  here (see lib/actions/signups.ts and components/leads/lead-form.tsx):
 *    - `leads.id` is the only uniqueness the database enforces.
 *    - Email is the business key the app already dedupes on, case-insensitively.
 *    - Everything else is free to change on an update.
 */

import { COLUMN_BY_ID, COLUMNS } from "./schema";
import {
  loosely,
  phoneKey,
  parseDate,
  parseEmail,
  parseNumber,
  parsePhone,
  parseUrl,
  parseUuid,
  type CellRead,
} from "./normalize";
import type { ImportFieldId, PlannedRow, RowIssue } from "./types";

/** The lead columns the importer can write, as they are today. */
export interface ExistingLead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  linkedin: string | null;
  title: string | null;
  company_id: string | null;
  source: string | null;
  status: string;
  owner_id: string | null;
  next_action: string | null;
  next_action_date: string | null;
  expected_value: number | null;
  close_date: string | null;
  priority: string | null;
}

export interface StageOption {
  key: string;
  label: string;
  category: "open" | "won" | "lost";
  isActive: boolean;
}

export interface ValidationContext {
  stages: StageOption[];
  /** Loose company name → id. Names not in here are created during processing. */
  companiesByName: Map<string, string>;
  /** Lowercased login email → active profile. */
  ownersByEmail: Map<string, { id: string }>;
  leadsById: Map<string, ExistingLead>;
  /** Lowercased lead email → lead. First one wins, as `convertSignup` does. */
  leadsByEmail: Map<string, ExistingLead>;
  /** Business keys this user has already imported into a lead. */
  importedKeys: Map<string, { leadId: string; batchId: string }>;
  /** Emails that belong to a lead this user cannot see. Prevents a silent twin
   *  record without disclosing anything about the lead itself. */
  invisibleEmails: Set<string>;
  me: { id: string };
  /** Managers and admins may hand a lead to somebody else; a rep may not. */
  canAssignOthers: boolean;
}

export interface RawRow {
  rowNumber: number;
  cells: Partial<Record<ImportFieldId, CellRead>>;
}

/** Fields that identify a lead and are therefore never overwritten in bulk. */
export const CRITICAL_FIELDS: ImportFieldId[] = ["lead_id", "email"];

const STAGES_NEEDING_REASON = new Set(["Lost", "Delayed"]);

function issue(field: ImportFieldId | null, message: string, hint?: string): RowIssue {
  return { field, message, hint };
}

/** Prefixes the column name so an error reads like a sentence about that cell. */
function fieldIssue(field: ImportFieldId, problem: string, hint?: string): RowIssue {
  return issue(field, `${COLUMN_BY_ID.get(field)?.header ?? field}: ${problem}`, hint);
}

/* ------------------------------------------------------------ field parsing */

interface Parsed {
  values: Partial<Record<ImportFieldId, string>>;
  issues: RowIssue[];
  /** True when every cell in the row was blank. */
  blank: boolean;
}

function parseFields(cells: Partial<Record<ImportFieldId, CellRead>>): Parsed {
  const values: Partial<Record<ImportFieldId, string>> = {};
  const issues: RowIssue[] = [];
  let blank = true;

  for (const spec of COLUMNS) {
    const cell = cells[spec.id];
    if (!cell) continue;
    if (cell.problem) {
      blank = false;
      issues.push(fieldIssue(spec.id, cell.problem, "Retype the cell as plain text."));
      continue;
    }
    if (!cell.text) continue;
    blank = false;

    if (spec.maxLength && cell.text.length > spec.maxLength) {
      issues.push(
        fieldIssue(
          spec.id,
          `longer than ${spec.maxLength} characters`,
          `Shorten it to ${spec.maxLength} characters or fewer.`,
        ),
      );
      continue;
    }

    switch (spec.kind) {
      case "uuid": {
        const { value, problem } = parseUuid(cell.text);
        if (problem) issues.push(fieldIssue(spec.id, problem, "Copy it from the lead's page URL, or leave it blank to create a new lead."));
        else if (value) values[spec.id] = value;
        break;
      }
      case "email": {
        const { value, problem } = parseEmail(cell.text);
        if (problem) issues.push(fieldIssue(spec.id, problem, "Use the form name@company.com."));
        else if (value) values[spec.id] = value;
        break;
      }
      case "phone": {
        const { value, problem } = parsePhone(cell.text);
        if (problem) issues.push(fieldIssue(spec.id, problem, "Digits only, optionally with a leading +."));
        else if (value) values[spec.id] = value;
        break;
      }
      case "url": {
        const { value, problem } = parseUrl(cell.text);
        if (problem) issues.push(fieldIssue(spec.id, problem, "Paste the full https:// link."));
        else if (value) values[spec.id] = value;
        break;
      }
      case "date": {
        const { iso, problem } = parseDate(cell);
        if (problem) issues.push(fieldIssue(spec.id, problem, "Write it as DD-MM-YYYY, or format the column as a date."));
        else if (iso) values[spec.id] = iso;
        break;
      }
      case "number": {
        const { value, problem } = parseNumber(cell);
        if (problem) {
          issues.push(fieldIssue(spec.id, problem, "Digits only — no currency symbol, no “L” or “Cr”."));
        } else if (value !== null) {
          if (value < 0) issues.push(fieldIssue(spec.id, "cannot be negative"));
          else if (value > 1e12) issues.push(fieldIssue(spec.id, "is implausibly large"));
          else values[spec.id] = String(Math.round(value));
        }
        break;
      }
      case "enum": {
        if (spec.options) {
          const match = spec.options.find((o) => loosely(o) === loosely(cell.text));
          if (!match) {
            issues.push(
              fieldIssue(spec.id, `“${cell.text}” is not an accepted value`, `Use one of: ${spec.options.join(", ")}.`),
            );
          } else {
            values[spec.id] = match;
          }
        } else {
          // resolved later against the database (Stage)
          values[spec.id] = cell.text;
        }
        break;
      }
      default:
        values[spec.id] = cell.text;
    }
  }

  return { values, issues, blank };
}

/* ------------------------------------------------------------ business keys */

/** The stable key a row is deduplicated on, in descending order of trust.
 *  Returns null when the row has nothing usable — an unnamed row is invalid anyway. */
export function businessKey(values: Partial<Record<ImportFieldId, string>>): string | null {
  if (values.lead_id) return `lead:${values.lead_id}`;
  if (values.email) return `email:${values.email}`;
  const name = loosely(values.name ?? "");
  if (!name) return null;
  // Last resort for rows with no email: enough to catch the same person pasted
  // twice, and used only to make a re-upload idempotent — never to match a lead
  // the app itself would consider separate.
  return `nc:${name}|${loosely(values.company ?? "")}|${phoneKey(values.phone ?? "")}`;
}

/** The keys a file would claim, without deciding anything yet. Lets the action
 *  layer ask the database about exactly these keys instead of loading the whole
 *  import history to find out whether a row has been seen before. */
export function rowKeysOf(rows: RawRow[]): string[] {
  const keys: string[] = [];
  for (const row of rows) {
    const key = businessKey(parseFields(row.cells).values);
    if (key) keys.push(key);
  }
  return keys;
}

/* ------------------------------------------------------------------ planning */

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim() === (b ?? "").trim();
}

/** Does this update actually change anything? Blank cells mean "leave alone",
 *  so a row that only repeats what is already stored is a no-op worth skipping. */
function updateChangesSomething(
  values: Partial<Record<ImportFieldId, string>>,
  lead: ExistingLead,
  ctx: ValidationContext,
  resolvedStage: string | null,
  ownerId: string | null,
): boolean {
  if (values.name && !sameText(values.name, lead.name)) return true;
  if (values.title && !sameText(values.title, lead.title)) return true;
  if (values.email && !sameText(values.email, lead.email)) return true;
  if (values.phone && !sameText(values.phone, lead.phone)) return true;
  if (values.whatsapp && !sameText(values.whatsapp, lead.whatsapp)) return true;
  if (values.linkedin && !sameText(values.linkedin, lead.linkedin)) return true;
  if (values.source && !sameText(values.source, lead.source)) return true;
  if (values.next_action && !sameText(values.next_action, lead.next_action)) return true;
  if (values.next_action_date && !sameText(values.next_action_date, lead.next_action_date)) return true;
  if (values.close_date && !sameText(values.close_date, lead.close_date)) return true;
  if (values.priority && !sameText(values.priority, lead.priority)) return true;
  if (values.expected_value && Number(values.expected_value) !== (lead.expected_value ?? null)) return true;
  if (values.company) {
    const companyId = ctx.companiesByName.get(loosely(values.company));
    // an unknown company will be created, which is itself a change
    if (!companyId || companyId !== lead.company_id) return true;
  }
  if (resolvedStage && resolvedStage !== lead.status) return true;
  if (ownerId && ownerId !== lead.owner_id) return true;
  // a note is always new information
  if (values.notes) return true;
  return false;
}

/** Validates and plans every row in one pass. Rows are decided in file order, so
 *  "duplicate of row 12" always points backwards. */
export function planRows(rows: RawRow[], ctx: ValidationContext): PlannedRow[] {
  const stageByKey = new Map(ctx.stages.map((s) => [loosely(s.key), s]));
  const stageByLabel = new Map(ctx.stages.map((s) => [loosely(s.label), s]));
  const openStages = ctx.stages.filter((s) => s.isActive && s.category === "open").map((s) => s.key);

  /** Business key → the first row in this file that claimed it. */
  const seen = new Map<string, { rowNumber: number; values: Partial<Record<ImportFieldId, string>> }>();
  const planned: PlannedRow[] = [];

  for (const row of rows) {
    const { values, issues, blank } = parseFields(row.cells);
    const warnings: RowIssue[] = [];

    if (blank) continue; // an empty spacer row is not an error

    const identifier = values.email ?? values.name ?? `Row ${row.rowNumber}`;
    const push = (over: Partial<PlannedRow>): void => {
      planned.push({
        rowNumber: row.rowNumber,
        values,
        rowKey: businessKey(values),
        identifier,
        action: "skip",
        status: "invalid",
        leadId: null,
        issues,
        warnings,
        ...over,
      });
    };

    if (!values.name) {
      issues.push(fieldIssue("name", "is required", "Every row needs the lead's name."));
    }

    /* ---------------------------------------------------------- match a lead */
    let lead: ExistingLead | null = null;
    let matchedBy: "lead_id" | "email" | null = null;

    if (values.lead_id) {
      lead = ctx.leadsById.get(values.lead_id) ?? null;
      if (!lead) {
        issues.push(
          fieldIssue(
            "lead_id",
            "does not match a lead you can see",
            "Clear the cell to create a new lead, or check the id on the lead's page.",
          ),
        );
      } else {
        matchedBy = "lead_id";
      }
    }
    if (!lead && values.email) {
      lead = ctx.leadsByEmail.get(values.email) ?? null;
      if (lead) matchedBy = "email";
    }

    /* --------------------------------------------- critical-field protection */
    if (lead && matchedBy === "lead_id" && values.email && lead.email && values.email !== lead.email) {
      issues.push(
        fieldIssue(
          "email",
          `differs from the email already on this lead (${lead.email})`,
          "Email identifies a lead here, so a bulk upload will not rewrite it. Change it on the lead's page, or clear the Lead ID to create a separate lead.",
        ),
      );
    }

    /* ------------------------------------------------------------- the stage */
    let resolvedStage: string | null = null;
    if (values.status) {
      const stage = stageByKey.get(loosely(values.status)) ?? stageByLabel.get(loosely(values.status)) ?? null;
      if (!stage) {
        issues.push(fieldIssue("status", `“${values.status}” is not a stage`, `Use one of: ${ctx.stages.map((s) => s.key).join(", ")}.`));
      } else if (!stage.isActive) {
        issues.push(fieldIssue("status", `“${stage.key}” is no longer in use`));
      } else {
        resolvedStage = stage.key;
        values.status = stage.key;
        if (!lead && stage.category !== "open") {
          issues.push(
            fieldIssue(
              "status",
              `a new lead cannot start in “${stage.key}”`,
              `Import it in an open stage (${openStages.join(", ")}), then close it from the lead's page so the reason and the history are recorded.`,
            ),
          );
        }
        if (
          lead &&
          STAGES_NEEDING_REASON.has(stage.key) &&
          lead.status !== stage.key &&
          !values.lost_reason
        ) {
          issues.push(
            fieldIssue(
              "lost_reason",
              `is required to move a lead to “${stage.key}”`,
              "The app asks for this reason too — it is what makes the lost-reason report trustworthy.",
            ),
          );
        }
      }
    }

    /* ------------------------------------------------------------- the owner */
    let ownerId: string | null = null;
    if (values.owner_email) {
      const owner = ctx.ownersByEmail.get(values.owner_email);
      if (!owner) {
        issues.push(
          fieldIssue("owner_email", "is not an active user of this CRM", "Use the teammate's login email, or leave it blank."),
        );
      } else if (owner.id !== ctx.me.id && !ctx.canAssignOthers) {
        issues.push(
          fieldIssue(
            "owner_email",
            "is somebody else",
            "Only managers and admins can assign a lead to another person. Leave it blank to own it yourself.",
          ),
        );
      } else {
        ownerId = owner.id;
      }
    }

    if (issues.length) {
      push({ leadId: lead?.id ?? null, action: lead ? "update" : "create", status: "invalid" });
      continue;
    }

    /* ------------------------------------------------- duplicates and no-ops */
    const rowKey = businessKey(values);

    if (rowKey) {
      const first = seen.get(rowKey);
      if (first) {
        const differs = COLUMNS.some((c) => (values[c.id] ?? "") !== (first.values[c.id] ?? ""));
        issues.push(
          issue(
            null,
            `duplicate of row ${first.rowNumber} in this file`,
            differs
              ? `Row ${first.rowNumber} was used and this one ignored, because the two rows disagree. Merge them into one row and upload again if this row is the correct one.`
              : "The identical row above was already processed.",
          ),
        );
        push({ leadId: lead?.id ?? null, status: "skipped", action: "skip" });
        continue;
      }
      seen.set(rowKey, { rowNumber: row.rowNumber, values });
    }

    // Already imported before, and not matchable as an update: this is the
    // re-upload guard for rows that carry no email.
    if (!lead && rowKey) {
      const previous = ctx.importedKeys.get(rowKey);
      if (previous) {
        issues.push(
          issue(
            null,
            "already imported by an earlier upload",
            "The lead it created still exists, so this row was skipped instead of creating a second copy.",
          ),
        );
        push({ leadId: previous.leadId, status: "skipped", action: "skip" });
        continue;
      }
    }

    // Somebody else's lead already owns this address. Say that it exists and
    // nothing more — the lead itself is outside this user's visibility.
    if (!lead && values.email && ctx.invisibleEmails.has(values.email)) {
      issues.push(
        issue(
          null,
          "a lead with this email already exists but is not yours to edit",
          "Ask a manager to reassign it rather than creating a second lead on the same address.",
        ),
      );
      push({ status: "skipped", action: "skip" });
      continue;
    }

    if (lead) {
      if (!updateChangesSomething(values, lead, ctx, resolvedStage, ownerId)) {
        issues.push(issue(null, "matches the lead already stored — nothing to update"));
        push({ leadId: lead.id, status: "skipped", action: "skip" });
        continue;
      }
      push({ leadId: lead.id, action: "update", status: "pending" });
      continue;
    }

    if (!values.email) {
      warnings.push(
        issue(
          null,
          "no email — this lead cannot be matched by a later upload",
          "Add an email if you expect to update this lead in bulk again.",
        ),
      );
    }
    push({ action: "create", status: "pending" });
  }

  return planned;
}
