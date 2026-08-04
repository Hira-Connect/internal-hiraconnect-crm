import type { Metadata } from "next";
import Link from "next/link";
import { ImportWizard } from "@/components/leads/import-wizard";
import { Badge, EmptyState, Panel } from "@/components/ui/primitives";
import { getImportBatches, requireProfile } from "@/lib/queries";
import { displayName, formatDateTime, plural } from "@/lib/format";
import type { BatchStatus, ImportBatchRow } from "@/lib/import/types";

export const metadata: Metadata = { title: "Bulk lead upload" };

/** Each chunk writes a handful of leads through the ordinary lead actions, which
 *  is several round-trips per row. 60s gives a chunk plenty of headroom without
 *  ever holding a request open for a whole file. */
export const maxDuration = 60;

const STATUS_TONE: Record<BatchStatus, "neutral" | "brand" | "success" | "warning" | "danger"> = {
  pending: "neutral",
  validating: "neutral",
  processing: "brand",
  completed: "success",
  partially_completed: "warning",
  failed: "danger",
  cancelled: "neutral",
};

/** The shell must survive the import migration not being applied yet — the rest
 *  of the CRM keeps working, and the panel says what to do. */
async function safeBatches(): Promise<{ batches: ImportBatchRow[]; error: string | null }> {
  try {
    return { batches: await getImportBatches(25), error: null };
  } catch (error) {
    return {
      batches: [],
      error: error instanceof Error ? error.message : "Upload history could not be loaded.",
    };
  }
}

export default async function LeadImportPage() {
  const [me, { batches, error }] = await Promise.all([requireProfile(), safeBatches()]);

  return (
    <div className="space-y-4">
      <header>
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-xl">Bulk lead upload</h1>
          <Link href="/leads" className="text-xs text-brand-500 hover:underline">
            ← back to leads
          </Link>
        </div>
        <p className="text-xs text-muted">
          Download the template, fill it in, and upload it. You see exactly what will be created, updated or
          skipped before anything is written — and re-uploading the same file never doubles a lead.
        </p>
      </header>

      <ImportWizard />

      <Panel
        title="Upload history"
        subtitle={
          me.role === "rep" ? "Your uploads." : "Every upload you and your team have run, newest first."
        }
      >
        {error ? (
          <EmptyState
            title="Upload history is unavailable"
            hint={`${error} If this is a fresh deployment, run supabase db push to apply the lead-import migration.`}
          />
        ) : batches.length === 0 ? (
          <EmptyState title="No uploads yet" hint="Your first bulk upload will be listed here." />
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-app text-left">
                  <Th>File</Th>
                  <Th>Uploaded</Th>
                  <Th>By</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Rows</Th>
                  <Th className="text-right">Created</Th>
                  <Th className="text-right">Updated</Th>
                  <Th className="text-right">Skipped</Th>
                  <Th className="text-right">Rejected</Th>
                  <Th className="text-right">Failed</Th>
                  <Th>Report</Th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => {
                  const problems = batch.invalid_count + batch.failed_count + batch.skipped_count;
                  return (
                    <tr key={batch.id} className="border-b border-app last:border-0 hover:surface-alt">
                      <td className="px-3 py-2">
                        <span className="font-medium">{batch.file_name}</span>
                        {batch.first_failed_row !== null && (
                          <div className="text-[11px] text-red-600 dark:text-red-400">
                            first failure at row {batch.first_failed_row}
                          </div>
                        )}
                        {batch.error && <div className="text-[11px] text-muted">{batch.error}</div>}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">{formatDateTime(batch.created_at)}</td>
                      <td className="px-3 py-2 text-xs">{displayName(batch.creator)}</td>
                      <td className="px-3 py-2">
                        <Badge tone={STATUS_TONE[batch.status] ?? "neutral"}>
                          {batch.status.replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{batch.total_rows}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{batch.created_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{batch.updated_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{batch.skipped_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{batch.invalid_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{batch.failed_count}</td>
                      <td className="px-3 py-2">
                        {problems > 0 ? (
                          <a
                            href={`/api/leads/import/${batch.id}/report`}
                            download
                            className="text-xs text-brand-500 hover:underline"
                          >
                            {plural(problems, "row")}
                          </a>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase whitespace-nowrap ${className ?? ""}`}
    >
      {children}
    </th>
  );
}
