"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelImport, prepareImport, processChunk, retryFailedRows } from "@/lib/actions/imports";
import { Badge, Banner, Button, LinkButton, Meter, Panel, buttonClass } from "@/components/ui/primitives";
import { actionErrorClass } from "@/components/ui/use-action";
import { MAX_FILE_BYTES, MAX_ROWS, headerFor } from "@/lib/import/schema";
import { cn, formatDateTime, plural } from "@/lib/format";
import type { ChunkProgress, ValidationPreview } from "@/lib/import/types";

type Phase = "pick" | "validating" | "review" | "processing" | "done";

const TEMPLATE_URL = "/api/leads/import/template";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** A plain anchor, not next/link: these URLs stream a generated .xlsx, and a
 *  router prefetch on hover would build the file for nothing. */
function DownloadLink({
  href,
  children,
  variant = "secondary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "secondary" | "gold";
}) {
  return (
    <a href={href} download className={buttonClass(variant, "sm")}>
      {children}
    </a>
  );
}

function formatDuration(ms: number | null): string {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function ImportWizard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  /** Set when the user asks to stop; the chunk loop checks it between rounds. */
  const stopRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<ValidationPreview | null>(null);
  const [progress, setProgress] = useState<ChunkProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reset = () => {
    stopRef.current = false;
    setPhase("pick");
    setFile(null);
    setPreview(null);
    setProgress(null);
    setError(null);
    setNotice(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  /* ------------------------------------------------------------- validate */
  const validate = useCallback(async (chosen: File) => {
    setError(null);
    setNotice(null);
    setFile(chosen);

    if (!chosen.name.toLowerCase().endsWith(".xlsx")) {
      setError("Only .xlsx files are accepted. Download the template and fill that in.");
      return;
    }
    if (chosen.size > MAX_FILE_BYTES) {
      setError(`That file is ${formatBytes(chosen.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)}.`);
      return;
    }

    setPhase("validating");
    const data = new FormData();
    data.set("file", chosen);
    try {
      const result = await prepareImport(data);
      if (!result.ok) {
        setError(result.error);
        setPhase("pick");
        return;
      }
      setPreview(result.data!);
      setPhase("review");
    } catch {
      setError("The file could not be sent to the server. Check your connection and try again.");
      setPhase("pick");
    }
  }, []);

  /* -------------------------------------------------------------- process */
  const runChunks = useCallback(
    async (batchId: string) => {
      stopRef.current = false;
      setPhase("processing");
      setError(null);

      for (;;) {
        let result;
        try {
          result = await processChunk(batchId);
        } catch {
          setError(
            "The connection dropped while processing. Nothing already written is lost — press “Continue” to pick up from the next unprocessed row.",
          );
          setPhase("done");
          return;
        }
        if (!result.ok) {
          setError(result.error);
          setPhase("done");
          return;
        }
        setProgress(result.data!);
        if (!result.data!.hasMore) break;
        if (stopRef.current) {
          setNotice("Stopped. Rows already processed are saved — press “Continue” to finish the rest.");
          break;
        }
      }

      setPhase("done");
      router.refresh();
    },
    [router],
  );

  const retry = async (batchId: string) => {
    setError(null);
    setNotice(null);
    const result = await retryFailedRows(batchId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(`Re-queued ${plural(result.data!.queued, "row")}.`);
    await runChunks(batchId);
  };

  const discard = async (batchId: string) => {
    await cancelImport(batchId);
    router.refresh();
    reset();
  };

  /* ----------------------------------------------------------------- view */
  return (
    <div className="space-y-4">
      <Panel
        title="1 · Start from the template"
        subtitle="The upload matches columns by name, so the template's header row is the contract."
        action={
          <DownloadLink href={TEMPLATE_URL} variant="gold">
            Download Excel template
          </DownloadLink>
        }
      >
        <ul className="grid gap-1.5 text-xs text-muted sm:grid-cols-2">
          <li>Only <strong>Name</strong> has to be filled in. Everything else is optional.</li>
          <li>
            <strong>Email</strong> identifies a lead: a row whose email already exists updates that lead
            instead of adding a second one.
          </li>
          <li>A blank cell on an update means “leave this as it is”.</li>
          <li>Up to {MAX_ROWS.toLocaleString("en-IN")} rows and {formatBytes(MAX_FILE_BYTES)} per file.</li>
        </ul>
      </Panel>

      {/* ------------------------------------------------------------ upload */}
      {(phase === "pick" || phase === "validating") && (
        <Panel title="2 · Upload your file">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) void validate(dropped);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
              dragging ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-app",
            )}
          >
            <p className="text-sm font-medium">Drop the filled-in .xlsx here</p>
            <p className="text-xs text-muted">or</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={phase === "validating"}
              onClick={() => inputRef.current?.click()}
            >
              Choose a file
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                if (chosen) void validate(chosen);
              }}
            />
            {file && (
              <p className="mt-2 text-xs text-muted">
                <span className="font-medium text-[var(--text)]">{file.name}</span> · {formatBytes(file.size)}
                {phase === "validating" && " · checking every row…"}
              </p>
            )}
          </div>
          {error && <p className={actionErrorClass()}>{error}</p>}
        </Panel>
      )}

      {/* ---------------------------------------------------------- preview */}
      {phase === "review" && preview && (
        <Panel
          title="3 · Check what will happen"
          subtitle={`${preview.fileName} · ${formatBytes(preview.fileSize)} · ${plural(preview.totalRows, "row")} detected`}
        >
          <div className="space-y-3">
            {preview.duplicateOf && (
              <Banner tone="warning" title="You have uploaded this exact file before">
                {formatDateTime(preview.duplicateOf.createdAt)}. Uploading it again will not create duplicate
                leads — rows that already produced a lead are skipped, and rows that match an existing lead are
                re-applied.
              </Banner>
            )}
            {preview.extraColumns.length > 0 && (
              <Banner tone="info" title="Some columns are not used">
                {preview.extraColumns.join(", ")} — these are ignored. Everything the importer needs was found.
              </Banner>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Tile label="New leads" value={preview.creates} tone="success" />
              <Tile label="Updates" value={preview.updates} tone="brand" />
              <Tile label="Skipped" value={preview.skips} tone="warning" />
              <Tile label="Rejected" value={preview.invalid} tone="danger" />
              <Tile label="Blank rows" value={preview.blankRows} />
            </div>

            {preview.problems.length > 0 && <ProblemTable problems={preview.problems} />}

            {preview.validRows === 0 ? (
              <Banner tone="warning" title="Nothing to write">
                No row in this file would create or update a lead. Fix the rows listed above and upload again.
              </Banner>
            ) : (
              <p className="text-xs text-muted">
                Confirming writes {plural(preview.creates, "new lead")} and updates {plural(preview.updates, "existing lead")}.
                Nothing has been written yet.
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              {preview.invalid + preview.skips > 0 && (
                <DownloadLink href={`/api/leads/import/${preview.batchId}/report`}>Download error report</DownloadLink>
              )}
              <Button variant="secondary" size="sm" onClick={() => void discard(preview.batchId)}>
                Discard
              </Button>
              <Button
                size="sm"
                disabled={preview.validRows === 0}
                onClick={() => void runChunks(preview.batchId)}
              >
                Process {plural(preview.validRows, "row")}
              </Button>
            </div>
            {error && <p className={actionErrorClass()}>{error}</p>}
          </div>
        </Panel>
      )}

      {/* ------------------------------------------------------- processing */}
      {(phase === "processing" || phase === "done") && progress && (
        <Panel
          title={phase === "processing" ? "4 · Processing" : "Done"}
          subtitle={preview?.fileName}
          action={
            phase === "processing" ? (
              <Button variant="secondary" size="sm" onClick={() => (stopRef.current = true)}>
                Stop after this batch
              </Button>
            ) : undefined
          }
        >
          <div className="space-y-3">
            <div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">
                  {phase === "processing" ? "Processing" : "Processed"} {progress.processed} / {progress.totalRows} rows
                </span>
                <span className="text-xs text-muted">
                  {progress.totalRows > 0 ? Math.round((progress.processed / progress.totalRows) * 100) : 0}%
                </span>
              </div>
              <Meter
                value={progress.processed}
                max={progress.totalRows || 1}
                tone={progress.failed > 0 ? "warning" : "brand"}
                className="mt-1.5"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Tile label="Created" value={progress.created} tone="success" />
              <Tile label="Updated" value={progress.updated} tone="brand" />
              <Tile label="Skipped" value={progress.skipped} tone="warning" />
              <Tile label="Rejected" value={progress.invalid} tone="danger" />
              <Tile label="Failed" value={progress.failed} tone="danger" />
            </div>

            {phase === "done" && (
              <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                <Row label="Status" value={progress.status.replace(/_/g, " ")} />
                <Row label="Time taken" value={formatDuration(progress.durationMs)} />
                <Row
                  label="Last row written"
                  value={progress.lastSuccessRow ? `Row ${progress.lastSuccessRow}` : "none"}
                />
                <Row
                  label="First failed row"
                  value={progress.firstFailedRow ? `Row ${progress.firstFailedRow}` : "none"}
                />
              </dl>
            )}

            {notice && <Banner tone="info" title={notice} />}
            {error && (
              <Banner tone="danger" title="Processing stopped">
                {error}
              </Banner>
            )}

            {phase === "done" && (
              <div className="flex flex-wrap justify-end gap-2">
                {progress.invalid + progress.failed + progress.skipped > 0 && (
                  <DownloadLink href={`/api/leads/import/${progress.batchId}/report`}>Download error report</DownloadLink>
                )}
                {/* `hasMore` only tells the loop when to stop; whether work is
                    left is a question about the rows themselves. */}
                {progress.processed < progress.totalRows && (
                  <Button size="sm" onClick={() => void runChunks(progress.batchId)}>
                    Continue — {progress.totalRows - progress.processed} rows left
                  </Button>
                )}
                {progress.failed > 0 && (
                  <Button variant="secondary" size="sm" onClick={() => void retry(progress.batchId)}>
                    Retry {plural(progress.failed, "failed row")}
                  </Button>
                )}
                <LinkButton href="/leads" variant="secondary" size="sm">
                  Go to leads
                </LinkButton>
                <Button size="sm" onClick={reset}>
                  Upload another file
                </Button>
              </div>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Tile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger";
}) {
  const tones = {
    neutral: "",
    brand: "text-brand-600 dark:text-brand-300",
    success: "text-emerald-600 dark:text-emerald-400",
    warning: "text-gold-600 dark:text-gold-300",
    danger: "text-red-600 dark:text-red-400",
  };
  return (
    <div className="rounded-lg border border-app px-3 py-2">
      <div className={cn("font-display text-xl font-bold tabular-nums", value > 0 ? tones[tone] : "text-muted")}>
        {value}
      </div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium capitalize">{value}</dd>
    </div>
  );
}

function ProblemTable({ problems }: { problems: ValidationPreview["problems"] }) {
  return (
    <div className="max-h-80 overflow-auto rounded-lg border border-app scroll-thin">
      <table className="w-full min-w-[720px] border-collapse text-xs">
        <thead className="sticky top-0 surface-alt">
          <tr className="border-b border-app text-left">
            <th className="px-3 py-2 font-semibold text-muted uppercase">Row</th>
            <th className="px-3 py-2 font-semibold text-muted uppercase">Lead</th>
            <th className="px-3 py-2 font-semibold text-muted uppercase">Outcome</th>
            <th className="px-3 py-2 font-semibold text-muted uppercase">Column</th>
            <th className="px-3 py-2 font-semibold text-muted uppercase">What is wrong</th>
          </tr>
        </thead>
        <tbody>
          {problems.map((problem) => (
            <tr key={problem.rowNumber} className="border-b border-app last:border-0 align-top">
              <td className="px-3 py-1.5 font-medium tabular-nums">{problem.rowNumber}</td>
              <td className="px-3 py-1.5">{problem.identifier}</td>
              <td className="px-3 py-1.5">
                <Badge tone={problem.status === "invalid" ? "danger" : "warning"}>
                  {problem.status === "invalid" ? "Rejected" : "Skipped"}
                </Badge>
              </td>
              <td className="px-3 py-1.5 text-muted">{problem.field ? headerFor(problem.field) : "—"}</td>
              <td className="px-3 py-1.5">
                {problem.message}
                {problem.hint && <div className="text-[11px] text-muted">{problem.hint}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
