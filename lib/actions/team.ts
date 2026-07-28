"use server";

import { revalidatePath } from "next/cache";
import { currentActor, emptyToNull, fail, ok, type ActionResult } from "./shared";
import type { Role } from "../types";

const ROLE_VALUES: Role[] = ["admin", "manager", "rep"];

/* ------------------------------------------------------------------ users */

/** Role, team and active-flag changes. The database enforces this too — the
 *  profiles_guard_update trigger silently reverts these fields for non-admins,
 *  so this check is about showing a clear error rather than a silent no-op. */
export async function updateMember(
  memberId: string,
  patch: { role?: Role; teamId?: string | null; isActive?: boolean },
): Promise<ActionResult> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile || profile.role !== "admin") return fail("Only admins can manage users.");

  if (patch.role && !ROLE_VALUES.includes(patch.role)) return fail("Unknown role.");

  // never let the last admin demote or deactivate themselves out of the system
  if (memberId === userId && (patch.role === "rep" || patch.role === "manager" || patch.isActive === false)) {
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("is_active", true);
    if ((count ?? 0) <= 1) {
      return fail("You are the only active admin — promote someone else first.");
    }
  }

  const update: Record<string, unknown> = {};
  if (patch.role) update.role = patch.role;
  if (patch.teamId !== undefined) update.team_id = patch.teamId;
  if (patch.isActive !== undefined) update.is_active = patch.isActive;
  if (!Object.keys(update).length) return ok();

  const { error } = await supabase.from("profiles").update(update).eq("id", memberId);
  if (error) return fail(error.message);

  // keep denormalised lead.team_id aligned with the owner's new team
  if (patch.teamId !== undefined) {
    await supabase.from("leads").update({ team_id: patch.teamId }).eq("owner_id", memberId);
  }

  revalidatePath("/team");
  revalidatePath("/leads");
  return ok();
}

/** Self-service profile edit — name and phone only. */
export async function updateMyProfile(formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");

  const fullName = emptyToNull(formData.get("full_name"));
  if (!fullName) return fail("Name is required.");

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, phone: emptyToNull(formData.get("phone")) })
    .eq("id", userId);
  if (error) return fail(error.message);

  revalidatePath("/team");
  revalidatePath("/settings");
  return ok();
}

/* ------------------------------------------------------------------ teams */

export async function createTeam(formData: FormData): Promise<ActionResult> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile || profile.role !== "admin") return fail("Only admins can create teams.");

  const name = emptyToNull(formData.get("name"));
  if (!name) return fail("Team name is required.");

  const { error } = await supabase.from("teams").insert({
    name,
    description: emptyToNull(formData.get("description")),
    manager_id: emptyToNull(formData.get("manager_id")),
  });
  if (error) return fail(error.message);

  revalidatePath("/team");
  return ok();
}

export async function updateTeam(teamId: string, formData: FormData): Promise<ActionResult> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile || profile.role !== "admin") return fail("Only admins can edit teams.");

  const name = emptyToNull(formData.get("name"));
  if (!name) return fail("Team name is required.");

  const { error } = await supabase
    .from("teams")
    .update({
      name,
      description: emptyToNull(formData.get("description")),
      manager_id: emptyToNull(formData.get("manager_id")),
    })
    .eq("id", teamId);
  if (error) return fail(error.message);

  revalidatePath("/team");
  return ok();
}

export async function deleteTeam(teamId: string): Promise<ActionResult> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile || profile.role !== "admin") return fail("Only admins can delete teams.");

  const { count } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("team_id", teamId);
  if ((count ?? 0) > 0) return fail("Move the team's members somewhere else first.");

  const { error } = await supabase.from("teams").delete().eq("id", teamId);
  if (error) return fail(error.message);

  revalidatePath("/team");
  return ok();
}
