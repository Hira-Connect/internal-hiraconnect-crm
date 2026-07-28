"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { currentActor, emptyToNull, fail, numOrNull, ok, type ActionResult } from "./shared";
import { METRIC_PRESETS } from "../metrics";

const TOUCH = ["Call", "Email", "WhatsApp", "Meeting", "Demo"];

function monthBounds(month: string): { start: string; end: string } {
  const start = new Date(`${month.slice(0, 7)}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Computes the real number behind a target row from the CRM's own data. */
async function computeActual(
  supabase: SupabaseClient,
  metric: string,
  month: string,
  ownerId: string | null,
): Promise<number> {
  const { start, end } = monthBounds(month);

  if (metric === "New leads") {
    let q = supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .gte("created_at", start)
      .lt("created_at", end);
    if (ownerId) q = q.eq("owner_id", ownerId);
    const { count } = await q;
    return count ?? 0;
  }

  if (metric === "Won" || metric === "Revenue") {
    let q = supabase
      .from("leads")
      .select("expected_value")
      .gte("won_at", start)
      .lt("won_at", end);
    if (ownerId) q = q.eq("owner_id", ownerId);
    const { data } = await q;
    const rows = (data ?? []) as { expected_value: number | null }[];
    if (metric === "Won") return rows.length;
    return rows.reduce((sum, r) => sum + (r.expected_value ?? 0), 0);
  }

  // activity-based metrics
  let q = supabase
    .from("activities")
    .select("id", { count: "exact", head: true })
    .gte("created_at", start)
    .lt("created_at", end);

  if (metric === "Meetings") q = q.eq("type", "Meeting");
  else if (metric === "Demos") q = q.eq("type", "Demo");
  else if (metric === "Reachouts") q = q.in("type", TOUCH);
  else return 0;

  if (ownerId) q = q.eq("owner_id", ownerId);
  const { count } = await q;
  return count ?? 0;
}

/* ------------------------------------------------------------------ write */

export async function upsertTarget(formData: FormData): Promise<ActionResult> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile || (profile.role !== "admin" && profile.role !== "manager")) {
    return fail("Only managers and admins can set targets.");
  }

  const monthInput = emptyToNull(formData.get("month"));
  const metric = emptyToNull(formData.get("metric"));
  const targetValue = numOrNull(formData.get("target_value"));
  if (!monthInput || !metric) return fail("Month and metric are required.");
  if (targetValue === null || targetValue < 0) return fail("Enter a target value of zero or more.");

  const month = `${monthInput.slice(0, 7)}-01`;
  const ownerId = emptyToNull(formData.get("owner_id"));
  const autoActual = formData.get("auto_actual") !== "off";

  let teamId: string | null = profile.team_id;
  if (ownerId) {
    const { data: owner } = await supabase.from("profiles").select("team_id").eq("id", ownerId).maybeSingle();
    teamId = (owner?.team_id as string | null) ?? null;
  }

  const actual = autoActual
    ? await computeActual(supabase, metric, month, ownerId)
    : (numOrNull(formData.get("actual_value")) ?? 0);

  // find an existing row for this (month, metric, owner) before inserting
  let existingQuery = supabase.from("monthly_targets").select("id").eq("month", month).eq("metric", metric);
  existingQuery = ownerId ? existingQuery.eq("owner_id", ownerId) : existingQuery.is("owner_id", null);
  const { data: existing } = await existingQuery.maybeSingle();

  const row = {
    month,
    metric,
    owner_id: ownerId,
    team_id: teamId,
    target_value: targetValue,
    actual_value: actual,
    auto_actual: autoActual,
    notes: emptyToNull(formData.get("notes")),
  };

  const { error } = existing
    ? await supabase.from("monthly_targets").update(row).eq("id", existing.id)
    : await supabase.from("monthly_targets").insert(row);

  if (error) return fail(error.message);

  revalidatePath("/targets");
  revalidatePath("/");
  return ok();
}

export async function deleteTarget(id: string): Promise<ActionResult> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile || (profile.role !== "admin" && profile.role !== "manager")) {
    return fail("Only managers and admins can delete targets.");
  }

  const { error } = await supabase.from("monthly_targets").delete().eq("id", id);
  if (error) return fail(error.message);

  revalidatePath("/targets");
  return ok();
}

/** Recomputes actual_value for every auto row. Cheap enough to run on demand;
 *  a cron-triggered edge function can call the same logic later. */
export async function syncActuals(): Promise<ActionResult<{ updated: number }>> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile || (profile.role !== "admin" && profile.role !== "manager")) {
    return fail("Only managers and admins can refresh actuals.");
  }

  const { data, error } = await supabase
    .from("monthly_targets")
    .select("id,month,metric,owner_id,auto_actual")
    .eq("auto_actual", true);
  if (error) return fail(error.message);

  let updated = 0;
  for (const row of data ?? []) {
    const actual = await computeActual(
      supabase,
      row.metric as string,
      row.month as string,
      (row.owner_id as string | null) ?? null,
    );
    await supabase.from("monthly_targets").update({ actual_value: actual }).eq("id", row.id);
    updated += 1;
  }

  revalidatePath("/targets");
  revalidatePath("/");
  return ok({ updated });
}

/** Creates a full metric set for a month in one click. */
export async function seedMonth(month: string, ownerId: string | null): Promise<ActionResult> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile || (profile.role !== "admin" && profile.role !== "manager")) {
    return fail("Only managers and admins can set targets.");
  }

  const normalised = `${month.slice(0, 7)}-01`;

  for (const preset of METRIC_PRESETS) {
    let q = supabase
      .from("monthly_targets")
      .select("id")
      .eq("month", normalised)
      .eq("metric", preset.key);
    q = ownerId ? q.eq("owner_id", ownerId) : q.is("owner_id", null);
    const { data: existing } = await q.maybeSingle();
    if (existing) continue;

    const actual = await computeActual(supabase, preset.key, normalised, ownerId);
    await supabase.from("monthly_targets").insert({
      month: normalised,
      metric: preset.key,
      owner_id: ownerId,
      team_id: profile.team_id,
      target_value: 0,
      actual_value: actual,
      auto_actual: true,
    });
  }

  revalidatePath("/targets");
  return ok();
}
