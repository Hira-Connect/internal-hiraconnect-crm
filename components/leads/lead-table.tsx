"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { bulkAssign, bulkSetStage, setNextAction } from "@/lib/actions/leads";
import { logActivity } from "@/lib/actions/activities";
import { Badge, Button, EmptyState, Input, LinkButton, Select } from "@/components/ui/primitives";
import { actionErrorClass, useAction } from "@/components/ui/use-action";
import { GradeBadge, RotBadge } from "./badges";
import { StageControl } from "./stage-control";
import { OwnerControl } from "./owner-control";
import { LeadDialog } from "./lead-dialog";
import { canReassign } from "@/lib/permissions";
import { cn, displayName, formatCurrency, relTime, todayISO } from "@/lib/format";
import { categoryOf, daysInStage, rotState } from "@/lib/stages";
import type { Company, LeadRow, Profile, Stage } from "@/lib/types";

type SortKey = "score" | "recent" | "followup" | "name" | "value";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "score", label: "Score" },
  { key: "followup", label: "Follow-up date" },
  { key: "recent", label: "Last touch" },
  { key: "value", label: "Deal value" },
  { key: "name", label: "Name" },
];

export function LeadTable({
  leads,
  stages,
  profiles,
  companies,
  me,
  lostReasons,
  initialOwner,
  initialQuery,
  initialGrade,
  initialStage,
}: {
  leads: LeadRow[];
  stages: Stage[];
  profiles: Profile[];
  companies: Company[];
  me: Profile;
  lostReasons: string[];
  initialOwner?: string;
  initialQuery?: string;
  initialGrade?: string;
  initialStage?: string;
}) {
  const today = todayISO();
  const { run, pending, error } = useAction();

  const [query, setQuery] = useState(initialQuery ?? "");
  const [owner, setOwner] = useState(initialOwner ?? "");
  const [stage, setStage] = useState(initialStage ?? "");
  const [grade, setGrade] = useState(initialGrade ?? "");
  // arriving from a company or an owner link means you want the whole book, not just open deals
  const [view, setView] = useState<"all" | "open" | "overdue" | "unassigned">(
    initialQuery || initialOwner || initialGrade || initialStage ? "all" : "open",
  );
  const [sort, setSort] = useState<SortKey>("score");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});

  const reassign = canReassign(me);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = leads.filter((lead) => {
      if (q) {
        const haystack = [lead.name, lead.company?.name, lead.email, lead.phone, lead.title]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (owner === "unassigned" ? lead.owner_id !== null : owner && lead.owner_id !== owner) return false;
      if (stage && lead.status !== stage) return false;
      if (grade && lead.grade !== grade) return false;

      const isOpen = categoryOf(stages, lead.status) === "open";
      if (view === "open" && !isOpen) return false;
      if (view === "unassigned" && lead.owner_id !== null) return false;
      if (view === "overdue" && !(isOpen && lead.next_action_date && lead.next_action_date < today)) {
        return false;
      }
      return true;
    });

    const sorted = [...rows];
    sorted.sort((a, b) => {
      switch (sort) {
        case "score":
          return b.score_total - a.score_total;
        case "value":
          return (b.expected_value ?? 0) - (a.expected_value ?? 0);
        case "name":
          return a.name.localeCompare(b.name);
        case "recent":
          return new Date(b.last_activity_at ?? 0).getTime() - new Date(a.last_activity_at ?? 0).getTime();
        case "followup": {
          const av = a.next_action_date ?? "9999-12-31";
          const bv = b.next_action_date ?? "9999-12-31";
          return av.localeCompare(bv);
        }
        default:
          return 0;
      }
    });
    return sorted;
  }, [leads, query, owner, stage, grade, view, sort, stages, today]);

  const allSelected = filtered.length > 0 && filtered.every((l) => selected.has(l.id));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(filtered.map((l) => l.id)));
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const logNote = (leadId: string) => {
    const text = noteDraft[leadId]?.trim();
    if (!text) return;
    run(
      () => logActivity(leadId, { type: "Note", notes: text }),
      () => setNoteDraft((d) => ({ ...d, [leadId]: "" })),
    );
  };

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------------------ filters */}
      <div className="surface flex flex-wrap items-center gap-2 rounded-xl border p-3">
        <div className="flex gap-1 rounded-lg border border-app p-0.5">
          {(["open", "overdue", "unassigned", "all"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                view === v ? "bg-brand-500 text-white" : "hover:surface-alt",
              )}
            >
              {v}
            </button>
          ))}
        </div>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, company, email…"
          className="w-auto min-w-[180px] flex-1 py-1.5"
        />

        <Select value={owner} onChange={(e) => setOwner(e.target.value)} className="w-auto py-1.5 text-xs">
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

        <Select value={stage} onChange={(e) => setStage(e.target.value)} className="w-auto py-1.5 text-xs">
          <option value="">All stages</option>
          {stages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </Select>

        <Select value={grade} onChange={(e) => setGrade(e.target.value)} className="w-auto py-1.5 text-xs">
          <option value="">All grades</option>
          {["A", "B", "C", "D"].map((g) => (
            <option key={g} value={g}>
              Grade {g}
            </option>
          ))}
        </Select>

        <Select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="w-auto py-1.5 text-xs"
          aria-label="Sort by"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              Sort: {s.label}
            </option>
          ))}
        </Select>

        <LeadDialog companies={companies} profiles={profiles} me={me} stages={stages} existingLeads={leads} />
        <LinkButton href="/leads/import" variant="secondary" size="sm">
          Bulk upload
        </LinkButton>
      </div>

      {/* --------------------------------------------------------- bulk bar */}
      {selected.size > 0 && (
        <div className="surface flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/40 p-3">
          <span className="text-xs font-semibold">{selected.size} selected</span>
          {reassign && (
            <Select
              defaultValue=""
              className="w-auto py-1 text-xs"
              aria-label="Assign selected to"
              onChange={(e) => {
                const value = e.target.value;
                if (!value) return;
                run(() => bulkAssign([...selected], value === "unassigned" ? null : value), () =>
                  setSelected(new Set()),
                );
              }}
            >
              <option value="">Assign to…</option>
              <option value="unassigned">Unassigned</option>
              {profiles
                .filter((p) => p.is_active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {displayName(p)}
                  </option>
                ))}
            </Select>
          )}
          <Select
            defaultValue=""
            className="w-auto py-1 text-xs"
            aria-label="Move selected to stage"
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              run(() => bulkSetStage([...selected], value, "Bulk stage update"), () => setSelected(new Set()));
            }}
          >
            <option value="">Move to stage…</option>
            {stages
              .filter((s) => s.category === "open")
              .map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
          </Select>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          {pending && <span className="text-xs text-muted">Working…</span>}
        </div>
      )}

      {error && <p className={actionErrorClass()}>{error}</p>}

      {/* ------------------------------------------------------------- table */}
      <div className="surface overflow-x-auto rounded-xl border scroll-thin">
        {filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No leads match these filters"
              hint="Try switching the view to “all”, or clear the search box."
            />
          </div>
        ) : (
          <table className="w-full min-w-[1080px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-app text-left">
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all visible leads"
                  />
                </th>
                <Th>Lead</Th>
                <Th className="w-16">Score</Th>
                <Th className="w-44">Stage</Th>
                <Th className="w-40">Owner</Th>
                <Th className="w-40">Follow-up</Th>
                <Th className="w-24">Touches</Th>
                <Th className="w-52">Quick note</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => {
                const rot = rotState(stages, lead);
                const days = daysInStage(lead);
                const overdue = lead.next_action_date && lead.next_action_date < today;
                return (
                  <tr key={lead.id} className="border-b border-app align-middle last:border-0 hover:surface-alt">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(lead.id)}
                        onChange={() => toggleOne(lead.id)}
                        aria-label={`Select ${lead.name}`}
                      />
                    </td>

                    <td className="px-3 py-2">
                      <Link href={`/leads/${lead.id}`} className="font-medium text-brand-500 hover:underline">
                        {lead.name}
                      </Link>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                        <span>{lead.company?.name ?? "No company"}</span>
                        {lead.title && <span>· {lead.title}</span>}
                        <RotBadge state={rot} days={days} />
                      </div>
                    </td>

                    <td className="px-3 py-2">
                      <GradeBadge grade={lead.grade} score={lead.score_total} />
                    </td>

                    <td className="px-3 py-2">
                      <StageControl
                        leadId={lead.id}
                        current={lead.status}
                        stages={stages}
                        lostReasons={lostReasons}
                        size="sm"
                      />
                    </td>

                    <td className="px-3 py-2">
                      <OwnerControl
                        leadId={lead.id}
                        ownerId={lead.owner_id}
                        options={profiles}
                        disabled={!reassign}
                        size="sm"
                      />
                    </td>

                    <td className="px-3 py-2">
                      <Input
                        type="date"
                        defaultValue={lead.next_action_date ?? ""}
                        aria-label={`Follow-up date for ${lead.name}`}
                        onChange={(e) =>
                          run(() => setNextAction(lead.id, lead.next_action, e.target.value || null))
                        }
                        className={cn("px-2 py-1 text-xs", overdue && "border-red-500 text-red-600 dark:text-red-400")}
                      />
                      {lead.next_action && (
                        <div className="mt-0.5 truncate text-[11px] text-muted" title={lead.next_action}>
                          {lead.next_action}
                        </div>
                      )}
                    </td>

                    <td className="px-3 py-2 text-center">
                      <span className="font-semibold tabular-nums">{lead.total_reachouts ?? 0}</span>
                      <div className="text-[11px] text-muted">{relTime(lead.last_activity_at)}</div>
                    </td>

                    <td className="px-3 py-2">
                      <Input
                        value={noteDraft[lead.id] ?? ""}
                        placeholder="Note + Enter"
                        onChange={(e) => setNoteDraft((d) => ({ ...d, [lead.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            logNote(lead.id);
                          }
                        }}
                        className="px-2 py-1 text-xs"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-muted">
        Showing {filtered.length} of {leads.length} leads
        {filtered.length > 0 && (
          <>
            {" · "}
            <Badge tone="neutral">
              {formatCurrency(filtered.reduce((n, l) => n + (l.expected_value ?? 0), 0))} pipeline value
            </Badge>
          </>
        )}
      </p>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "px-3 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase whitespace-nowrap",
        className,
      )}
    >
      {children}
    </th>
  );
}
