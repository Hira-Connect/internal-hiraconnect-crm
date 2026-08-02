/** Validation for the Supabase service-role key. Pure — no I/O, no env reads —
 *  so it can be unit-tested and called from anywhere.
 *
 *  Why this exists: the anon key and the service-role key are two long JWTs on
 *  the same dashboard page, and swapping them is silent. The app boots, the
 *  variable is "present", and the mistake only shows up as GoTrue's 403
 *  "User not allowed" — a message that is actively misleading to an admin who
 *  is, in fact, an admin.
 *
 *  The key describes itself, so we do not need a network round-trip to know it
 *  is wrong. Parse it, and refuse to build a client that cannot work.
 */

export type ServiceKeyStatus =
  | { status: "ok"; kind: "jwt" | "secret" }
  | { status: "missing" }
  | { status: "invalid"; reason: string; hint: string };

export interface ServiceKeyInput {
  serviceKey: string | undefined;
  anonKey: string | undefined;
  supabaseUrl: string | undefined;
}

const DASHBOARD = "Supabase dashboard → Project Settings → API → service_role";

/** Decodes a JWT payload without verifying it. We are not authenticating
 *  anything here — only reading what the key claims to be, to catch an operator
 *  mistake before it becomes a 403. */
export function jwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** `https://abcdefgh.supabase.co` → `abcdefgh` */
export function projectRef(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    return new URL(supabaseUrl).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

export function inspectServiceKey({ serviceKey, anonKey, supabaseUrl }: ServiceKeyInput): ServiceKeyStatus {
  const key = serviceKey?.trim();
  if (!key) return { status: "missing" };

  // The single most likely mistake, and the one that produced "User not allowed".
  if (anonKey && key === anonKey.trim()) {
    return {
      status: "invalid",
      reason: "It holds the anon key, not the service-role key.",
      hint: `Both are long JWTs on the same page — copy the second one, from ${DASHBOARD}.`,
    };
  }

  // Newer projects issue opaque keys instead of JWTs.
  if (key.startsWith("sb_publishable_")) {
    return {
      status: "invalid",
      reason: "It holds a publishable key, which has no admin rights.",
      hint: `Use the secret key (sb_secret_…) from ${DASHBOARD}.`,
    };
  }
  if (key.startsWith("sb_secret_")) return { status: "ok", kind: "secret" };

  const claims = jwtClaims(key);
  if (!claims) {
    return {
      status: "invalid",
      reason: "It is neither a JWT nor an sb_secret_… key.",
      hint: `Check for a truncated paste or stray quotes, then re-copy it from ${DASHBOARD}.`,
    };
  }

  const role = typeof claims.role === "string" ? claims.role : null;
  if (role !== "service_role") {
    return {
      status: "invalid",
      reason: `The key's role is "${role ?? "unknown"}", but admin calls need "service_role".`,
      hint: `Copy the service_role key from ${DASHBOARD}.`,
    };
  }

  const ref = projectRef(supabaseUrl);
  const keyRef = typeof claims.ref === "string" ? claims.ref : null;
  if (ref && keyRef && ref !== keyRef) {
    return {
      status: "invalid",
      reason: `The key belongs to project "${keyRef}", but this app points at "${ref}".`,
      hint: "Copy the key from the same project as NEXT_PUBLIC_SUPABASE_URL.",
    };
  }

  return { status: "ok", kind: "jwt" };
}

/** One operator-facing sentence, or null when the key is usable. */
export function serviceKeyMessage(status: ServiceKeyStatus): string | null {
  switch (status.status) {
    case "ok":
      return null;
    case "missing":
      return (
        "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment, so invitations and password resets " +
        "are disabled. Add it in Vercel → Settings → Environment Variables (server-side, never " +
        "NEXT_PUBLIC_), then redeploy — Vercel only applies variable changes to new deployments."
      );
    case "invalid":
      return `SUPABASE_SERVICE_ROLE_KEY is set, but it is the wrong key. ${status.reason} ${status.hint}`;
  }
}
