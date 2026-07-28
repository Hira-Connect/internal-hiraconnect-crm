"use server";

import { revalidatePath } from "next/cache";
import { todayISO } from "../format";
import { findStage } from "../stages";
import {
  currentActor,
  emptyToNull,
  fail,
  loadStages,
  numOrNull,
  ok,
  recomputeScore,
  type ActionResult,
} from "./shared";

function revalidateLeadViews(leadId?: string) {
  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath("/pipeline");
  revalidatePath("/reports");
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

/* ------------------------------------------------------------------ create */

export async function createLead(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");

  const name = emptyToNull(formData.get("name"));
  if (!name) return fail("Lead name is required.");

  const companyId = emptyToNull(formData.get("company_id"));
  const title = emptyToNull(formData.get("title"));
  const email = emptyToNull(formData.get("email"));
  const phone = emptyToNull(formData.get("phone"));

  // managers/admins may assign; a rep always owns what they create
  const requestedOwner = emptyToNull(formData.get("owner_id"));
  const ownerId =
    profile && (profile.role === "admin" || profile.role === "manager")
      ? (requestedOwner ?? userId)
      : userId;

  // keep the contact book in sync with the person behind the lead
  let contactId: string | null = null;
  const { data: contact } = await supabase
    .from("contacts")
    .insert({
      company_id: companyId,
      full_name: name,
      title,
      email,
      phone,
      whatsapp: emptyToNull(formData.get("whatsapp")),
      linkedin: emptyToNull(formData.get("linkedin")),
      is_primary: true,
    })
    .select("id")
    .maybeSingle();
  if (contact) contactId = contact.id as string;

  const status = emptyToNull(formData.get("status")) ?? "New";

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      name,
      company_id: companyId,
      contact_id: contactId,
      owner_id: ownerId,
      team_id: profile?.team_id ?? null,
      title,
      email,
      phone,
      whatsapp: emptyToNull(formData.get("whatsapp")),
      linkedin: emptyToNull(formData.get("linkedin")),
      status,
      source: emptyToNull(formData.get("source")),
      next_action: emptyToNull(formData.get("next_action")),
      next_action_date: emptyToNull(formData.get("next_action_date")),
      expected_value: numOrNull(formData.get("expected_value")),
      close_date: emptyToNull(formData.get("close_date")),
      stage_since: todayISO(),
      last_activity_at: new Date().toISOString(),
      total_reachouts: 0,
    })
    .select("id")
    .maybeSingle();

  if (error || !lead) return fail(error?.message ?? "Could not create the lead.");

  await supabase.from("stage_history").insert({
    lead_id: lead.id,
    from_stage: null,
    to_stage: status,
    note: "Lead created",
    changed_by: profile?.email ?? null,
    changed_by_id: userId,
  });

  await recomputeScore(supabase, lead.id as string, "Lead created");
  revalidateLeadViews(lead.id as string);
  return ok({ id: lead.id as string });
}

/* ------------------------------------------------------------------ update */

export async function updateLead(leadId: string, formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");

  const patch: Record<string, unknown> = {
    name: emptyToNull(formData.get("name")),
    title: emptyToNull(formData.get("title")),
    email: emptyToNull(formData.get("email")),
    phone: emptyToNull(formData.get("phone")),
    whatsapp: emptyToNull(formData.get("whatsapp")),
    linkedin: emptyToNull(formData.get("linkedin")),
    company_id: emptyToNull(formData.get("company_id")),
    source: emptyToNull(formData.get("source")),
    next_action: emptyToNull(formData.get("next_action")),
    next_action_date: emptyToNull(formData.get("next_action_date")),
    expected_value: numOrNull(formData.get("expected_value")),
    close_date: emptyToNull(formData.get("close_date")),
    priority: emptyToNull(formData.get("priority")),
  };
  if (!patch.name) return fail("Lead name is required.");

  const { error } = await supabase.from("leads").update(patch).eq("id", leadId);
  if (error) return fail(error.message);

  await recomputeScore(supabase, leadId, "Lead details edited");
  revalidateLeadViews(leadId);
  return ok();
}

/** Inline edits from the table — one field at a time, no full form round-trip. */
export async function setNextAction(
  leadId: string,
  nextAction: string | null,
  nextActionDate: string | null,
): Promise<ActionResult> {
  const { supabase, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");

  const { error } = await supabase
    .from("leads")
    .update({ next_action: nextAction, next_action_date: nextActionDate })
    .eq("id", leadId);
  if (error) return fail(error.message);

  revalidateLeadViews(leadId);
  return ok();
}

/* ------------------------------------------------------------ stage change */

const MOFU_ENTRY = new Set([
  "Meeting Scheduled",
  "Meeting Done",
  "Demo Setup",
  "Demo Done",
  "Onboarding",
  "Won",
]);

export async function changeStage(
  leadId: string,
  toStage: string,
  note: string | null,
  lostReason: string | null = null,
): Promise<ActionResult> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");

  const { data: lead } = await supabase
    .from("leads")
    .select("id,status,stage_since,created_at,owner_id,name,first_contacted_at,qualified_at")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return fail("Lead not found, or you do not have access to it.");
  if (lead.status === toStage) return ok();

  const stages = await loadStages(supabase);
  const target = findStage(stages, toStage);
  if (!target) return fail(`Unknown stage "${toStage}".`);

  // Lost and Delayed must carry a reason — this is the pipeline-hygiene rule.
  const reason = lostReason ?? note;
  if ((target.category === "lost" || toStage === "Delayed") && !reason) {
    return fail(`Moving to ${toStage} requires a reason.`);
  }

  const since = lead.stage_since ?? lead.created_at;
  const daysInFrom = since
    ? Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000))
    : null;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: toStage,
    stage_since: todayISO(),
    last_activity_at: now,
  };
  if (target.category === "lost" || toStage === "Delayed") patch.lost_reason = reason;
  if (target.category === "lost") patch.lost_at = now;
  if (target.category === "won") patch.won_at = now;
  if (!lead.first_contacted_at && toStage !== "New") patch.first_contacted_at = now;
  if (!lead.qualified_at && MOFU_ENTRY.has(toStage)) patch.qualified_at = now;

  const { error } = await supabase.from("leads").update(patch).eq("id", leadId);
  if (error) return fail(error.message);

  await supabase.from("stage_history").insert({
    lead_id: leadId,
    from_stage: lead.status,
    to_stage: toStage,
    note: reason,
    changed_by: profile?.email ?? null,
    changed_by_id: userId,
    days_in_from_stage: daysInFrom,
  });

  await supabase.from("activities").insert({
    lead_id: leadId,
    type: "StageChange",
    outcome: `${lead.status} → ${toStage}`,
    notes: reason,
    author: profile?.email ?? null,
    owner_id: userId,
  });

  // tell the owner when somebody else moves their lead
  if (lead.owner_id && lead.owner_id !== userId) {
    await supabase.from("notifications").insert({
      user_id: lead.owner_id,
      lead_id: leadId,
      type: "stage",
      title: `${lead.name} moved to ${toStage}`,
      body: reason ?? `Moved by ${profile?.full_name ?? profile?.email ?? "a teammate"}.`,
    });
  }

  await recomputeScore(supabase, leadId, `Stage → ${toStage}`);
  revalidateLeadViews(leadId);
  return ok();
}

