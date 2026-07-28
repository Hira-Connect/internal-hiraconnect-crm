import type { Metadata } from "next";
import Link from "next/link";
import { Badge, EmptyState, Panel, StatCard } from "@/components/ui/primitives";
import { BarList, CHART_COLORS, Donut, FunnelChart, LineChart } from "@/components/charts";
import {
  getAllStageHistory,
  getLeads,
  getProfiles,
  getRecentActivities,
  getStages,
} from "@/lib/queries";
import {
  buildFunnel,
  leaderboard,
  lostReasonBreakdown,
  ownerStageMatrix,
  salesCycleDays,
  sourceRoi,
  stageVelocity,
  weeklyTrend,
  winRate,
} from "@/lib/analytics";
import { categoryOf, weightedValue } from "@/lib/stages";
import { formatCurrency, todayISO } from "@/lib/format";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const [leads, stages, profiles, history, activities] = await Promise.all([
    getLeads(),
    getStages(),
    getProfiles(),
    getAllStageHistory(),
    getRecentActivities(180),
  ]);

  const today = todayISO();
  const open = leads.filter((l) => categoryOf(stages, l.status) === "open");
  const funnel = buildFunnel(leads, history, stages);
  const wins = winRate(leads, stages);
  const cycle = salesCycleDays(leads);
  const velocity = stageVelocity(history);
  const sources = sourceRoi(leads, stages);
  const lostReasons = lostReasonBreakdown(leads, stages);
  const board = leaderboard(leads, activities, profiles, stages, today);
  const matrix = ownerStageMatrix(leads, profiles, stages);
  const trend = weeklyTrend(leads, activities, 12);

  const matrixStages = stages.filter((s) => s.is_active && matrix.some((r) => r.counts[s.key] > 0));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl">Reports</h1>
        <p className="text-xs text-muted">
          Where deals leak, how fast they move, which sources pay off, and who is doing what.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total leads" value={leads.length} />
        <StatCard label="Open" value={open.length} />
        <StatCard label="Won" value={wins.won} tone="success" />
        <StatCard label="Win rate" value={`${wins.rate}%`} hint={`${wins.won} won / ${wins.lost} lost`} />
        <StatCard
          label="Sales cycle"
          value={cycle.samples ? `${cycle.avg}d` : "—"}
          hint={cycle.samples ? `across ${cycle.samples} wins` : "no wins yet"}
        />
        <StatCard label="Weighted pipeline" value={formatCurrency(weightedValue(stages, open))} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Panel
          title="Conversion funnel"
          subtitle="Leads that have ever reached each stage, and the drop between them"
        >
          <FunnelChart steps={funnel} />
        </Panel>

        <Panel title="Stage velocity" subtitle="Average days spent before moving on">
          {velocity.length === 0 ? (
            <EmptyState
              title="Not enough history yet"
              hint="Velocity is measured from stage moves recorded after the rebuild."
            />
          ) : (
            <BarList
              items={velocity.map((v) => ({
                label: v.stage,
                value: v.avgDays,
                hint: `n=${v.samples}`,
                tone: CHART_COLORS[1],
              }))}
              valueLabel={(n) => `${n}d`}
            />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Panel title="Source ROI" subtitle="Which channels actually close" bodyClassName="p-0">
          {sources.length === 0 ? (
            <div className="p-4">
              <EmptyState title="No source data" hint="Set a source on each lead to unlock this." />
            </div>
          ) : (
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-app text-left">
                    {["Source", "Leads", "Won", "Lost", "Open", "Win rate", "Revenue"].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.source} className="border-b border-app last:border-0">
                      <td className="px-3 py-2 font-medium">{s.source}</td>
                      <td className="px-3 py-2 tabular-nums">{s.total}</td>
                      <td className="px-3 py-2 tabular-nums text-emerald-600 dark:text-emerald-400">{s.won}</td>
                      <td className="px-3 py-2 tabular-nums text-red-600 dark:text-red-400">{s.lost}</td>
                      <td className="px-3 py-2 tabular-nums">{s.open}</td>
                      <td className="px-3 py-2">
                        <Badge tone={s.winRate >= 40 ? "success" : s.winRate >= 15 ? "warning" : "neutral"}>
                          {s.winRate}%
                        </Badge>
                      </td>
                      <td className="px-3 py-2 tabular-nums">{formatCurrency(s.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Why we lose" subtitle="Reasons recorded on Lost deals">
          {lostReasons.length === 0 ? (
            <EmptyState title="No losses recorded" hint="Every Lost move asks for a reason — they collect here." />
          ) : (
            <Donut
              slices={lostReasons.map((r) => ({ label: r.reason, value: r.count }))}
              centerLabel={
                <>
                  <span className="font-display text-xl font-bold">
                    {lostReasons.reduce((n, r) => n + r.count, 0)}
                  </span>
                  <span className="text-[10px] text-muted">lost</span>
                </>
              }
            />
          )}
        </Panel>
      </div>

      <Panel title="Team leaderboard" subtitle="Pipeline and outcomes per owner" bodyClassName="p-0">
        {board.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No owners yet" hint="Assign leads to people to populate this." />
          </div>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-app text-left">
                  {["Owner", "Leads", "Open", "Won", "Lost", "Win rate", "Overdue", "Activities", "Revenue"].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {board.map((row) => (
                  <tr key={row.ownerId ?? "unassigned"} className="border-b border-app last:border-0">
                    <td className="px-3 py-2 font-medium">
                      {row.ownerId ? (
                        <Link href={`/leads?owner=${row.ownerId}`} className="text-brand-500 hover:underline">
                          {row.name}
                        </Link>
                      ) : (
                        row.name
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{row.leads}</td>
                    <td className="px-3 py-2 tabular-nums">{row.open}</td>
                    <td className="px-3 py-2 tabular-nums text-emerald-600 dark:text-emerald-400">{row.won}</td>
                    <td className="px-3 py-2 tabular-nums text-red-600 dark:text-red-400">{row.lost}</td>
                    <td className="px-3 py-2 tabular-nums">{row.winRate}%</td>
                    <td
                      className={`px-3 py-2 tabular-nums ${row.overdue ? "font-semibold text-red-600 dark:text-red-400" : ""}`}
                    >
                      {row.overdue}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{row.activities}</td>
                    <td className="px-3 py-2 tabular-nums">{formatCurrency(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Lead status by owner"
        subtitle="Where each person's book is sitting right now"
        bodyClassName="p-0"
      >
        {matrix.length === 0 || matrixStages.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Nothing to show" hint="Assign owners to leads to build this report." />
          </div>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-app text-left">
                  <th className="px-3 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
                    Owner
                  </th>
                  {matrixStages.map((s) => (
                    <th
                      key={s.key}
                      className="px-2 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase"
                      title={s.label}
                    >
                      {s.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((row) => (
                  <tr key={row.ownerId ?? "unassigned"} className="border-b border-app last:border-0">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">{row.name}</td>
                    {matrixStages.map((s) => (
                      <td key={s.key} className="px-2 py-2 tabular-nums">
                        {row.counts[s.key] || <span className="text-muted">·</span>}
                      </td>
                    ))}
                    <td className="px-3 py-2 font-semibold tabular-nums">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Twelve-week trend" subtitle="New leads, wins and activity volume">
        <LineChart
          labels={trend.map((p) => p.label)}
          series={[
            { name: "New leads", points: trend.map((p) => p.newLeads) },
            { name: "Won", points: trend.map((p) => p.won), color: "#1e8e5a" },
            { name: "Activities", points: trend.map((p) => p.activities), color: "#c9942a" },
          ]}
          height={200}
        />
      </Panel>
    </div>
  );
}
