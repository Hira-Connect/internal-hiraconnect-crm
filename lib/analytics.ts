/** Reporting maths. Pure functions over already-fetched rows so the same code
 *  works on the server (page render) and in the browser (filter changes). */

import { FUNNEL_PATH, categoryOf, findStage } from "./stages";
import type { ActivityRow, Grade, LeadRow, Profile, ScoreHistory, Stage, StageHistory } from "./types";

/* ------------------------------------------------------------------ funnel */

export interface FunnelStep {
  stage: string;
  /** Leads that have EVER reached this stage (not just those sitting in it). */
  reached: number;
  /** Conversion from the previous step, as a percentage. */
  conversion: number;
  /** Leads currently parked here. */
  current: number;
}

export function buildFunnel(leads: LeadRow[], history: StageHistory[], stages: Stage[]): FunnelStep[] {
  const reachedBy = new Map<string, Set<string>>();
  for (const key of FUNNEL_PATH) reachedBy.set(key, new Set());

  // a lead's current stage counts as reached even if history is missing
  for (const lead of leads) {
    const idx = FUNNEL_PATH.indexOf(lead.status);
    if (idx >= 0) {
      for (let i = 0; i <= idx; i += 1) reachedBy.get(FUNNEL_PATH[i])?.add(lead.id);
    }
  }
  for (const h of history) {
    const idx = FUNNEL_PATH.indexOf(h.to_stage);
    if (idx >= 0) {
      for (let i = 0; i <= idx; i += 1) reachedBy.get(FUNNEL_PATH[i])?.add(h.lead_id);
    }
  }

  const currentCounts = new Map<string, number>();
  for (const lead of leads) currentCounts.set(lead.status, (currentCounts.get(lead.status) ?? 0) + 1);

  const steps: FunnelStep[] = [];
  let previous = 0;
  FUNNEL_PATH.forEach((stage, i) => {
    if (!findStage(stages, stage)) return;
    const reached = reachedBy.get(stage)?.size ?? 0;
    steps.push({
      stage,
      reached,
      current: currentCounts.get(stage) ?? 0,
      conversion: i === 0 || previous === 0 ? 100 : Math.round((reached / previous) * 100),
    });
    previous = reached;
  });
  return steps;
}

export function winRate(leads: LeadRow[], stages: Stage[]): { won: number; lost: number; rate: number } {
  const won = leads.filter((l) => categoryOf(stages, l.status) === "won").length;
  const lost = leads.filter((l) => categoryOf(stages, l.status) === "lost").length;
  const closed = won + lost;
  return { won, lost, rate: closed ? Math.round((won / closed) * 100) : 0 };
}

/* ---------------------------------------------------------------- velocity */

export interface StageVelocity {
  stage: string;
  avgDays: number;
  samples: number;
}

export function stageVelocity(history: StageHistory[]): StageVelocity[] {
  const buckets = new Map<string, number[]>();
  for (const h of history) {
    if (!h.from_stage || h.days_in_from_stage === null) continue;
    const list = buckets.get(h.from_stage) ?? [];
    list.push(h.days_in_from_stage);
    buckets.set(h.from_stage, list);
  }
  return FUNNEL_PATH.filter((s) => buckets.has(s)).map((stage) => {
    const list = buckets.get(stage) ?? [];
    return {
      stage,
      samples: list.length,
      avgDays: list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : 0,
    };
  });
}

/** Days from lead creation to Won, averaged over closed-won deals. */
export function salesCycleDays(leads: LeadRow[]): { avg: number; samples: number } {
  const durations = leads
    .filter((l) => l.won_at)
    .map((l) => (new Date(l.won_at as string).getTime() - new Date(l.created_at).getTime()) / 86_400_000)
    .filter((d) => Number.isFinite(d) && d >= 0);
  if (!durations.length) return { avg: 0, samples: 0 };
  return {
    avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
    samples: durations.length,
  };
}

