import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Landing point for Supabase email links (password recovery, invites).
 *  Exchanges the one-time code for a session cookie, then forwards on. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const errorDescription = searchParams.get("error_description");
  const next = searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") ? next : "/";

  if (errorDescription) {
    return NextResponse.redirect(`${origin}/login?reason=${encodeURIComponent(errorDescription)}`);
  }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${safeNext}`);
    return NextResponse.redirect(`${origin}/login?reason=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${origin}/login?reason=${encodeURIComponent("That link is no longer valid.")}`);
}
