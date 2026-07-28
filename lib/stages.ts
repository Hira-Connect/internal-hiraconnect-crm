import type { Funnel, Stage, StageCategory } from "./types";

/** Mirrors the seed in supabase/migrations/20260729120000_v2_schema.sql.
 *  Used as a fallback when the stages table hasn't loaded (or hasn't been migrated yet). */
export const DEFAULT_STAGES: Stage[] = [
  { key: "New", label: "New", funnel: "TOFU", category: "open", sort: 10, sla_days: 2, probability: 5, is_active: true },
  { key: "Contacted", label: "Contacted", funnel: "TOFU", category: "open", sort: 20, sla_days: 3, probability: 10, is_active: true },
  { key: "Follow Up", label: "Follow Up", funnel: "TOFU", category: "open", sort: 30, sla_days: 5, probability: 20, is_active: true },
  { key: "Meeting Scheduled", label: "Meeting Scheduled", funnel: "MOFU", category: "open", sort: 40, sla_days: 7, probability: 35, is_active: true },
  { key: "Meeting Done", label: "Meeting Done", funnel: "MOFU", category: "open", sort: 50, sla_days: 7, probability: 45, is_active: true },
  { key: "Demo Setup", label: "Demo Setup", funnel: "MOFU", category: "open", sort: 60, sla_days: 5, probability: 55, is_active: true },
  { key: "Demo Done", label: "Demo Done", funnel: "MOFU", category: "open", sort: 70, sla_days: 7, probability: 65, is_active: true },
  { key: "Onboarding", label: "Onboarding", funnel: "BOFU", category: "open", sort: 80, sla_days: 14, probability: 85, is_active: true },
  { key: "Won", label: "Won", funnel: "BOFU", category: "won", sort: 90, sla_days: 0, probability: 100, is_active: true },
  { key: "Delayed", label: "Delayed", funnel: "BOFU", category: "open", sort: 95, sla_days: 30, probability: 15, is_active: true },
  { key: "Lost", label: "Lost", funnel: "BOFU", category: "lost", sort: 100, sla_days: 0, probability: 0, is_active: true },
];

export const FUNNELS: Funnel[] = ["TOFU", "MOFU", "BOFU"];

export const FUNNEL_MEANING: Record<Funnel, string> = {
  TOFU: "Awareness & qualification",
  MOFU: "Nurture, meetings & demos",
  BOFU: "Negotiation & close",
};

/** Stages that make up the conversion funnel, in order. Delayed/Lost sit outside it. */
export const FUNNEL_PATH = [
  "New",
  "Contacted",
  "Follow Up",
  "Meeting Scheduled",
  "Meeting Done",
  "Demo Setup",
  "Demo Done",
  "Onboarding",
  "Won",
];

export function stageMap(stages: Stage[]): Map<string, Stage> {
  return new Map(stages.map((s) => [s.key, s]));
}

export function findStage(stages: Stage[], key: string | null | undefined): Stage | null {
  if (!key) return null;
  return stages.find((s) => s.key === key) ?? null;
}

export function categoryOf(stages: Stage[], key: string | null | undefined): StageCategory {
  return findStage(stages, key)?.category ?? "open";
}

export function isOpen(stages: Stage[], key: string | null | undefined): boolean {
  return categoryOf(stages, key) === "open";
}

export function isClosed(stages: Stage[], key: string | null | undefined): boolean {
  return categoryOf(stages, key) !== "open";
}

export function probabilityOf(stages: Stage[], key: string | null | undefined): number {
  return findStage(stages, key)?.probability ?? 0;
}

/** Whole days between a date-ish value and now. Returns null for missing input. */
export function daysSince(value: string | null | undefined, now: Date = new Date()): number | null {
  if (!value) return null;
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
}

export function daysInStage(
  lead: { stage_since: string | null; created_at: string },
  now: Date = new Date(),
): number {
  return daysSince(lead.stage_since ?? lead.created_at, now) ?? 0;
}

export type RotState = "fresh" | "warning" | "rotting";

/** Pipeline hygiene: how far past the stage's SLA is this lead sitting? */
export function rotState(
  stages: Stage[],
  lead: { status: string; stage_since: string | null; created_at: string },
  now: Date = new Date(),
): RotState {
  const stage = findStage(stages, lead.status);
  if (!stage || stage.category !== "open" || stage.sla_days <= 0) return "fresh";
  const days = daysInStage(lead, now);
  if (days > stage.sla_days * 2) return "rotting";
  if (days > stage.sla_days) return "warning";
  return "fresh";
}

/** Weighted pipeline value: sum(expected_value × stage probability) over open leads. */
export function weightedValue(
  stages: Stage[],
  leads: { status: string; expected_value: number | null }[],
): number {
  return leads.reduce((sum, l) => {
    const stage = findStage(stages, l.status);
    if (!stage || stage.category !== "open") return sum;
    return sum + (l.expected_value ?? 0) * (stage.probability / 100);
  }, 0);
}

/** Stages a lead may legally move to. Everything is reachable — sales is not a
 *  state machine — but forward moves are listed first so the UI can rank them. */
export function nextStages(stages: Stage[], current: string): Stage[] {
  const cur = findStage(stages, current);
  const sorted = [...stages].filter((s) => s.is_active).sort((a, b) => a.sort - b.sort);
  if (!cur) return sorted;
  const ahead = sorted.filter((s) => s.sort > cur.sort);
  const behind = sorted.filter((s) => s.sort < cur.sort);
  return [...ahead, ...behind];
}
