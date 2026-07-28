import { Badge } from "@/components/ui/primitives";
import { GRADE_STYLES, gradeLabel } from "@/lib/scoring";
import { cn } from "@/lib/format";
import type { Grade, Stage } from "@/lib/types";
import { findStage, type RotState } from "@/lib/stages";

export function StageBadge({ stage, stages }: { stage: string; stages: Stage[] }) {
  const config = findStage(stages, stage);
  const tone =
    config?.category === "won"
      ? "success"
      : config?.category === "lost"
        ? "danger"
        : stage === "Delayed"
          ? "warning"
          : "brand";
  return <Badge tone={tone}>{stage}</Badge>;
}

export function GradeBadge({ grade, score }: { grade: Grade | null; score?: number }) {
  if (!grade) return <span className="text-xs text-muted">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset",
        GRADE_STYLES[grade],
      )}
      title={gradeLabel(grade)}
    >
      {grade}
      {score !== undefined && <span className="font-semibold opacity-70 tabular-nums">{score}</span>}
    </span>
  );
}

export function FunnelBadge({ stage, stages }: { stage: string; stages: Stage[] }) {
  const config = findStage(stages, stage);
  if (!config) return null;
  const tone = config.funnel === "BOFU" ? "gold" : config.funnel === "MOFU" ? "brand" : "neutral";
  return <Badge tone={tone}>{config.funnel}</Badge>;
}

const ROT_COPY: Record<RotState, { label: string; className: string } | null> = {
  fresh: null,
  warning: {
    label: "Past SLA",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  },
  rotting: {
    label: "Rotting",
    className: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  },
};

export function RotBadge({ state, days }: { state: RotState; days: number }) {
  const copy = ROT_COPY[state];
  if (!copy) return null;
  return (
    <span
      className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold", copy.className)}
      title={`${days} days in this stage`}
    >
      {copy.label} · {days}d
    </span>
  );
}