/* ------------------------------------------------------------- assignment */

export async function assignOwner(leadId: string, ownerId: string | null): Promise<ActionResult> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile || (profile.role !== "admin" && profile.role !== "manager")) {
    return fail("Only managers and admins can reassign leads.");
  }

  let teamId: string | null = null;
  if (ownerId) {
    const { data: owner } = await supabase.from("profiles").select("team_id").eq("id", ownerId).maybeSingle();
    teamId = (owner?.team_id as string | null) ?? null;
  }

  const { data: lead, error } = await supabase
    .from("leads")
    .update({ owner_id: ownerId, team_id: teamId })
    .eq("id", leadId)
    .select("name")
    .maybeSingle();
  if (error) return fail(error.message);

  if (ownerId && ownerId !== userId) {
    await supabase.from("notifications").insert({
      user_id: ownerId,
      lead_id: leadId,
      type: "assignment",
      title: `${lead?.name ?? "A lead"} was assigned to you`,
      body: `Assigned by ${profile.full_name ?? profile.email ?? "a manager"}.`,
    });
  }

  revalidateLeadViews(leadId);
  revalidatePath("/team");
  return ok();
}

export async function bulkAssign(leadIds: string[], ownerId: string | null): Promise<ActionResult> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile || (profile.role !== "admin" && profile.role !== "manager")) {
    return fail("Only managers and admins can reassign leads.");
  }
  if (!leadIds.length) return fail("No leads selected.");

  let teamId: string | null = null;
  if (ownerId) {
    const { data: owner } = await supabase.from("profiles").select("team_id").eq("id", ownerId).maybeSingle();
    teamId = (owner?.team_id as string | null) ?? null;
  }

  const { error } = await supabase
    .from("leads")
    .update({ owner_id: ownerId, team_id: teamId })
    .in("id", leadIds);
  if (error) return fail(error.message);

  revalidateLeadViews();
  revalidatePath("/team");
  return ok();
}

export async function bulkSetStage(leadIds: string[], toStage: string, note: string): Promise<ActionResult> {
  if (!leadIds.length) return fail("No leads selected.");
  for (const id of leadIds) {
    const result = await changeStage(id, toStage, note || null);
    if (!result.ok) return result;
  }
  return ok();
}

/** Hand every open lead from one user to another — used when a rep leaves. */
export async function transferLeads(fromUserId: string, toUserId: string): Promise<ActionResult<{ moved: number }>> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile || profile.role !== "admin") return fail("Only admins can transfer a user's book.");
  if (fromUserId === toUserId) return fail("Pick a different destination user.");

  const { data: owner } = await supabase.from("profiles").select("team_id").eq("id", toUserId).maybeSingle();

  const { data, error } = await supabase
    .from("leads")
    .update({ owner_id: toUserId, team_id: (owner?.team_id as string | null) ?? null })
    .eq("owner_id", fromUserId)
    .not("status", "in", "(Won,Lost)")
    .select("id");
  if (error) return fail(error.message);

  revalidateLeadViews();
  revalidatePath("/team");
  return ok({ moved: data?.length ?? 0 });
}

/* ---------------------------------------------------------------- delete */

export async function deleteLead(leadId: string): Promise<ActionResult> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile || (profile.role !== "admin" && profile.role !== "manager")) {
    return fail("Only managers and admins can delete leads.");
  }

  const { error } = await supabase.from("leads").delete().eq("id", leadId);
  if (error) return fail(error.message);

  revalidateLeadViews();
  return ok();
}

/* ------------------------------------------------------------- scoring */

/** Re-runs scoring across every lead the caller can see. Admin-only because it
 *  writes a score-history row per changed lead. */
export async function recomputeAllScores(): Promise<ActionResult<{ scored: number }>> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile || profile.role !== "admin") return fail("Only admins can rescore the whole database.");

  const { data: leads, error } = await supabase.from("leads").select("id");
  if (error) return fail(error.message);

  for (const lead of leads ?? []) {
    await recomputeScore(supabase, lead.id as string, "Bulk rescore");
  }

  revalidateLeadViews();
  return ok({ scored: leads?.length ?? 0 });
}
