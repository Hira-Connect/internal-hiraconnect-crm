"use server";

import { revalidatePath } from "next/cache";
import {
  TOUCH_TYPES,
  currentActor,
  fail,
  ok,
  recomputeScore,
  type ActionResult,
} from "./shared";
import type { ActivityType, Direction } from "../types";

export interface LogActivityInput {
  type: ActivityType;
  notes?: string | null;
  outcome?: string | null;
  direction?: Direction | null;
  dueDate?: string | null;
  contactId?: string | null;
  /** Optionally set the lead's next follow-up in the same submit. */
  nextAction?: string | null;
  nextActionDate?: string | null;
}

/** The single write path for the conversation log.
 *  Every real touch also advances total_reachouts and last_activity_at, so the
 *  counter reflects logged work rather than a manually clicked +1. */
export async function logActivity(leadId: string, input: LogActivityInput): Promise<ActionResult> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");

  if (input.type === "Note" && !input.notes?.trim()) return fail("A note needs some text.");
  if (input.type === "Task" && !input.notes?.trim()) return fail("A task needs a description.");

  const { error } = await supabase.from("activities").insert({
    lead_id: leadId,
    contact_id: input.contactId ?? null,
    owner_id: userId,
    author: profile?.email ?? null,
    type: input.type,
    notes: input.notes?.trim() || null,
    outcome: input.outcome?.trim() || null,
    direction: input.type === "Task" || input.type === "Note" ? null : (input.direction ?? "out"),
    due_date: input.type === "Task" ? (input.dueDate ?? null) : null,
    done: false,
    activity_date: new Date().toISOString(),
  });
  if (error) return fail(error.message);

  const patch: Record<string, unknown> = { last_activity_at: new Date().toISOString() };

  if (TOUCH_TYPES.has(input.type)) {
    const { data: lead } = await supabase
      .from("leads")
      .select("total_reachouts,first_contacted_at")
      .eq("id", leadId)
      .maybeSingle();
    patch.total_reachouts = ((lead?.total_reachouts as number | null) ?? 0) + 1;
    if (!lead?.first_contacted_at) patch.first_contacted_at = new Date().toISOString();
  }

  if (input.nextAction !== undefined) patch.next_action = input.nextAction;
  if (input.nextActionDate !== undefined) patch.next_action_date = input.nextActionDate;

  await supabase.from("leads").update(patch).eq("id", leadId);
  await recomputeScore(supabase, leadId, `${input.type} logged`);

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  revalidatePath("/");
  return ok();
}

export async function toggleTask(activityId: string, done: boolean): Promise<ActionResult> {
  const { supabase, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");

  const { data, error } = await supabase
    .from("activities")
    .update({ done, completed_at: done ? new Date().toISOString() : null })
    .eq("id", activityId)
    .select("lead_id")
    .maybeSingle();
  if (error) return fail(error.message);

  if (data?.lead_id) revalidatePath(`/leads/${data.lead_id}`);
  revalidatePath("/");
  return ok();
}

export async function deleteActivity(activityId: string): Promise<ActionResult> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile || (profile.role !== "admin" && profile.role !== "manager")) {
    return fail("Only managers and admins can delete activity.");
  }

  const { data, error } = await supabase
    .from("activities")
    .delete()
    .eq("id", activityId)
    .select("lead_id")
    .maybeSingle();
  if (error) return fail(error.message);

  if (data?.lead_id) {
    await recomputeScore(supabase, data.lead_id as string, "Activity deleted");
    revalidatePath(`/leads/${data.lead_id}`);
  }
  return ok();
}

export async function markNotificationsRead(): Promise<ActionResult> {
  const { supabase, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) return fail(error.message);

  revalidatePath("/");
  return ok();
}

/** Void-returning wrapper so this can be passed straight to `<form action={…}>`. */
export async function markNotificationsReadAction(): Promise<void> {
  await markNotificationsRead();
}
