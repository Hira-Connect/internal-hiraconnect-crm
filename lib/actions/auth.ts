"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { createClient } from "../supabase/server";
import { createAdminClient } from "../supabase/admin";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../supabase/env";
import { confirmUrl, siteOrigin } from "../auth-links";
import { MAIL_NOT_CONFIGURED, mailerConfigured, sendMail } from "../email/send";
import { passwordResetEmail } from "../email/templates";

export interface AuthState {
  error: string | null;
  done?: boolean;
}

/** Long enough to be worth having, short enough that nobody writes it on a sticky note. */
const MIN_PASSWORD = 8;

/** Ignore a second reset request inside this window — one click, one email. */
const RESET_COOLDOWN_MS = 60_000;

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect(next.startsWith("/") ? next : "/");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/* --------------------------------------------------------- forgotten password */

/** Emails a one-time link to /auth/confirm, which signs the person in just long
 *  enough to set a new password.
 *
 *  The reply is deliberately the same whether or not the address has an account
 *  — a sign-in page should not confirm who works here. The two exceptions are
 *  server misconfiguration and a mail-transport failure, which are our problem
 *  to fix and useless to hide.
 */
export async function sendPasswordReset(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Enter your email address." };

  const admin = createAdminClient();
  if (!admin) {
    return { error: "Password reset is not set up on this server yet — ask an admin to finish the setup." };
  }

  // ilike keeps a capitalised address working; escape the LIKE wildcards first.
  const { data: rows } = await admin
    .from("profiles")
    .select("id,is_active")
    .ilike("email", email.replace(/[%_]/g, (c) => `\\${c}`))
    .limit(1);

  const profile = rows?.[0] as { id: string; is_active: boolean } | undefined;
  if (!profile?.is_active) {
    // Same reply as success, so the sign-in page cannot be used to find out who
    // works here — but say so in the log, because "no account with that address"
    // and "the mail failed" look identical from the outside.
    console.warn(`[auth] reset requested for ${email}: no active CRM profile, nothing sent`);
    return { error: null, done: true };
  }

  // Checked before the cooldown on purpose. A deployment with no transport must
  // say so on every attempt — otherwise the first click reports the real problem
  // and every one after it replies "on its way" from a server that cannot send.
  if (!mailerConfigured()) {
    return { error: `We could not send the email — ${MAIL_NOT_CONFIGURED}` };
  }

  const { data: found } = await admin.auth.admin.getUserById(profile.id);
  const lastSent = (found?.user as { recovery_sent_at?: string } | null)?.recovery_sent_at;
  if (lastSent && Date.now() - new Date(lastSent).getTime() < RESET_COOLDOWN_MS) {
    return { error: null, done: true };
  }

  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (error || !data) {
    // Past this point the account is known to exist, so reporting the failure
    // gives an attacker nothing new — and staying quiet here was hiding a real
    // server fault behind a cheerful "it is on its way".
    console.error(`[auth] could not mint a recovery link for ${email}: ${error?.message ?? "no data"}`);
    return { error: `We could not create the reset link — ${error?.message ?? "unknown error"}` };
  }

  const link = confirmUrl(await siteOrigin(), {
    tokenHash: data.properties.hashed_token,
    type: "recovery",
  });

  const mail = passwordResetEmail({ link });
  const result = await sendMail({ ...mail, to: email });

  if (!result.sent) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[auth] reset email not sent (${result.reason}). Link: ${link}`);
    }
    return { error: `We could not send the email — ${result.reason}` };
  }

  return { error: null, done: true };
}

/* ------------------------------------------------------------ setting a password */

/** Completes a reset or an invitation: the /auth/confirm handler has already put
 *  a session in place, so this is just the write. */
export async function updatePassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < MIN_PASSWORD) return { error: `Use at least ${MIN_PASSWORD} characters.` };
  if (password !== confirm) return { error: "The two passwords do not match." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "That link has expired. Request a new one from the sign-in page." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect("/?password=updated");
}

/** Rotating your own password while signed in. Asks for the current one first:
 *  without that, anyone who finds an unlocked laptop owns the account. */
export async function changeMyPassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const current = String(formData.get("current") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!current) return { error: "Enter your current password." };
  if (password.length < MIN_PASSWORD) return { error: `Use at least ${MIN_PASSWORD} characters.` };
  if (password !== confirm) return { error: "The two new passwords do not match." };
  if (password === current) return { error: "That is already your password." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "You are not signed in." };

  // Check the current password on a throwaway client, so a wrong guess cannot
  // touch the session cookie this request is running on.
  const probe = createPlainClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: wrong } = await probe.auth.signInWithPassword({ email: user.email, password: current });
  if (wrong) return { error: "That is not your current password." };
  // `local` and not the default `global`: a global sign-out revokes every
  // refresh token the user has, which would kick them off their own browser.
  await probe.auth.signOut({ scope: "local" });

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { error: null, done: true };
}
