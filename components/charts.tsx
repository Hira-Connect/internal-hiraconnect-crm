import type { ReactNode } from "react";
import { cn } from "@/lib/format";

/** Hand-rolled inline SVG charts. No chart library — these are simple enough to
 *  own outright, and they render on the server with zero client JS. */

const SERIES = ["#2e6bd6", "#c9942a", "#1e8e5a", "#8b5cf6", "#e2574c"];

/* ------------------------------------------------------------------ bars */

export function BarList({
  items,
  valueLabel,
  emptyText = "No data yet.",
}: {
  items: { label: string; value: number; hint?: string; tone?: string }[];
  valueLabel?: (value: number) => string;
  emptyText?: string;
}) {
  if (!items.length) return <p className="py-4 text-center text-xs text-muted">{emptyText}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label} className="grid grid-cols-[minmax(90px,1fr)_2fr_auto] items-center gap-3">
          <span className="truncate text-sm" title={item.label}>
            {item.label}
          </span>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-navy-100 dark:bg-navy-800">
            <div
              className="h-full rounded-full"
              style={{ width: `${(item.value / max) * 100}%`, background: item.tone ?? SERIES[0] }}
            />
          </div>
          <span className="text-right text-sm font-semibold tabular-nums">
            {valueLabel ? valueLabel(item.value) : item.value}
            {item.hint && <span className="ml-1 text-[11px] font-normal text-muted">{item.hint}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- funnel */

export function FunnelChart({
  steps,
}: {
  steps: { stage: string; reached: number; conversion: number; current: number }[];
}) {
  if (!steps.length) return <p className="py-4 text-center text-xs text-muted">No funnel data yet.</p>;
  const max = Math.max(...steps.map((s) => s.reached), 1);

  return (
    <ol className="space-y-1.5">
      {steps.map((step, i) => {
        const width = Math.max(6, (step.reached / max) * 100);
        const dropped = i > 0 && step.conversion < 100;
        return (
          <li key={step.stage} className="flex items-center gap-3">
            <span className="w-36 shrink-0 truncate text-xs text-muted" title={step.stage}>
              {step.stage}
            </span>
            <div className="relative h-8 flex-1 rounded-md bg-navy-50 dark:bg-navy-900/60">
              <div
                className="flex h-8 items-center rounded-md px-2 text-xs font-semibold text-white"
                style={{
                  width: `${width}%`,
                  background: `linear-gradient(90deg, var(--color-brand-500), ${SERIES[0]}cc)`,
                }}
              >
                {step.reached}
              </div>
            </div>
            <span
              className={cn(
                "w-16 shrink-0 text-right text-xs tabular-nums",
                dropped && step.conversion < 50 ? "text-red-600 dark:text-red-400" : "text-muted",
              )}
            >
              {i === 0 ? "—" : `${step.conversion}%`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ line */

export interface LineSeries {
  name: string;
  points: number[];
  color?: string;
}

export function LineChart({
  labels,
  series,
  height = 160,
  format = (n: number) => String(n),
}: {
  labels: string[];
  series: LineSeries[];
  height?: number;
  format?: (n: number) => string;
}) {
  const width = 640;
  const padding = { top: 12, right: 8, bottom: 22, left: 32 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const all = series.flatMap((s) => s.points);
  const max = Math.max(...all, 1);
  const stepX = series[0]?.points.length > 1 ? innerW / (series[0].points.length - 1) : innerW;

  const y = (v: number) => padding.top + innerH - (v / max) * innerH;
  const x = (i: number) => padding.left + i * stepX;

  const gridValues = [0, 0.5, 1].map((f) => Math.round(max * f));

  return (
    <figure className="w-full overflow-x-auto scroll-thin">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full min-w-[420px]"
        role="img"
        aria-label={series.map((s) => s.name).join(", ")}
      >
        {gridValues.map((v) => (
          <g key={v}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            <text x={4} y={y(v) + 3} fontSize="9" fill="var(--text-muted)">
              {format(v)}
            </text>
          </g>
        ))}

        {series.map((s, si) => {
          const color = s.color ?? SERIES[si % SERIES.length];
          const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p)}`).join(" ");
          return (
            <g key={s.name}>
              <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
              {s.points.map((p, i) => (
                <circle key={i} cx={x(i)} cy={y(p)} r="2.5" fill={color}>
                  <title>{`${s.name} · ${labels[i]}: ${format(p)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}

        {labels.map((label, i) =>
          i % Math.ceil(labels.length / 8) === 0 ? (
            <text key={label + i} x={x(i)} y={height - 6} fontSize="9" fill="var(--text-muted)" textAnchor="middle">
              {label}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted">
        {series.map((s, si) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <i
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: s.color ?? SERIES[si % SERIES.length] }}
            />
            {s.name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/* ----------------------------------------------------------------- donut */

export function Donut({
  slices,
  size = 140,
  centerLabel,
}: {
  slices: { label: string; value: number; color?: string }[];
  size?: number;
  centerLabel?: ReactNode;
}) {
  const total = slices.reduce((n, s) => n + s.value, 0);
  if (!total) return <p className="py-4 text-center text-xs text-muted">No data yet.</p>;

  const radius = size / 2;
  const stroke = size * 0.18;
  const r = radius - stroke / 2;
  const circumference = 2 * Math.PI * r;

  // pre-compute each arc's length and where it starts, so the render pass is pure
  const arcs = slices.reduce<{ slice: (typeof slices)[number]; dash: number; offset: number }[]>(
    (acc, slice) => {
      const dash = (slice.value / total) * circumference;
      const offset = acc.length ? acc[acc.length - 1].offset + acc[acc.length - 1].dash : 0;
      acc.push({ slice, dash, offset });
      return acc;
    },
    [],
  );

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="-rotate-90">
          {arcs.map(({ slice, dash, offset }, i) => (
            <circle
              key={slice.label}
              cx={radius}
              cy={radius}
              r={r}
              fill="none"
              stroke={slice.color ?? SERIES[i % SERIES.length]}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
            >
              <title>{`${slice.label}: ${slice.value}`}</title>
            </circle>
          ))}
        </svg>
        {centerLabel && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{centerLabel}</div>
        )}
      </div>
      <ul className="min-w-0 flex-1 space-y-1 text-xs">
        {slices.map((slice, i) => (
          <li key={slice.label} className="flex items-center gap-2">
            <i
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: slice.color ?? SERIES[i % SERIES.length] }}
            />
            <span className="min-w-0 flex-1 truncate">{slice.label}</span>
            <span className="font-semibold tabular-nums">{slice.value}</span>
            <span className="w-9 text-right text-muted tabular-nums">
              {Math.round((slice.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------- sparkline */

export function Sparkline({ points, color = SERIES[0], width = 90, height = 24 }: {
  points: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const step = width / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${i * step},${height - (p / max) * (height - 2) - 1}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

export const CHART_COLORS = SERIES;
