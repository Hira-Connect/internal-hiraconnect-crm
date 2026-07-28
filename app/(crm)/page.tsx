import Link from "next/link";
import { Badge, EmptyState, LinkButton, Meter, Panel, StatCard } from "@/components/ui/primitives";
import { BarList, LineChart } from "@/components/charts";
import { GradeBadge, RotBadge, StageBadge } from "@/components/leads/badges";
import { TaskToggle } from "@/components/leads/task-toggle";
import {
  getLeads,
  getMyTasks,
  getRecentActivities,
  getStages,
  getTargets,
  requireProfile,
} from "@/lib/queries";
import { hotLeads, weeklyTrend } from "@/lib/analytics";
import { categoryOf, daysInStage, rotState, weightedValue } from "@/lib/stages";
import { PACE_STYLES, isCurrencyMetric, paceOf } from "@/lib/metrics";
import { formatCurrency, formatDate, monthISO, pct, relTime, todayISO } from "@/lib/format";

export default async function DashboardPage() {
  const [me, leads, stages, targets, activities] = await Promise.all([
    requireProfile(),
    getLeads(),
    getStages(),
    getTargets(),
    getRecentActivities(90),
  ]);
  const tasks = await getMyTasks(me.id);

  const today = todayISO();
  const thisMonth = monthISO();

  const open = leads.filter((l) => categoryOf(stages, l.status) === "open");
  const mine = open.filter((l) => l.owner_id === me.id);
  const overdue = open.filter((l) => l.next_action_date && l.next_action_date < today);
  const dueToday = open.filter((l) => l.next_action_date === today);
  const rotting = open.filter((l) => rotState(stages, l) === "rotting");
  const wonThisMonth = leads.filter((l) => l.won_at?.startsWith(thisMonth));
  const hot = hotLeads(leads, stages, 6);

  const queue = [...overdue, ...dueToday].sort((a, b) =>
    (a.next_action_date ?? "").localeCompare(b.next_action_date ?? ""),
  );

  const stageCounts = stages
    .filter((s) => s.category === "open")
    .map((s) => ({ label: s.label, value: open.filter((l) => l.status === s.key).length }))
    .filter((s) => s.value > 0);

  const monthTargets = targets.filter((t) => t.month?.startsWith(thisMonth));
  const trend = weeklyTrend(leads, activities, 12);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl">
            {greeting()}, {me.full_name?.split(" ")[0] ?? "there"}
          </h1>
          <p className="text-xs text-muted">
            {overdue.length > 0
              ? `${overdue.length} follow-up${overdue.length === 1 ? "" : "s"} overdue — clear those first.`
              : "Nothing overdue. Work the hot list below."}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <LinkButton href="/pipeline" variant="secondary" size="sm">
            Open pipeline
          </LinkButton>
          <LinkButton href="/leads" size="sm">
            All leads
          </LinkButton>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="My open leads" value={mine.length} href={`/leads?owner=${me.id}`} />
        <StatCard label="Open pipeline" value={open.length} href="/pipeline" />
        <StatCard label="Overdue" value={overdue.length} tone={overdue.length ? "danger" : "default"} />
        <StatCard label="Due today" value={dueToday.length} tone={dueToday.length ? "warning" : "default"} />
        <StatCard label="Rotting" value={rotting.length} tone={rotting.length ? "danger" : "default"} />
        <StatCard
          label="Weighted value"
          value={formatCurrency(weightedValue(stages, open))}
          hint={`${wonThisMonth.length} won this month`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* ------------------------------------------------- follow-up queue */}
        <Panel
          title="Follow-up queue"
          subtitle="Overdue and due today, oldest first"
          bodyClassName="p-0"
          action={<Badge tone={queue.length ? "danger" : "success"}>{queue.length}</Badge>}
        >
          {queue.length === 0 ? (
            <div className="p-4">
              <EmptyState title="Clean slate" hint="No follow-ups are due. Nice." />
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto scroll-thin">
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {queue.slice(0, 25).map((lead) => (
                    <tr key={lead.id} className="border-b border-app last:border-0 hover:surface-alt">
                      <td className="px-4 py-2">
                        <Link href={`/leads/${lead.id}`} className="font-medium text-brand-500 hover:underline">
                          {lead.name}
                        </Link>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                          {lead.company?.name ?? "No company"}
                          <RotBadge state={rotState(stages, lead)} days={daysInStage(lead)} />
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <StageBadge stage={lead.status} stages={stages} />
                      </td>
                      <td className="px-2 py-2">
                        <GradeBadge grade={lead.grade} score={lead.score_total} />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div
                          className={
                            (lead.next_action_date ?? "") < today
                              ? "text-xs font-semibold text-red-600 dark:text-red-400"
                              : "text-xs font-semibold text-gold-600 dark:text-gold-300"
                          }
                        >
                          {formatDate(lead.next_action_date)}
                        </div>
                        <div className="max-w-[160px] truncate text-[11px] text-muted">
                          {lead.next_action ?? "No action set"}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* --------------------------------------------------------- hot list */}
        <Panel title="Hot leads" subtitle="Grade A and B, still open">
          {hot.length === 0 ? (
            <EmptyState
              title="No hot leads yet"
              hint="Scores rise with company fit and recent activity. Fill in company size and ICP to sharpen them."
            />
          ) : (
            <ul className="space-y-2">
              {hot.map((lead) => (
                <li key={lead.id} className="flex items-center gap-2 border-b border-app pb-2 last:border-0">
                  <GradeBadge grade={lead.grade} score={lead.score_total} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/leads/${lead.id}`} className="block truncate text-sm hover:underline">
                      {lead.name}
                    </Link>
                    <p className="truncate text-[11px] text-muted">
                      {lead.company?.name ?? "No company"} · {lead.status}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted">{relTime(lead.last_activity_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        {/* ------------------------------------------------------- my tasks */}
        <Panel title="My open tasks" subtitle="Tasks you logged that are still outstanding">
          {tasks.length === 0 ? (
            <EmptyState title="No open tasks" hint="Log one from any lead's activity composer." />
          ) : (
            <ul className="space-y-2">
              {tasks.slice(0, 8).map((task) => {
                const late = task.due_date && task.due_date < today;
                return (
                  <li key={task.id} className="flex items-start gap-2 border-b border-app pb-2 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{task.notes ?? "Task"}</p>
                      <p className="text-[11px] text-muted">
                        <Link href={`/leads/${task.lead_id}`} className="hover:underline">
                          Open lead
                        </Link>
                        {task.due_date && (
                          <span className={late ? "text-red-600 dark:text-red-400" : undefined}>
                            {" · due "}
                            {formatDate(task.due_date)}
                          </span>
                        )}
                      </p>
                    </div>
                    <TaskToggle activityId={task.id} done={task.done} />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* --------------------------------------------------- stage spread */}
        <Panel title="Open pipeline by stage">
          <BarList items={stageCounts} emptyText="Nothing open right now." />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        {/* ---------------------------------------------------- this month */}
        <Panel
          title="This month's targets"
          subtitle="Pacing against where the month should be"
          action={
            <LinkButton href="/targets" variant="secondary" size="sm">
              Manage
            </LinkButton>
          }
        >
          {monthTargets.length === 0 ? (
            <EmptyState
              title="No targets set for this month"
              hint="Set them once and actuals fill in automatically from the CRM's own data."
              action={
                <LinkButton href="/targets" size="sm">
                  Set targets
                </LinkButton>
              }
            />
          ) : (
            <ul className="space-y-3">
              {monthTargets.slice(0, 6).map((t) => {
                const pace = paceOf(t.actual_value, t.target_value, t.month);
                const style = PACE_STYLES[pace];
                const fmt = (n: number) => (isCurrencyMetric(t.metric) ? formatCurrency(n) : String(n));
                return (
                  <li key={t.id}>
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="font-medium">{t.metric}</span>
                      <span className="tabular-nums">
                        {fmt(t.actual_value)} / {fmt(t.target_value)}
                      </span>
                    </div>
                    <Meter
                      value={t.actual_value}
                      max={t.target_value || 1}
                      tone={pace === "behind" ? "danger" : pace === "done" ? "success" : "brand"}
                      className="mt-1"
                    />
                    <p className={`mt-0.5 text-[11px] ${style.className}`}>
                      {style.label} · {pct(t.actual_value, t.target_value || 1)}%
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* -------------------------------------------------------- trend */}
        <Panel title="Last 12 weeks" subtitle="New leads, wins and logged activity">
          <LineChart
            labels={trend.map((p) => p.label)}
            series={[
              { name: "New leads", points: trend.map((p) => p.newLeads) },
              { name: "Won", points: trend.map((p) => p.won), color: "#1e8e5a" },
              { name: "Activities", points: trend.map((p) => p.activities), color: "#c9942a" },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}

function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
