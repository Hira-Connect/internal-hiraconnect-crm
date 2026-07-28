"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteTarget, seedMonth, syncActuals, upsertTarget } from "@/lib/actions/targets";
import { Button, EmptyState, Field, Input, Meter, Panel, Select } from "@/components/ui/primitives";
import { LineChart } from "@/components/charts";
import { actionErrorClass, useAction } from "@/components/ui/use-action";
import { METRIC_PRESETS, PACE_STYLES, isCurrencyMetric, paceOf } from "@/lib/metrics";
import { displayName, formatCurrency, formatMonth, monthISO, pct } from "@/lib/format";
import { canManageTargets } from "@/lib/permissions";
import type { MonthlyTarget, Profile } from "@/lib/types";

export function TargetManager({
  targets,
  profiles,
  me,
}: {
  targets: MonthlyTarget[];
  profiles: Profile[];
  me: Profile;
}) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const formRef = useRef<HTMLFormElement>(null);

  const canManage = canManageTargets(me);
  const months = useMemo(
    () => [...new Set(targets.map((t) => t.month?.slice(0, 7)).filter(Boolean))].sort().reverse() as string[],
    [targets],
  );

  const [month, setMonth] = useState(months[0] ?? monthISO());
  const [ownerFilter, setOwnerFilter] = useState("");
  const [showForm, setShowForm] = useState(false);

  const visible = targets.filter((t) => {
    if (t.month?.slice(0, 7) !== month) return false;
    if (ownerFilter === "team") return t.owner_id === null;
    if (ownerFilter) return t.owner_id === ownerFilter;
    return true;
  });

  const fmt = (metric: string, n: number) => (isCurrencyMetric(metric) ? formatCurrency(n) : String(n));

  // trend across all months for the metrics present in the current view
  const trendMetrics = [...new Set(visible.map((t) => t.metric))].slice(0, 3);
  const trendMonths = [...new Set(targets.map((t) => t.month?.slice(0, 7)))].filter(Boolean).sort() as string[];

  const submit = () => {
    const form = formRef.current;
    if (!form) return;
    run(
      () => upsertTarget(new FormData(form)),
      () => {
        router.refresh();
        setShowForm(false);
        form.reset();
      },
    );
  };

  return (
    <div className="space-y-4">
      <div className="surface flex flex-wrap items-center gap-2 rounded-xl border p-3">
        <Select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="w-auto py-1.5 text-xs"
          aria-label="Month"
        >
          {[...new Set([monthISO(), ...months])].sort().reverse().map((m) => (
            <option key={m} value={m}>
              {formatMonth(m)}
            </option>
          ))}
        </Select>

        <Select
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          className="w-auto py-1.5 text-xs"
          aria-label="Owner"
        >
          <option value="">Everyone</option>
          <option value="team">Company-wide only</option>
          {profiles
            .filter((p) => p.is_active)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {displayName(p)}
              </option>
            ))}
        </Select>

        {canManage && (
          <>
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>
              {showForm ? "Close" : "+ Set a target"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => syncActuals(), () => router.refresh())}
            >
              {pending ? "Refreshing…" : "Refresh actuals"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                run(
                  () => seedMonth(`${month}-01`, ownerFilter && ownerFilter !== "team" ? ownerFilter : null),
                  () => router.refresh(),
                )
              }
            >
              Add all metrics for {formatMonth(month)}
            </Button>
          </>
        )}
      </div>

      {error && <p className={actionErrorClass()}>{error}</p>}

      {showForm && canManage && (
        <Panel title="Set a target">
          <form
            ref={formRef}
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Field label="Month">
              <Input type="month" name="month" defaultValue={month} required />
            </Field>
            <Field label="Metric">
              <Select name="metric" required defaultValue={METRIC_PRESETS[0].key}>
                {METRIC_PRESETS.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Owner" hint="Leave blank for a company-wide target.">
              <Select name="owner_id" defaultValue="">
                <option value="">Company-wide</option>
                {profiles
                  .filter((p) => p.is_active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {displayName(p)}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Target">
              <Input type="number" name="target_value" min="0" step="1" required defaultValue={0} />
            </Field>
            <div className="sm:col-span-2 lg:col-span-4">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="auto_actual" defaultChecked value="on" />
                Compute the actual automatically from CRM data
              </label>
            </div>
            <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save target"}
              </Button>
            </div>
          </form>
          <ul className="mt-3 space-y-1 border-t border-app pt-3 text-[11px] text-muted">
            {METRIC_PRESETS.map((m) => (
              <li key={m.key}>
                <b>{m.label}</b> — {m.help} <span className="opacity-70">({m.source})</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={`${formatMonth(month)} targets`} bodyClassName="p-0">
        {visible.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No targets for this month"
              hint={
                canManage
                  ? "Use “Add all metrics” to create the full set in one click, then fill in the numbers."
                  : "A manager or admin needs to set these."
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-app text-left">
                  {["Metric", "Owner", "Target", "Actual", "Progress", "Pace", ""].map((h) => (
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
                {visible.map((t) => {
                  const pace = paceOf(t.actual_value, t.target_value, t.month);
                  const style = PACE_STYLES[pace];
                  const owner = profiles.find((p) => p.id === t.owner_id);
                  return (
                    <tr key={t.id} className="border-b border-app last:border-0">
                      <td className="px-3 py-2 font-medium">
                        {t.metric}
                        {t.auto_actual && <span className="ml-1.5 text-[10px] text-muted">auto</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {t.owner_id ? displayName(owner ?? null) : "Company-wide"}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{fmt(t.metric, t.target_value)}</td>
                      <td className="px-3 py-2 font-semibold tabular-nums">{fmt(t.metric, t.actual_value)}</td>
                      <td className="w-48 px-3 py-2">
                        <Meter
                          value={t.actual_value}
                          max={t.target_value || 1}
                          tone={pace === "behind" ? "danger" : pace === "done" ? "success" : "brand"}
                        />
                        <span className="text-[11px] text-muted tabular-nums">
                          {pct(t.actual_value, t.target_value || 1)}%
                        </span>
                      </td>
                      <td className={`px-3 py-2 text-xs ${style.className}`}>{style.label}</td>
                      <td className="px-3 py-2 text-right">
                        {canManage && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => run(() => deleteTarget(t.id), () => router.refresh())}
                            className="text-[11px] text-red-600 hover:underline dark:text-red-400"
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {trendMonths.length > 1 && trendMetrics.length > 0 && (
        <Panel title="Target vs actual over time" subtitle="Across every month with data">
          <LineChart
            labels={trendMonths.map((m) => formatMonth(m))}
            series={trendMetrics.flatMap((metric, i) => [
              {
                name: `${metric} — actual`,
                points: trendMonths.map((m) =>
                  targets
                    .filter((t) => t.month?.startsWith(m) && t.metric === metric)
                    .reduce((n, t) => n + t.actual_value, 0),
                ),
                color: ["#2e6bd6", "#1e8e5a", "#8b5cf6"][i],
              },
              {
                name: `${metric} — target`,
                points: trendMonths.map((m) =>
                  targets
                    .filter((t) => t.month?.startsWith(m) && t.metric === metric)
                    .reduce((n, t) => n + t.target_value, 0),
                ),
                color: ["#9bb8ea", "#8fd3b4", "#c4b5fd"][i],
              },
            ])}
            height={200}
          />
        </Panel>
      )}
    </div>
  );
}
