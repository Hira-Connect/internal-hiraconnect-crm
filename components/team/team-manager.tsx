"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createTeam, deleteTeam, updateMember, updateTeam } from "@/lib/actions/team";
import { recomputeAllScores, transferLeads } from "@/lib/actions/leads";
import { Avatar, Badge, Button, EmptyState, Field, Input, Panel, Select } from "@/components/ui/primitives";
import { actionErrorClass, useAction } from "@/components/ui/use-action";
import { ROLES, isAdmin } from "@/lib/permissions";
import { displayName } from "@/lib/format";
import type { LeadRow, Profile, Role, Team } from "@/lib/types";

export function TeamManager({
  profiles,
  teams,
  leads,
  me,
}: {
  profiles: Profile[];
  teams: Team[];
  leads: LeadRow[];
  me: Profile;
}) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const admin = isAdmin(me);
  const [message, setMessage] = useState<string | null>(null);

  const openCountFor = (id: string) =>
    leads.filter((l) => l.owner_id === id && !["Won", "Lost"].includes(l.status)).length;

  return (
    <div className="space-y-4">
      {!admin && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          You can see the roster, but only an admin can change roles, teams or transfer a book of leads.
        </p>
      )}

      {message && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          {message}
        </p>
      )}
      {error && <p className={actionErrorClass()}>{error}</p>}

      <Panel
        title="People"
        subtitle="Roles decide what each person can see — the database enforces it, not just the UI."
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[800px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-app text-left">
                {["Person", "Role", "Team", "Open leads", "Status", ""].map((h) => (
                  <th key={h} className="px-3 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profiles.map((person) => (
                <tr key={person.id} className="border-b border-app last:border-0">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar name={person.full_name ?? person.email} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {displayName(person)}
                          {person.id === me.id && <span className="ml-1 text-[11px] text-muted">(you)</span>}
                        </div>
                        <div className="truncate text-[11px] text-muted">{person.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {admin ? (
                      <Select
                        value={person.role}
                        disabled={pending}
                        className="w-auto py-1 text-xs"
                        aria-label={`Role for ${displayName(person)}`}
                        onChange={(e) =>
                          run(
                            () => updateMember(person.id, { role: e.target.value as Role }),
                            () => router.refresh(),
                          )
                        }
                      >
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Badge tone={person.role === "admin" ? "gold" : person.role === "manager" ? "brand" : "neutral"}>
                        {ROLES.find((r) => r.value === person.role)?.label}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {admin ? (
                      <Select
                        value={person.team_id ?? ""}
                        disabled={pending}
                        className="w-auto py-1 text-xs"
                        aria-label={`Team for ${displayName(person)}`}
                        onChange={(e) =>
                          run(
                            () => updateMember(person.id, { teamId: e.target.value || null }),
                            () => router.refresh(),
                          )
                        }
                      >
                        <option value="">No team</option>
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="text-xs">{teams.find((t) => t.id === person.team_id)?.name ?? "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{openCountFor(person.id)}</td>
                  <td className="px-3 py-2">
                    {person.is_active ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge tone="neutral">Deactivated</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {admin && (
                      <div className="flex items-center justify-end gap-2">
                        <TransferControl
                          person={person}
                          profiles={profiles}
                          openCount={openCountFor(person.id)}
                          onDone={(moved) => {
                            setMessage(`Moved ${moved} open lead(s).`);
                            router.refresh();
                          }}
                        />
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => updateMember(person.id, { isActive: !person.is_active }),
                              () => router.refresh(),
                            )
                          }
                          className="text-[11px] text-muted hover:underline"
                        >
                          {person.is_active ? "Deactivate" : "Reactivate"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-app px-3 py-2 text-[11px] text-muted">
          New accounts are created in Supabase Auth (Dashboard → Authentication → Users). They appear here as a
          rep the moment they first sign in; deactivating keeps all their history intact.
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <TeamsPanel teams={teams} profiles={profiles} admin={admin} />

        {admin && (
          <Panel title="Maintenance" subtitle="Occasional admin jobs">
            <div className="space-y-3">
              <div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => recomputeAllScores(),
                      (data) => {
                        setMessage(`Rescored ${data?.scored ?? 0} leads.`);
                        router.refresh();
                      },
                    )
                  }
                >
                  {pending ? "Working…" : "Rescore every lead"}
                </Button>
                <p className="mt-1 text-[11px] text-muted">
                  Run this after bulk-editing company firmographics, or after changing the scoring weights.
                </p>
              </div>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

function TransferControl({
  person,
  profiles,
  openCount,
  onDone,
}: {
  person: Profile;
  profiles: Profile[];
  openCount: number;
  onDone: (moved: number) => void;
}) {
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");

  if (openCount === 0) return null;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[11px] text-brand-500 hover:underline">
        Transfer {openCount}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className="w-auto py-1 text-xs"
        aria-label="Transfer to"
      >
        <option value="">To…</option>
        {profiles
          .filter((p) => p.id !== person.id && p.is_active)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {displayName(p)}
            </option>
          ))}
      </Select>
      <Button
        size="sm"
        disabled={pending || !target}
        onClick={() =>
          run(
            () => transferLeads(person.id, target),
            (data) => {
              onDone(data?.moved ?? 0);
              setOpen(false);
            },
          )
        }
      >
        Go
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        ×
      </Button>
    </div>
  );
}

function TeamsPanel({
  teams,
  profiles,
  admin,
}: {
  teams: Team[];
  profiles: Profile[];
  admin: boolean;
}) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState<Team | null>(null);

  return (
    <Panel title="Teams" subtitle="Managers see every lead owned by their team.">
      {teams.length === 0 ? (
        <EmptyState title="No teams yet" hint="Create one so managers have a book to oversee." />
      ) : (
        <ul className="mb-3 space-y-2">
          {teams.map((team) => (
            <li key={team.id} className="flex items-center gap-2 border-b border-app pb-2 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{team.name}</p>
                <p className="truncate text-[11px] text-muted">
                  {profiles.filter((p) => p.team_id === team.id).length} members
                  {team.manager_id &&
                    ` · led by ${displayName(profiles.find((p) => p.id === team.manager_id) ?? null)}`}
                </p>
              </div>
              {admin && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(team)}>
                    Edit
                  </Button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => deleteTeam(team.id), () => router.refresh())}
                    className="text-[11px] text-red-600 hover:underline dark:text-red-400"
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {admin && (
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            const form = formRef.current;
            if (!form) return;
            const data = new FormData(form);
            run(
              () => (editing ? updateTeam(editing.id, data) : createTeam(data)),
              () => {
                router.refresh();
                setEditing(null);
                form.reset();
              },
            );
          }}
          className="space-y-2 border-t border-app pt-3"
        >
          <p className="text-xs font-semibold">{editing ? `Edit ${editing.name}` : "New team"}</p>
          <Field label="Name">
            <Input name="name" key={editing?.id ?? "new"} defaultValue={editing?.name ?? ""} required />
          </Field>
          <Field label="Manager">
            <Select name="manager_id" defaultValue={editing?.manager_id ?? ""}>
              <option value="">— none —</option>
              {profiles
                .filter((p) => p.role !== "rep")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {displayName(p)}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Description">
            <Input name="description" defaultValue={editing?.description ?? ""} />
          </Field>
          {error && <p className={actionErrorClass()}>{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {editing ? "Save team" : "Create team"}
            </Button>
            {editing && (
              <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
    </Panel>
  );
}
