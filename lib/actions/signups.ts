"use server";

import { revalidatePath } from "next/cache";
import { todayISO } from "../format";
import { currentActor, fail, ok, recomputeScore, type ActionResult } from "./shared";

export interface ConvertResult {
  leadId: string;
  /** Set when the email already existed — we linked instead of creating a duplicate. */
  duplicateOf?: string;
}

/** Converts a website signup into a lead.
 *  Dedupes on email first: a second signup from the same address links to the
 *  existing lead and logs an inbound touch rather than creating a twin record. */
export async function convertSignup(signupId: string): Promise<ActionResult<ConvertResult>> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");

  const { data: signup } = await supabase
    .from("raw_signups")
    .select("*")
    .eq("id", signupId)
    .maybeSingle();
  if (!signup) return fail("Signup not found.");
  if (signup.converted_lead_id) return fail("This signup has already been converted.");

  const email = (signup.email as string | null)?.trim() ?? null;

  // 1. dedupe
  if (email) {
    const { data: existing } = await supabase
      .from("leads")
      .select("id,name")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    if (existing) {
      await supabase.from("activities").insert({
        lead_id: existing.id,
        type: "Note",
        direction: "in",
        outcome: "Repeat website signup",
        notes: `Signed up again via the website${signup.submit_type ? ` (${signup.submit_type})` : ""}.`,
        author: profile?.email ?? null,
        owner_id: userId,
      });
      await supabase
        .from("leads")
        .update({ last_activity_at: new Date().toISOString() })
        .eq("id", existing.id);
      await supabase.from("raw_signups").update({ converted_lead_id: existing.id }).eq("id", signupId);
      await recomputeScore(supabase, existing.id as string, "Repeat website signup");

      revalidatePath("/signups");
      revalidatePath("/leads");
      return ok({ leadId: existing.id as string, duplicateOf: existing.name as string });
    }
  }

  // 2. create the contact + lead
  const name = (signup.name as string | null)?.trim() || email || "Website signup";

  const { data: contact } = await supabase
    .from("contacts")
    .insert({ full_name: name, email, is_primary: true, notes: "Created from website signup" })
    .select("id")
    .maybeSingle();

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      name,
      email,
      contact_id: contact?.id ?? null,
      owner_id: userId,
      team_id: profile?.team_id ?? null,
      status: "New",
      source: signup.source || `Website Signup${signup.submit_type ? ` · ${signup.submit_type}` : ""}`,
      stage_since: todayISO(),
      last_activity_at: new Date().toISOString(),
      total_reachouts: 0,
      next_action: "First outreach",
      next_action_date: todayISO(),
    })
    .select("id")
    .maybeSingle();

  if (error || !lead) return fail(error?.message ?? "Could not create the lead.");

  await supabase.from("stage_history").insert({
    lead_id: lead.id,
    from_stage: null,
    to_stage: "New",
    note: "Converted from website signup",
    changed_by: profile?.email ?? null,
    changed_by_id: userId,
  });

  await supabase.from("raw_signups").update({ converted_lead_id: lead.id }).eq("id", signupId);
  await recomputeScore(supabase, lead.id as string, "Converted from signup");

  revalidatePath("/signups");
  revalidatePath("/leads");
  revalidatePath("/");
  return ok({ leadId: lead.id as string });
}

export async function convertAllSignups(signupIds: string[]): Promise<ActionResult<{ converted: number }>> {
  let converted = 0;
  for (const id of signupIds) {
    const res = await convertSignup(id);
    if (res.ok) converted += 1;
  }
  return ok({ converted });
}
