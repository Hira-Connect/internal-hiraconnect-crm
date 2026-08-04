import { NextResponse } from "next/server";
import { buildErrorReport } from "@/lib/import/workbook";
import { getImportBatch, getImportRows, requireProfile } from "@/lib/queries";

/** The error report for one upload: every row that was rejected, skipped or
 *  failed, laid out in the template's own columns so it can be corrected and
 *  uploaded again as-is.
 *
 *  Access is decided by RLS — the batch simply does not exist for someone who
 *  may not see it — and the file is generated on the fly, so there is no stored
 *  object and no URL to leak. */
export async function GET(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const me = await requireProfile();
  if (!me.is_active) {
    return NextResponse.json({ error: "Your account is not active." }, { status: 403 });
  }

  const batch = await getImportBatch(batchId);
  if (!batch) {
    return NextResponse.json({ error: "That upload could not be found." }, { status: 404 });
  }

  const rows = await getImportRows(batchId, ["invalid", "failed", "skipped"]);
  const bytes = await buildErrorReport(batch, rows);

  const safeName = batch.file_name.replace(/\.xlsx$/i, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);

  return new NextResponse(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName || "upload"}-errors.xlsx"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
