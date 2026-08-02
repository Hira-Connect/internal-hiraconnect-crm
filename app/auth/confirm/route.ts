import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/** Landing point for the invite and password-reset links this app emails.
 *
 *  Verifying a `token_hash` server-side works from any browser on any device —
 *  unlike the PKCE `?code=` flow, which only completes in the same browser that
 *  asked for the reset, and unlike the implicit flow, which hides the token in a
 *  URL fragment the server never receives.
 */

const ALLOWED: EmailOtpType[] = ["invite", "recovery", "email", "magiclink", "signup", "email_change"];

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // Same-origin paths only — "//evil.com" is protocol-relative, not a path.
  const next = searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  const bounce = (reason: string) =>
    NextResponse.redirect(`${origin}/login?reason=${encodeURIComponent(reason)}`);

  if (!tokenHash || !type || !ALLOWED.includes(type)) {
    return bounce("That link is incomplete. Ask for a new one.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    // Single-use and short-lived: an expired link, a reused one, or one an email
    // scanner opened first all land here.
    return bounce(
      type === "invite"
        ? "That invitation link has already been used or has expired. Ask an admin to resend it."
        : "That reset link has already been used or has expired. Request a new one below.",
    );
  }

  return NextResponse.redirect(`${origin}${safeNext}`);
}
