import { NextResponse } from "next/server";
import { buildTemplate } from "@/lib/import/workbook";
import { getProfiles, getStages, requireProfile } from "@/lib/queries";
import { assignableOwners } from "@/lib/permissions";

/** The bulk-upload template, generated per request so its dropdowns always match
 *  the stages that exist today and the people this user may actually assign to.
 *
 *  `proxy.ts` already refuses anonymous requests; the profile check here is the
 *  second lock, because a route handler must never rely on the first one alone. */
export async function GET() {
  const me = await requireProfile();
  if (!me.is_active) {
    return NextResponse.json({ error: "Your account is not active." }, { status: 403 });
  }

  const [stages, profiles] = await Promise.all([getStages(), getProfiles()]);

  const bytes = await buildTemplate({
    stages: stages.filter((s) => s.is_active).map((s) => ({ key: s.key, category: s.category })),
    ownerEmails: assignableOwners(me, profiles)
      .map((p) => p.email)
      .filter((email): email is string => Boolean(email)),
  });

  return new NextResponse(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="hira-connect-lead-upload-template.xlsx"',
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
