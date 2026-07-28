"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { changeStage } from "@/lib/actions/leads";
import { Button, Input, Select } from "@/components/ui/primitives";
import { actionErrorClass, useAction } from "@/components/ui/use-action";
import { GradeBadge, RotBadge } from "@/components/leads/badges";
import { cn, displayName, formatCurrency, relTime, todayISO } from "@/lib/format";
import { daysInStage, findStage, rotState } from "@/lib/stages";
import type { LeadRow, Profile, Stage } from "@/lib/types";

const ROT_RING: Record<string, string> = {
  fresh: "border-app",
  warning: "border-amber-400/70",
  rotting: "border-red-400/70",
};

/** Drag-and-drop pipeline. Uses native HTML5 drag events — no dependency, and it
 *  degrades to the stage dropdown on the Leads table for touch devices. */
export function PipelineBoard({
  leads,
  stages,
  profiles,
  lostReasons,
}: {
  leads: LeadRow[];
  stages: Stage[];
  profiles: Profile[];
  lostReasons: string[];
}) {
  const { run, pending, error } = useAction();
  const today = todayISO();

  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [owner, setOwner] = useState("");
  const [prompt, setPrompt] = useState<{ leadId: string; stage: string } | null>(null);
  const [reason, setReason] = useState(lostReasons[0] ?? "");
  const [note, setNote] = useState("");

  const visible = useMemo(
    () => (owner ? leads.filter((l) => (owner === "unassigned" ? !l.owner_id : l.owner_id === owner)) : leads),
    [leads, owner],
  );

  const columns = useMemo(
    () => stages.filter((s) => s.is_active).sort((a, b) => a.sort - b.sort),
    [stages],
  );

  const byStage = useMemo(() => {
    const map = new Map<string, LeadRow[]>();
    for (const stage of columns) map.set(stage.key, []);
    for (const lead of visible) {
      if (!map.has(lead.status)) map.set(lead.status, []);
      map.get(lead.status)?.push(lead);
    }
    for (const list of map.values()) list.sort((a, b) => b.score_total - a.score_total);
    return map;
  }, [visible, columns]);

  const needsReason = (stageKey: string) => {
    const config = findStage(stages, stageKey);
    return config?.category === "lost" || stageKey === "Delayed";
  };

  const drop = (stageKey: string) => {
    setOverStage(null);
    const leadId = dragId;
    setDragId(null);
    if (!leadId) return;

    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.status === stageKey) return;

    if (needsReason(stageKey)) {
      setReason(lostReasons[0] ?? "");
      setNote("");
      setPrompt({ leadId, stage: stageKey });
      return;
    }
    run(() => changeStage(leadId, stageKey, null));
  };

  const confirmPrompt = () => {
    if (!prompt) return;
    const combined = [reason, note.trim()].filter(Boolean).join(" — ");
    run(() => changeStage(prompt.leadId, prompt.stage, combined || reason), () => setPrompt(null));
  };

  return (
    <div className="space-y-3">
      <div className="surface flex flex-wrap items-center gap-2 rounded-xl border p-3">
        <Select
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          className="w-auto py-1.5 text-xs"
          aria-label="Filter by owner"
        >
          <option value="">All owners</option>
          <option value="unassigned">Unassigned</option>
          {profiles
            .filter((p) => p.is_active)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {displayName(p)}
              </option>
            ))}
        </Select>
        <p className="text-xs text-muted">
          Drag a card to move it. Lost and Delayed ask for a reason before the move is saved.
        </p>
        {pending && <span className="text-xs text-muted">Saving…</span>}
      </div>

      {error && <p className={actionErrorClass()}>{error}</p>}

      <div className="flex gap-3 overflow-x-auto pb-3 scroll-thin">
        {columns.map((stage) => {
          const items = byStage.get(stage.key) ?? [];
          const value = items.reduce((n, l) => n + (l.expected_value ?? 0), 0);
          return (
            <section
              key={stage.key}
              onDragOver={(e) => {
                e.preventDefault();
                setOverStage(stage.key);
              }}
              onDragLeave={() => setOverStage((s) => (s === stage.key ? null : s))}
              onDrop={() => drop(stage.key)}
              className={cn(
                "flex w-64 shrink-0 flex-col rounded-xl border transition-colors",
                overStage === stage.key ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "surface",
              )}
            >
              <header className="border-b border-app px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="truncate text-xs font-semibold" title={stage.label}>
                    {stage.label}
                  </h3>
                  <span className="rounded-full bg-navy-100 px-1.5 text-[11px] font-semibold tabular-nums dark:bg-navy-700">
                    {items.length}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] text-muted">
                  {stage.funnel} · {stage.probability}% · {formatCurrency(value)}
                </p>
              </header>

              <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
                {items.length === 0 && (
                  <p className="px-1 py-4 text-center text-[11px] text-muted">Drop a lead here</p>
                )}
                {items.map((lead) => {
                  const rot = rotState(stages, lead);
                  const overdue = lead.next_action_date && lead.next_action_date < today;
                  return (
                    <article
                      key={lead.id}
                      draggable
                      onDragStart={() => setDragId(lead.id)}
                      onDragEnd={() => setDragId(null)}
                      className={cn(
                        "cursor-grab rounded-lg border bg-[var(--panel)] p-2.5 shadow-sm transition-opacity active:cursor-grabbing",
                        ROT_RING[rot],
                        dragId === lead.id && "opacity-40",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="min-w-0 flex-1 text-sm font-medium text-brand-500 hover:underline"
                        >
                          {lead.name}
                        </Link>
                        <GradeBadge grade={lead.grade} />
                      </div>
                      <p className="truncate text-[11px] text-muted">{lead.company?.name ?? "No company"}</p>

                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                        {lead.expected_value ? (
                          <span className="font-semibold">{formatCurrency(lead.expected_value)}</span>
                        ) : null}
                        <span>{displayName(lead.owner_profile)}</span>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <RotBadge state={rot} days={daysInStage(lead)} />
                        {overdue && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                            Follow-up overdue
                          </span>
                        )}
                        <span className="text-[10px] text-muted">{relTime(lead.last_activity_at)}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {prompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 px-4">
          <button
            type="button"
            aria-label="Cancel"
            className="absolute inset-0 cursor-default"
            onClick={() => setPrompt(null)}
          />
          <div className="surface relative w-full max-w-sm rounded-xl border p-5 shadow-2xl">
            <h3 className="text-sm">
              Why is this moving to <span className="font-bold">{prompt.stage}</span>?
            </h3>
            <div className="mt-4 space-y-3">
              <Select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
                {lostReasons.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Context for the team (optional)"
              />
            </div>
            {error && <p className={actionErrorClass()}>{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPrompt(null)} disabled={pending}>
                Cancel
              </Button>
              <Button size="sm" onClick={confirmPrompt} disabled={pending || !reason}>
                {pending ? "Saving…" : "Move"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
