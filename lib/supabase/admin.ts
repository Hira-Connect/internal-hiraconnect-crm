import "server-only";

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

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
 */

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const SERVICE_KEY_MISSING =
  "Account emails are not configured on the server: SUPABASE_SERVICE_ROLE_KEY is missing. " +
  "Add it in Vercel → Settings → Environment Variables (server-side, never NEXT_PUBLIC_) and redeploy.";

let cached: SupabaseClient | null = null;

/** Returns null when the key is not set, so callers can show a fixable message
 *  rather than crashing a whole page. */
export function createAdminClient(): SupabaseClient | null {
  if (!SERVICE_KEY) return null;
  cached ??= createSupabaseClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}

export function hasServiceKey(): boolean {
  return Boolean(SERVICE_KEY);
}
