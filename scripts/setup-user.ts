/**
 * Create (or repair) a CRM login.
 *
 *   npm run setup:user -- --email you@hiraconnect.com --password 'secret' --name 'Your Name' --role admin
 *
 * Does three things the Supabase dashboard's "Add user" button does not:
 *   1. confirms the email immediately, so sign-in is not blocked by a verification step
 *   2. resets the password if the account already exists
 *   3. sets the profile role — a user created AFTER the v2 migrations is a `rep`
 *      by default, and a rep cannot reach the Team screen to promote themselves
 *
 * Needs the service-role key, which bypasses RLS. Keep it out of the browser:
 * it is SUPABASE_SERVICE_ROLE_KEY, never NEXT_PUBLIC_*.
 */

import { createClient } from "@supabase/supabase-js";

type Role = "admin" | "manager" | "rep";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function die(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

// pick up .env.local without adding a dotenv dependency
try {
  process.loadEnvFile(".env.local");
} catch {
  /* fine — the variables may already be exported in the shell */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) die("NEXT_PUBLIC_SUPABASE_URL is not set. Check .env.local.");
if (!serviceKey) {
  die(
    "SUPABASE_SERVICE_ROLE_KEY is not set.\n" +
      "  Supabase dashboard → Project Settings → API → service_role key.\n" +
      "  Add it to .env.local (it is gitignored, and must NOT be prefixed NEXT_PUBLIC_).",
  );
}

const email = arg("email");
const password = arg("password");
const name = arg("name") ?? email?.split("@")[0] ?? "";
const role = (arg("role") ?? "admin") as Role;

if (!email || !password) die("Usage: --email <address> --password <password> [--name <name>] [--role admin|manager|rep]");
if (password.length < 6) die("Supabase requires at least 6 characters.");
if (!["admin", "manager", "rep"].includes(role)) die(`Unknown role "${role}".`);

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // 1. find or create the auth user
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) die(`Could not list users: ${listError.message}`);

  const existing = list.users.find((u) => u.email?.toLowerCase() === email!.toLowerCase());
  let userId: string;

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { ...existing.user_metadata, full_name: name },
    });
    if (error) die(`Could not update the account: ${error.message}`);
    userId = existing.id;
    console.log(`✓ Updated existing account ${email} (password reset, email confirmed)`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
    });
    if (error || !data.user) die(`Could not create the account: ${error?.message ?? "unknown error"}`);
    userId = data.user.id;
    console.log(`✓ Created account ${email}`);
  }

  // 2. make sure the profile exists with the right role
  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ id: userId, email, full_name: name, role, is_active: true }, { onConflict: "id" });

  if (profileError) {
    if (/relation .*profiles.* does not exist|schema cache|PGRST/i.test(profileError.message)) {
      console.log(
        "\n! The profiles table does not exist yet, so no role was set.\n" +
          "  Run `supabase db push` — its backfill makes every existing user an admin,\n" +
          "  which covers this account.",
      );
    } else {
      die(`Account is ready but the profile could not be set: ${profileError.message}`);
    }
  } else {
    console.log(`✓ Profile set to ${role}`);
  }

  // 3. attach to a team if one exists and the profile has none
  const { data: profile } = await admin.from("profiles").select("team_id").eq("id", userId).maybeSingle();
  if (profile && !profile.team_id) {
    const { data: team } = await admin.from("teams").select("id").order("name").limit(1).maybeSingle();
    if (team) {
      await admin.from("profiles").update({ team_id: team.id }).eq("id", userId);
      console.log("✓ Added to the default team");
    }
  }

  console.log(`\nDone. Sign in at /login as ${email}.\n`);
}

main().catch((e: unknown) => die(e instanceof Error ? e.message : String(e)));
