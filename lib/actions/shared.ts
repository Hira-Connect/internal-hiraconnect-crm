import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "../supabase/server";
import { DEFAULT_STAGES } from "../stages";
import { scoreLead, statsFromActivities } from "../scoring";
import type { ActionResult, Profile, Stage } from "../types";

export type { ActionResult };

export function fail(error: string): ActionResult<never> {
  return { ok: false, error };
}

export function ok<T>(data?: T): ActionResult<T> {
  return { ok: true, data };
}

/** Resolves the caller once per action. Never trust a user id from the client. */
export async function currentActor(): Promise<{
  supabase: SupabaseClient;
  profile: Profile | null;
  userId: string | null;
  email: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, profile: null, userId: null, email: null };

  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return {
    supabase,
    profile: (data as Profile) ?? null,
    userId: user.id,
    email: user.email ?? null,
  };
}

export async function loadStages(supabase: SupabaseClient): Promise<Stage[]> {
  const { data, error } = await supabase.from("stages").select("*").order("sort");
  if (error || !data?.length) return DEFAULT_STAGES;
  return data as Stage[];
}

/** Recomputes fit + engagement for one lead and persists the result.
 *  A score-history row is written only when the number actually moves, so the
 *  "why did this change" trail stays readable. */
export async function recomputeScore(
  supabase: SupabaseClient,
  leadId: string,
  reason: string,
): Promise<void> {
  const [{ data: lead }, { data: activities }, stages] = await Promise.all([
    supabase
      .from("leads")
      .select(
        "*, company:companies(size_band,employee_count,industry,is_icp,hiring_need), contact:contacts(title)",
      )
      .eq("id", leadId)
      .maybeSingle(),
    supabase.from("activities").select("type,direction").eq("lead_id", leadId),
    loadStages(supabase),
  ]);

  if (!lead) return;

  const result = scoreLead({
    lead: lead as never,
    company: (lead as { company?: never }).company ?? null,
    contactTitle: (lead as { contact?: { title?: string | null } }).contact?.title ?? null,
    stages,
    activityStats: statsFromActivities(
      (activities ?? []) as { type: string; direction: string | null }[],
    ),
  });

  const changed =
    (lead as { score_total?: number }).score_total !== result.total ||
    (lead as { grade?: string | null }).grade !== result.grade;

  await supabase
    .from("leads")
    .update({
      score_fit: result.fit,
      score_engagement: result.engagement,
      score_total: result.total,
      grade: result.grade,
      score_updated_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  if (changed) {
    await supabase.from("lead_score_history").insert({
      lead_id: leadId,
      score_fit: result.fit,
      score_engagement: result.engagement,
      score_total: result.total,
      grade: result.grade,
      reason,
    });
  }
}

/** Activity types that represent real outreach and therefore bump the touch counter. */
export const TOUCH_TYPES = new Set(["Call", "Email", "WhatsApp", "Meeting", "Demo"]);

export function emptyToNull(value: FormDataEntryValue | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

export function numOrNull(value: FormDataEntryValue | null | undefined): number | null {
  const s = emptyToNull(value);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