/* -------------------------------------------------------------- source ROI */

export interface SourceRow {
  source: string;
  total: number;
  won: number;
  lost: number;
  open: number;
  winRate: number;
  revenue: number;
}

export function sourceRoi(leads: LeadRow[], stages: Stage[]): SourceRow[] {
  const map = new Map<string, SourceRow>();
  for (const lead of leads) {
    const key = lead.source?.trim() || "Unknown";
    const row =
      map.get(key) ?? { source: key, total: 0, won: 0, lost: 0, open: 0, winRate: 0, revenue: 0 };
    row.total += 1;
    const cat = categoryOf(stages, lead.status);
    if (cat === "won") {
      row.won += 1;
      row.revenue += lead.expected_value ?? 0;
    } else if (cat === "lost") row.lost += 1;
    else row.open += 1;
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, winRate: r.won + r.lost ? Math.round((r.won / (r.won + r.lost)) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);
}

/* ------------------------------------------------------------ lost reasons */

export function lostReasonBreakdown(leads: LeadRow[], stages: Stage[]): { reason: string; count: number }[] {
  const map = new Map<string, number>();
  for (const lead of leads) {
    if (categoryOf(stages, lead.status) !== "lost") continue;
    const key = lead.lost_reason?.trim() || "Not recorded";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------ leaderboard */

export interface OwnerRow {
  ownerId: string | null;
  name: string;
  leads: number;
  open: number;
  won: number;
  lost: number;
  winRate: number;
  activities: number;
  reachouts: number;
  revenue: number;
  overdue: number;
}

export function leaderboard(
  leads: LeadRow[],
  activities: ActivityRow[],
  profiles: Profile[],
  stages: Stage[],
  today: string,
): OwnerRow[] {
  const rows = new Map<string, OwnerRow>();
  const nameOf = (id: string | null) => {
    if (!id) return "Unassigned";
    const p = profiles.find((x) => x.id === id);
    return p?.full_name || p?.email || "Unknown";
  };
  const rowFor = (id: string | null) => {
    const key = id ?? "unassigned";
    if (!rows.has(key)) {
      rows.set(key, {
        ownerId: id,
        name: nameOf(id),
        leads: 0,
        open: 0,
        won: 0,
        lost: 0,
        winRate: 0,
        activities: 0,
        reachouts: 0,
        revenue: 0,
        overdue: 0,
      });
    }
    return rows.get(key) as OwnerRow;
  };

  for (const lead of leads) {
    const row = rowFor(lead.owner_id);
    row.leads += 1;
    const cat = categoryOf(stages, lead.status);
    if (cat === "won") {
      row.won += 1;
      row.revenue += lead.expected_value ?? 0;
    } else if (cat === "lost") row.lost += 1;
    else {
      row.open += 1;
      if (lead.next_action_date && lead.next_action_date < today) row.overdue += 1;
    }
    row.reachouts += lead.total_reachouts ?? 0;
  }

  const TOUCH = new Set(["Call", "Email", "WhatsApp", "Meeting", "Demo"]);
  for (const activity of activities) {
    if (!activity.owner_id) continue;
    const row = rows.get(activity.owner_id);
    if (!row) continue;
    if (activity.type !== "StageChange") row.activities += 1;
    if (TOUCH.has(activity.type)) {
      /* reachouts already counted from the lead column; nothing to add */
    }
  }

  return [...rows.values()]
    .map((r) => ({ ...r, winRate: r.won + r.lost ? Math.round((r.won / (r.won + r.lost)) * 100) : 0 }))
    .sort((a, b) => b.won - a.won || b.leads - a.leads);
}

/** Lead count per stage for one owner — the user-wise lead status report. */
export function ownerStageMatrix(
  leads: LeadRow[],
  profiles: Profile[],
  stages: Stage[],
): { name: string; ownerId: string | null; counts: Record<string, number>; total: number }[] {
  const map = new Map<string, { name: string; ownerId: string | null; counts: Record<string, number>; total: number }>();
  for (const lead of leads) {
    const key = lead.owner_id ?? "unassigned";
    if (!map.has(key)) {
      const p = profiles.find((x) => x.id === lead.owner_id);
      map.set(key, {
        ownerId: lead.owner_id,
        name: lead.owner_id ? p?.full_name || p?.email || "Unknown" : "Unassigned",
        counts: Object.fromEntries(stages.map((s) => [s.key, 0])),
        total: 0,
      });
    }
    const row = map.get(key)!;
    row.counts[lead.status] = (row.counts[lead.status] ?? 0) + 1;
    row.total += 1;
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

/* ---------------------------------------------------------------- trends */

export interface WeekPoint {
  weekStart: string;
  label: string;
  newLeads: number;
  won: number;
  activities: number;
}

export function weeklyTrend(
  leads: LeadRow[],
  activities: ActivityRow[],
  weeks = 12,
  now: Date = new Date(),
): WeekPoint[] {
  const points: WeekPoint[] = [];
  const startOfWeek = (d: Date) => {
    const copy = new Date(d);
    const day = (copy.getDay() + 6) % 7; // Monday-first
    copy.setHours(0, 0, 0, 0);
    copy.setDate(copy.getDate() - day);
    return copy;
  };

  const thisWeek = startOfWeek(now);
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = new Date(thisWeek);
    start.setDate(start.getDate() - i * 7);
    points.push({
      weekStart: start.toISOString().slice(0, 10),
      label: start.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
      newLeads: 0,
      won: 0,
      activities: 0,
    });
  }

  const indexOf = (iso: string | null) => {
    if (!iso) return -1;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return -1;
    const key = startOfWeek(d).toISOString().slice(0, 10);
    return points.findIndex((p) => p.weekStart === key);
  };

  for (const lead of leads) {
    const created = indexOf(lead.created_at);
    if (created >= 0) points[created].newLeads += 1;
    const won = indexOf(lead.won_at);
    if (won >= 0) points[won].won += 1;
  }
  for (const activity of activities) {
    if (activity.type === "StageChange") continue;
    const idx = indexOf(activity.created_at);
    if (idx >= 0) points[idx].activities += 1;
  }

  return points;
}

/* -------------------------------------------------------------- hot leads */

export function hotLeads(leads: LeadRow[], stages: Stage[], limit = 8): LeadRow[] {
  return leads
    .filter((l) => categoryOf(stages, l.status) === "open")
    .filter((l) => l.grade === "A" || l.grade === "B")
    .sort((a, b) => b.score_total - a.score_total)
    .slice(0, limit);
}

/* ------------------------------------------------------------ quality movement */

export interface ScoreMovement {
  leadId: string;
  from: number;
  to: number;
  delta: number;
  fromGrade: Grade | null;
  toGrade: Grade | null;
}

/** Whether each lead's score rose, fell or held steady within the window, comparing
 *  the earliest and latest `lead_score_history` rows recorded for it in that span.
 *  Leads with only one rescoring in the window carry no trend yet and are omitted. */
export function scoreMovement(history: ScoreHistory[], windowDays = 14, now: Date = new Date()): ScoreMovement[] {
  const since = new Date(now.getTime() - windowDays * 86_400_000);
  const byLead = new Map<string, ScoreHistory[]>();
  for (const h of history) {
    if (new Date(h.created_at) < since) continue;
    const list = byLead.get(h.lead_id) ?? [];
    list.push(h);
    byLead.set(h.lead_id, list);
  }

  const moves: ScoreMovement[] = [];
  for (const [leadId, rows] of byLead) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    moves.push({
      leadId,
      from: first.score_total,
      to: last.score_total,
      delta: last.score_total - first.score_total,
      fromGrade: first.grade,
      toGrade: last.grade,
    });
  }
  return moves;
}
