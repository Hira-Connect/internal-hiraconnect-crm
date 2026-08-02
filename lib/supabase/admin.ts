import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";
import { inspectServiceKey, serviceKeyMessage, type ServiceKeyStatus } from "../service-key";

/** Why this exists: creating a login and minting a password-reset link are admin
 *  operations. The anon key cannot do either — they need the service-role key,
 *  which bypasses RLS entirely.
 *
 *  Rules for anything that touches this client:
 *    - server only (this module is `server-only`; never import it from a component)
 *    - re-check the caller's role first — RLS is not there to catch a mistake
 *    - never write profile role/team/is_active through it: the
 *      crm_guard_profile_update trigger silently reverts those for a caller that
 *      is not an admin *profile*, and service_role has no profile. Do those
 *      writes with the acting admin's own session client instead.
 *
 *  The key is validated before a client is built. A key that cannot work is not
 *  worth a network round-trip: Supabase answers a wrong one with 403 "User not
 *  allowed", which reads as a permission problem with the signed-in admin rather
 *  than what it is — a variable holding the wrong secret.
 */

let cached: SupabaseClient | null = null;

export function serviceKeyStatus(): ServiceKeyStatus {
  return inspectServiceKey({
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: SUPABASE_ANON_KEY,
    supabaseUrl: SUPABASE_URL,
  });
}

/** One sentence naming what to fix, or null when the key is usable. */
export function serviceKeyError(): string | null {
  return serviceKeyMessage(serviceKeyStatus());
}

/** Null unless the key is present *and* shaped like a service-role key, so
 *  callers surface a precise message instead of an opaque 403. */
export function createAdminClient(): SupabaseClient | null {
  if (serviceKeyStatus().status !== "ok") return null;
  cached ??= createSupabaseClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}

/** Translates a Supabase admin-API failure into something an operator can act
 *  on. A key can pass inspection and still be rejected — revoked, rotated, or
 *  disabled with the project's legacy JWT keys — and "User not allowed" says
 *  nothing useful to the admin reading it. */
export function describeAdminError(error: { message?: string; status?: number } | null): string {
  if (!error) return "Supabase rejected the request.";
  const message = error.message ?? "Supabase rejected the request.";

  if (error.status === 403 || /user not allowed/i.test(message)) {
    return (
      "Supabase refused the admin call: the key in SUPABASE_SERVICE_ROLE_KEY is not a service-role key. " +
      "This is a server configuration problem, not a limit on your account."
    );
  }
  if (error.status === 401 || /invalid api key|jwt/i.test(message)) {
    return (
      "Supabase rejected the service-role key outright — it may have been rotated or revoked. " +
      "Copy the current one from Project Settings → API and redeploy."
    );
  }
  return message;
}
