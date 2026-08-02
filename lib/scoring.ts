/** Lead scoring — pure functions, no I/O, so they can be unit-tested and run
 *  identically on the server and in the browser.
 *
 *  Two independent halves, per HubSpot's fit-vs-engagement model:
 *    fit        (0-50)  who they are   — firmographics + seniority + source quality
 *    engagement (0-50)  what they did  — recency, touches, stage depth, replies
 *
 *  Engagement is GATED behind a minimum fit score: a highly active lead that does
 *  not match the ICP should not outrank a quiet lead that does. Below the gate,
 *  engagement is halved rather than zeroed, so real signals still surface.
 */

import type { Company, Grade, Lead, Stage } from "./types";
import { daysSince, findStage } from "./stages";

export const FIT_MAX = 50;
export const ENGAGEMENT_MAX = 50;
export const FIT_GATE = 18; // below this, engagement is discounted

export const GRADE_THRESHOLDS: { grade: Grade; min: number; label: string }[] = [
  { grade: "A", min: 75, label: "Hot — work today" },
  { grade: "B", min: 55, label: "Warm — keep nurturing" },
  { grade: "C", min: 35, label: "Cool — low-touch cadence" },
  { grade: "D", min: 0, label: "Cold — deprioritise" },
];

export interface ScoreFactor {
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface ScoreResult {
  fit: number;
  engagement: number;
  total: number;
  grade: Grade;
  gated: boolean;
  fitFactors: ScoreFactor[];
  engagementFactors: ScoreFactor[];
}

export interface ActivityStats {
  touches: number;
  meetings: number;
  demos: number;
  inbound: number;
}

export interface ScoringInput {
  lead: Pick<
    Lead,
    "source" | "title" | "status" | "total_reachouts" | "last_activity_at" | "created_at"
  >;
  company?: Pick<Company, "size_band" | "employee_count" | "industry" | "is_icp" | "hiring_need"> | null;
  contactTitle?: string | null;
  stages: Stage[];
  activityStats: ActivityStats;
  now?: Date;
}

export const EMPTY_STATS: ActivityStats = { touches: 0, meetings: 0, demos: 0, inbound: 0 };

// ---------------------------------------------------------------- seniority

export type Seniority = "exec" | "head" | "manager" | "ic" | "unknown";

const EXEC = /\b(founder|co-?founder|ceo|cto|coo|cfo|chro|cmo|chief|owner|proprietor|partner|president|managing director|md)\b/i;
const HEAD = /\b(vp|vice president|head|director|avp|gm|general manager)\b/i;
const MANAGER = /\b(manager|lead|principal|supervisor|senior)\b/i;

export function inferSeniority(title: string | null | undefined): Seniority {
  if (!title || !title.trim()) return "unknown";
  if (EXEC.test(title)) return "exec";
  if (HEAD.test(title)) return "head";
  if (MANAGER.test(title)) return "manager";
  return "ic";
}

const SENIORITY_POINTS: Record<Seniority, number> = {
  exec: 12,
  head: 10,
  manager: 7,
  ic: 3,
  unknown: 4,
};

// ---------------------------------------------------------------- source

/** Source quality — inbound intent beats cold outbound. Matched case-insensitively
 *  on a substring so "Website Signup", "website", "Referral - Rahul" all land. */
const SOURCE_POINTS: { match: RegExp; points: number; label: string }[] = [
  { match: /referr?al|introduction|intro/i, points: 10, label: "Referral" },
  { match: /website|signup|sign-up|inbound|demo request/i, points: 8, label: "Inbound / website" },
  { match: /event|conference|webinar|meetup/i, points: 6, label: "Event" },
  { match: /linkedin|social/i, points: 5, label: "Social" },
  { match: /outbound|cold|scrape|list|import/i, points: 3, label: "Outbound" },
];

function sourceScore(source: string | null | undefined): { points: number; label: string } {
  if (!source) return { points: 3, label: "Unknown source" };
  const hit = SOURCE_POINTS.find((s) => s.match.test(source));
  return hit ? { points: hit.points, label: hit.label } : { points: 4, label: source };
}

// ---------------------------------------------------------------- size

const SIZE_POINTS: Record<string, number> = { small: 4, mid: 8, large: 10, enterprise: 12 };

function bandFromCount(n: number): "small" | "mid" | "large" | "enterprise" {
  if (n < 50) return "small";
  if (n < 250) return "mid";
  if (n < 1000) return "large";
  return "enterprise";
}

// ---------------------------------------------------------------- fit

export function scoreFit(input: ScoringInput): { score: number; factors: ScoreFactor[] } {
  const { lead, company, contactTitle } = input;
  const factors: ScoreFactor[] = [];

  // 1. Company size (0-12)
  const band = company?.size_band ?? (company?.employee_count ? bandFromCount(company.employee_count) : null);
  factors.push({
    label: "Company size",
    points: band ? SIZE_POINTS[band] ?? 3 : 3,
    max: 12,
    detail: band ? `${band}${company?.employee_count ? ` · ${company.employee_count} employees` : ""}` : "Size unknown",
  });

  // 2. ICP match (0-10)
  const icp = company?.is_icp;
  factors.push({
    label: "ICP match",
    points: icp === true ? 10 : icp === false ? 1 : 4,
    max: 10,
    detail:
      icp === true
        ? `Flagged as ICP${company?.industry ? ` · ${company.industry}` : ""}`
        : icp === false
          ? "Explicitly outside ICP"
          : "Not yet assessed — set the ICP flag on the company",
  });

  // 3. Contact seniority (0-12)
  const seniority = inferSeniority(contactTitle ?? lead.title);
  factors.push({
    label: "Decision-maker level",
    points: SENIORITY_POINTS[seniority],
    max: 12,
    detail: `${seniority}${contactTitle || lead.title ? ` · ${contactTitle ?? lead.title}` : " · no title on record"}`,
  });

  // 4. Source quality (0-10)
  const src = sourceScore(lead.source);
  factors.push({ label: "Source quality", points: src.points, max: 10, detail: src.label });

  // 5. Hiring need (0-6)
  const need = company?.hiring_need ?? "unknown";
  factors.push({
    label: "Hiring need",
    points: need === "niche" ? 6 : need === "general" ? 3 : 2,
    max: 6,
    detail: need === "unknown" ? "Need not captured" : `${need} hiring`,
  });

  const score = clamp(sum(factors), 0, FIT_MAX);
  return { score, factors };
}

// ---------------------------------------------------------------- engagement

export function scoreEngagement(input: ScoringInput): { score: number; factors: ScoreFactor[] } {
  const { lead, stages, activityStats, now = new Date() } = input;
  const factors: ScoreFactor[] = [];

  // 1. Recency (0-12) — the single strongest buying signal
  const idle = daysSince(lead.last_activity_at, now);
  const recencyPoints = idle === null ? 0 : idle <= 2 ? 12 : idle <= 7 ? 9 : idle <= 14 ? 6 : idle <= 30 ? 3 : 0;
  factors.push({
    label: "Recency",
    points: recencyPoints,
    max: 12,
    detail: idle === null ? "No activity logged yet" : idle === 0 ? "Touched today" : `${idle}d since last touch`,
  });

  // 2. Touch volume (0-10)
  const touches = Math.max(lead.total_reachouts ?? 0, activityStats.touches);
  factors.push({
    label: "Outreach volume",
    points: clamp(touches * 2, 0, 10),
    max: 10,
    detail: `${touches} logged touch${touches === 1 ? "" : "es"}`,
  });

  // 3. Stage depth (0-14) — derived from the stage's own win probability
  const stage = findStage(stages, lead.status);
  const prob = stage?.probability ?? 0;
  factors.push({
    label: "Stage depth",
    points: Math.round((prob / 100) * 14),
    max: 14,
    detail: `${lead.status} · ${prob}% win probability`,
  });

  // 4. Meetings & demos reached (0-12)
  const milestone = clamp(activityStats.meetings * 5 + activityStats.demos * 7, 0, 12);
  factors.push({
    label: "Meetings & demos",
    points: milestone,
    max: 12,
    detail: `${activityStats.meetings} meeting${activityStats.meetings === 1 ? "" : "s"}, ${activityStats.demos} demo${activityStats.demos === 1 ? "" : "s"}`,
  });

  // 5. Two-way conversation (0-6) — inbound replies, not just our own outreach
  factors.push({
    label: "Replies received",
    points: clamp(activityStats.inbound * 2, 0, 6),
    max: 6,
    detail: `${activityStats.inbound} inbound response${activityStats.inbound === 1 ? "" : "s"}`,
  });

  const score = clamp(sum(factors), 0, ENGAGEMENT_MAX);
  return { score, factors };
}

// ---------------------------------------------------------------- total

export function scoreLead(input: ScoringInput): ScoreResult {
  const fit = scoreFit(input);
  const engagement = scoreEngagement(input);

  const gated = fit.score < FIT_GATE;
  const engagementScore = gated ? Math.round(engagement.score / 2) : engagement.score;
  const total = clamp(fit.score + engagementScore, 0, 100);

  return {
    fit: fit.score,
    engagement: engagementScore,
    total,
    grade: gradeFor(total),
    gated,
    fitFactors: fit.factors,
    engagementFactors: engagement.factors,
  };
}

export function gradeFor(total: number): Grade {
  return GRADE_THRESHOLDS.find((t) => total >= t.min)?.grade ?? "D";
}

export function gradeLabel(grade: Grade): string {
  return GRADE_THRESHOLDS.find((t) => t.grade === grade)?.label ?? "";
}

/** Short hot/cold word per grade, for compact dashboard chips — kept next to the
 *  thresholds (whose prose labels are too long for a badge) so they never drift. */
export const GRADE_TEMPERATURE: Record<Grade, string> = {
  A: "Hot",
  B: "Warm",
  C: "Cool",
  D: "Cold",
};

/** Tailwind classes per grade — kept next to the thresholds so they never drift. */
export const GRADE_STYLES: Record<Grade, string> = {
  A: "bg-emerald-100 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30",
  B: "bg-blue-100 text-blue-800 ring-blue-600/20 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-400/30",
  C: "bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30",
  D: "bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-500/15 dark:text-slate-400 dark:ring-slate-400/30",
};

// ---------------------------------------------------------------- helpers

function sum(factors: ScoreFactor[]): number {
  return factors.reduce((n, f) => n + f.points, 0);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Roll a lead's activity rows into the counters the engagement score needs. */
export function statsFromActivities(
  activities: { type: string; direction: string | null }[],
): ActivityStats {
  const stats: ActivityStats = { touches: 0, meetings: 0, demos: 0, inbound: 0 };
  const TOUCH = new Set(["Call", "Email", "WhatsApp", "Meeting", "Demo"]);
  for (const a of activities) {
    if (TOUCH.has(a.type)) stats.touches += 1;
    if (a.type === "Meeting") stats.meetings += 1;
    if (a.type === "Demo") stats.demos += 1;
    if (a.direction === "in") stats.inbound += 1;
  }
  return stats;
}
