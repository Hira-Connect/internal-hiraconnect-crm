import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

/** Next 16's replacement for middleware.ts. Refreshes the Supabase auth cookie on
 *  every request and redirects signed-out users to /login. */
export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /* everything except static assets and images */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
