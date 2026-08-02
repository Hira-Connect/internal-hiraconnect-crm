"use server";

import { revalidatePath } from "next/cache";
import { currentActor, emptyToNull, fail, ok, type ActionResult } from "./shared";
import { SERVICE_KEY_MISSING, createAdminClient } from "../supabase/admin";
import { confirmUrl, siteOrigin } from "../auth-links";
import { sendMail } from "../email/send";
import { inviteEmail, passwordResetEmail } from "../email/templates";
import { roleLabel } from "../permissions";
import { displayName } from "../format";
import type { Role } from "../types";

const ROLE_VALUES: Role[] = ["admin", "manager", "rep"];

/** Escapes the LIKE wildcards so an address containing `_` cannot match others. */
function likeSafe(value: string): string {
  return value.replace(/[%_]/g, (c) => `\\${c}`);
}

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

/* ---------------------------------------------------------------- invites */

export interface InviteOutcome {
  email: string;
  /** False when no mail transport is configured, or the send failed. */
  emailed: boolean;
  /** Only populated when the email did not go out, so an admin can pass the
   *  link on by hand. It is a one-time credential — never show it otherwise. */
  link: string;
  reason: string | null;
}

/** Creates the login and emails a one-time link to set a password.
 *
 *  Supabase mints the account and the token; this app sends the mail, so the
 *  link points at our own /auth/confirm rather than through GoTrue's redirect
 *  allow-list.
 */
export async function inviteMember(formData: FormData): Promise<ActionResult<InviteOutcome>> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile || profile.role !== "admin") return fail("Only admins can invite people.");

  const email = (emptyToNull(formData.get("email")) ?? "").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid email address.");

  const fullName = emptyToNull(formData.get("full_name"));
  const role = (emptyToNull(formData.get("role")) ?? "rep") as Role;
  if (!ROLE_VALUES.includes(role)) return fail("Unknown role.");
  const teamId = emptyToNull(formData.get("team_id"));

  const admin = createAdminClient();
  if (!admin) return fail(SERVICE_KEY_MISSING);

  const { data: already } = await supabase
    .from("profiles")
    .select("id")
    .ilike("email", likeSafe(email))
    .limit(1);
  if (already?.length) return fail(`${email} is already on the team.`);

  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: fullName ? { data: { full_name: fullName } } : undefined,
  });
  if (error || !data?.user) return fail(error?.message ?? "Could not create the invitation.");

  // handle_new_user has already inserted the profile as a rep. Role, team and
  // name are written with the admin's OWN client on purpose: the
  // crm_guard_profile_update trigger silently reverts those three columns for
  // any caller it cannot see as an admin profile, and service_role has none.
  const patch: Record<string, unknown> = { role, team_id: teamId };
  if (fullName) patch.full_name = fullName;

  const { data: updated } = await supabase.from("profiles").update(patch).eq("id", data.user.id).select("id");
  if (!updated?.length) {
    await supabase.from("profiles").insert({ id: data.user.id, email, full_name: fullName, ...patch });
  }

  const link = confirmUrl(await siteOrigin(), {
    tokenHash: data.properties.hashed_token,
    type: "invite",
    next: "/auth/update-password?welcome=1",
  });
  const mail = inviteEmail({ link, invitedBy: displayName(profile), roleLabel: roleLabel(role) });
  const result = await sendMail({ ...mail, to: email });

  revalidatePath("/team");
  return ok<InviteOutcome>({
    email,
    emailed: result.sent,
    link: result.sent ? "" : link,
    reason: result.sent ? null : result.reason,
  });
}

/** Re-issues the link for someone who never accepted — or a reset link for
 *  someone who did. Issuing a new one invalidates the previous link. */
export async function resendInvite(memberId: string): Promise<ActionResult<InviteOutcome>> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile || profile.role !== "admin") return fail("Only admins can resend invitations.");

  const admin = createAdminClient();
  if (!admin) return fail(SERVICE_KEY_MISSING);

  const { data: found, error: lookupError } = await admin.auth.admin.getUserById(memberId);
  const account = found?.user;
  if (lookupError || !account?.email) return fail("That account no longer exists in Supabase Auth.");

  const type = account.email_confirmed_at ? "recovery" : "invite";
  const { data, error } = await admin.auth.admin.generateLink({ type, email: account.email });
  if (error || !data) return fail(error?.message ?? "Could not create the link.");

  const link = confirmUrl(await siteOrigin(), {
    tokenHash: data.properties.hashed_token,
    type,
    next: type === "invite" ? "/auth/update-password?welcome=1" : "/auth/update-password",
  });

  const { data: target } = await supabase.from("profiles").select("role").eq("id", memberId).maybeSingle();
  const mail =
    type === "invite"
      ? inviteEmail({
          link,
          invitedBy: displayName(profile),
          roleLabel: roleLabel((target?.role as Role | undefined) ?? "rep"),
        })
      : passwordResetEmail({ link });
  const result = await sendMail({ ...mail, to: account.email });

  revalidatePath("/team");
  return ok<InviteOutcome>({
    email: account.email,
    emailed: result.sent,
    link: result.sent ? "" : link,
    reason: result.sent ? null : result.reason,
  });
}

/** Removes an account that never accepted its invitation — a typo'd address,
 *  or someone who left before their first sign-in. Deleting the auth user
 *  cascades the profile away. Accepted accounts are deactivated, never deleted,
 *  so their leads and timeline entries keep their author. */
export async function cancelInvite(memberId: string): Promise<ActionResult> {
  const { profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile || profile.role !== "admin") return fail("Only admins can cancel invitations.");
  if (memberId === userId) return fail("You cannot remove your own account.");

  const admin = createAdminClient();
  if (!admin) return fail(SERVICE_KEY_MISSING);

  const { data: found } = await admin.auth.admin.getUserById(memberId);
  if (!found?.user) return fail("That account no longer exists in Supabase Auth.");
  if (found.user.email_confirmed_at) {
    return fail("They have already signed in — deactivate the account instead of deleting it.");
  }

  const { error } = await admin.auth.admin.deleteUser(memberId);
  if (error) return fail(error.message);

  revalidatePath("/team");
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
