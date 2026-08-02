import "server-only";

import { headers } from "next/headers";

/** Where the emailed links point.
 *
 *  `NEXT_PUBLIC_SITE_URL` wins when it is set — a Vercel preview deployment must
 *  not email people a link into the preview. Without it we fall back to the
 *  request's own origin, which is right on localhost and on a single-domain
 *  production deployment.
 */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "http://localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export type ConfirmType = "invite" | "recovery";

/** A link into our own /auth/confirm handler, carrying the one-time token hash
 *  Supabase minted. Deliberately not a Supabase `/auth/v1/verify` URL: those go
 *  through GoTrue's redirect allow-list, and drop the destination on the floor
 *  (falling back to Site URL) when it is not listed. */
export function confirmUrl(
  origin: string,
  { tokenHash, type, next = "/auth/update-password" }: { tokenHash: string; type: ConfirmType; next?: string },
): string {
  const params = new URLSearchParams({ token_hash: tokenHash, type, next });
  return `${origin}/auth/confirm?${params.toString()}`;
}
