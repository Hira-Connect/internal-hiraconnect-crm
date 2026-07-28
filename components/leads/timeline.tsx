import { EmptyState } from "@/components/ui/primitives";
import { ACTIVITY_ICON } from "./activity-composer";
import { TaskToggle } from "./task-toggle";
import { displayName, formatDate, relTime } from "@/lib/format";
import type { ActivityRow, StageHistory } from "@/lib/types";

type Entry =
  | { kind: "activity"; at: string; row: ActivityRow }
  | { kind: "stage"; at: string; row: StageHistory };

/** One merged, reverse-chronological story of the lead: what we did and where it moved. */
export function Timeline({
  activities,
  history,
}: {
  activities: ActivityRow[];
  history: StageHistory[];
}) {
  const entries: Entry[] = [
    ...activities.map((row) => ({ kind: "activity" as const, at: row.created_at, row })),
    ...history.map((row) => ({ kind: "stage" as const, at: row.changed_at, row })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  if (!entries.length) {
    return (
      <EmptyState
        title="No activity yet"
        hint="Log the first call, email or note above — everything you record here becomes the lead's history."
      />
    );
  }

  return (
    <ol className="relative space-y-0">
      {entries.map((entry, i) => (
        <li key={`${entry.kind}-${entry.row.id}`} className="flex gap-3 py-3">
          <div className="flex flex-col items-center">
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm dark:bg-brand-500/20"
            >
              {entry.kind === "stage" ? "↗️" : (ACTIVITY_ICON[entry.row.type] ?? "•")}
            </span>
            {i < entries.length - 1 && <span className="mt-1 w-px flex-1 bg-[var(--border)]" />}
          </div>

          <div className="min-w-0 flex-1">
            {entry.kind === "stage" ? (
              <>
                <p className="text-sm">
                  <b>
                    {entry.row.from_stage ? `${entry.row.from_stage} → ` : ""}
                    {entry.row.to_stage}
                  </b>
                  {entry.row.note && <span className="text-muted"> — {entry.row.note}</span>}
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {entry.row.changed_by ?? "system"}
                  {entry.row.days_in_from_stage !== null &&
                    ` · ${entry.row.days_in_from_stage}d in ${entry.row.from_stage ?? "previous stage"}`}
                  {` · ${relTime(entry.row.changed_at)}`}
                </p>
              </>
            ) : (
              <>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <b>{entry.row.type}</b>
                  {entry.row.direction && (
                    <span className="text-[11px] text-muted">
                      {entry.row.direction === "in" ? "▼ inbound" : "▲ outbound"}
                    </span>
                  )}
                  {entry.row.outcome && <span className="text-muted">— {entry.row.outcome}</span>}
                  {entry.row.type === "Task" && <TaskToggle activityId={entry.row.id} done={entry.row.done} />}
                </p>
                {entry.row.notes && <p className="mt-1 text-sm whitespace-pre-wrap">{entry.row.notes}</p>}
                <p className="mt-0.5 text-[11px] text-muted">
                  {displayName(entry.row.author_profile) === "Unassigned"
                    ? (entry.row.author ?? "—")
                    : displayName(entry.row.author_profile)}
                  {entry.row.due_date && ` · due ${formatDate(entry.row.due_date)}`}
                  {` · ${relTime(entry.row.created_at)}`}
                </p>
              </>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
