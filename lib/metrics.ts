/** The metrics a monthly target can be set against.
 *  `key` is stored verbatim in monthly_targets.metric, so renaming one orphans
 *  existing rows — add a new preset instead. */

export type MetricKey =
  | "New leads"
  | "Reachouts"
  | "Meetings"
  | "Demos"
  | "Won"
  | "Revenue";

export interface MetricPreset {
  key: MetricKey;
  label: string;
  help: string;
  /** How the actual is derived when auto_actual is on. */
  source: string;
  format: "count" | "currency";
}

export const METRIC_PRESETS: MetricPreset[] = [
  {
    key: "New leads",
    label: "New leads",
    help: "Leads created in the month",
    source: "leads.created_at",
    format: "count",
  },
  {
    key: "Reachouts",
    label: "Reachouts",
    help: "Calls, emails, WhatsApps, meetings and demos logged",
    source: "activities (touch types)",
    format: "count",
  },
  {
    key: "Meetings",
    label: "Meetings",
    help: "Meeting activities logged in the month",
    source: "activities.type = Meeting",
    format: "count",
  },
  {
    key: "Demos",
    label: "Demos",
    help: "Demo activities logged in the month",
    source: "activities.type = Demo",
    format: "count",
  },
  {
    key: "Won",
    label: "Deals won",
    help: "Leads that reached Won in the month",
    source: "leads.won_at",
    format: "count",
  },
  {
    key: "Revenue",
    label: "Revenue",
    help: "Expected value of leads won in the month",
    source: "sum(leads.expected_value) where won",
    format: "currency",
  },
];

export function metricPreset(key: string): MetricPreset | undefined {
  return METRIC_PRESETS.find((m) => m.key === key);
}

export function isCurrencyMetric(key: string): boolean {
  return metricPreset(key)?.format === "currency";
}

/** Where a month should be by now, as a fraction — used for the pacing indicator. */
export function monthProgress(month: string, now: Date = new Date()): number {
  const start = new Date(`${month.slice(0, 7)}-01T00:00:00`);
  if (Number.isNaN(start.getTime())) return 1;
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const daysInMonth = end.getDate();
  if (now < start) return 0;
  if (now > end) return 1;
  return now.getDate() / daysInMonth;
}

export type Pace = "ahead" | "on-track" | "behind" | "done" | "not-started";

export function paceOf(actual: number, target: number, month: string, now: Date = new Date()): Pace {
  if (target <= 0) return "not-started";
  if (actual >= target) return "done";
  const expected = target * monthProgress(month, now);
  if (expected <= 0) return "not-started";
  const ratio = actual / expected;
  if (ratio >= 1.05) return "ahead";
  if (ratio >= 0.9) return "on-track";
  return "behind";
}

export const PACE_STYLES: Record<Pace, { label: string; className: string }> = {
  done: { label: "Target met", className: "text-emerald-600 dark:text-emerald-400" },
  ahead: { label: "Ahead of pace", className: "text-emerald-600 dark:text-emerald-400" },
  "on-track": { label: "On track", className: "text-blue-600 dark:text-blue-400" },
  behind: { label: "Behind pace", className: "text-red-600 dark:text-red-400" },
  "not-started": { label: "No target set", className: "text-slate-500 dark:text-slate-400" },
};
