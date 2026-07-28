import { Meter } from "@/components/ui/primitives";
import { GradeBadge } from "./badges";
import { FIT_GATE, gradeLabel, type ScoreFactor, type ScoreResult } from "@/lib/scoring";

function FactorList({ factors }: { factors: ScoreFactor[] }) {
  return (
    <ul className="space-y-2">
      {factors.map((f) => (
        <li key={f.label}>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-medium">{f.label}</span>
            <span className="tabular-nums text-muted">
              {f.points}/{f.max}
            </span>
          </div>
          <Meter
            value={f.points}
            max={f.max}
            tone={f.points / f.max >= 0.66 ? "success" : f.points / f.max >= 0.33 ? "brand" : "warning"}
            className="mt-1 h-1.5"
          />
          <p className="mt-0.5 text-[11px] text-muted">{f.detail}</p>
        </li>
      ))}
    </ul>
  );
}

/** "Why is this lead an A?" — the breakdown that makes the score trustworthy. */
export function ScorePanel({ score }: { score: ScoreResult }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="font-display text-3xl font-bold tabular-nums">{score.total}</div>
        <div>
          <GradeBadge grade={score.grade} />
          <p className="mt-0.5 text-[11px] text-muted">{gradeLabel(score.grade)}</p>
        </div>
      </div>

      {score.gated && (
        <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          Fit is below {FIT_GATE}/50, so engagement counts for half. Activity alone should not push a
          poor-fit lead up the queue — fill in the company&apos;s size and ICP flag to lift it properly.
        </p>
      )}

      <section>
        <header className="mb-2 flex items-baseline justify-between">
          <h4 className="text-xs font-semibold tracking-wide uppercase">Fit — who they are</h4>
          <span className="text-xs font-semibold tabular-nums">{score.fit}/50</span>
        </header>
        <FactorList factors={score.fitFactors} />
      </section>

      <section>
        <header className="mb-2 flex items-baseline justify-between">
          <h4 className="text-xs font-semibold tracking-wide uppercase">Engagement — what they did</h4>
          <span className="text-xs font-semibold tabular-nums">{score.engagement}/50</span>
        </header>
        <FactorList factors={score.engagementFactors} />
      </section>
    </div>
  );
}
