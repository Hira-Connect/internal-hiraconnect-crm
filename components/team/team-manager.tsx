"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  cancelInvite,
  createTeam,
  deleteTeam,
  resendInvite,
  sendTestEmail,
  updateMember,
  updateTeam,
  type InviteOutcome,
} from "@/lib/actions/team";
import { recomputeAllScores, transferLeads } from "@/lib/actions/leads";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  KeyValue,
  Panel,
  Select,
} from "@/components/ui/primitives";
import { actionErrorClass, useAction } from "@/components/ui/use-action";
import { InviteForm, InviteResult } from "@/components/team/invite-form";
import { ROLES, isAdmin } from "@/lib/permissions";
import { displayName, relTime } from "@/lib/format";
import type { AccountState, LeadRow, Profile, Role, Team } from "@/lib/types";

/** What the server has configured for outgoing mail and admin access. Null for
 *  non-admins. `serviceKey` is the key's *validity*, not its presence — a
 *  present-but-wrong key is the failure this panel exists to name. */
export interface DeliveryStatus {
  transport: "resend" | "smtp" | "none";
  detail: string;
  from: string;
  secretSet: boolean;
  serviceKey: "ok" | "missing" | "invalid";
  serviceKeyProblem: string | null;
  siteUrl: string | null;
}

export function TeamManager({
  profiles,
  teams,
  leads,
  me,
  accountStates,
  delivery,
}: {
  profiles: Profile[];
  teams: Team[];
  leads: LeadRow[];
  me: Profile;
  accountStates: Record<string, AccountState>;
  delivery: DeliveryStatus | null;
}) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const admin = isAdmin(me);
  const [message, setMessage] = useState<string | null>(null);
  const [resent, setResent] = useState<InviteOutcome | null>(null);

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
      {resent && <InviteResult outcome={resent} />}

      {admin && <InviteForm teams={teams} />}

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
                    <StatusCell person={person} state={accountStates[person.id]} />
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
                        {accountStates[person.id]?.confirmed === false ? (
                          <>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                run(
                                  () => resendInvite(person.id),
                                  (data) => {
                                    setResent(data ?? null);
                                    setMessage(null);
                                  },
                                )
                              }
                              className="text-[11px] text-brand-500 hover:underline"
                            >
                              Resend invite
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => {
                                if (!confirm(`Delete the pending account for ${person.email}?`)) return;
                                run(
                                  () => cancelInvite(person.id),
                                  () => {
                                    setResent(null);
                                    setMessage("Invitation cancelled.");
                                    router.refresh();
                                  },
                                );
                              }}
                              className="text-[11px] text-red-600 hover:underline dark:text-red-400"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          person.is_active && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                run(
                                  () => resendInvite(person.id),
                                  (data) => {
                                    setResent(data ?? null);
                                    setMessage(null);
                                  },
                                )
                              }
                              className="text-[11px] text-muted hover:underline"
                              title="Emails them a one-time link to set a new password"
                            >
                              Send reset link
                            </button>
                          )
                        )}
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
          Invited people appear straight away and stay <b>Invited</b> until they open their link and choose a
          password. Deactivating keeps all their history intact; cancelling is only possible before they
          accept.
        </p>
      </Panel>

      {delivery && <DeliveryPanel delivery={delivery} />}

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

/** Reads back what THIS deployment has configured, and lets an admin prove it by
 *  sending a real email to themselves. When invitations or resets do not arrive,
 *  the cause is almost always visible here — a missing variable, or the mail
 *  server's own rejection message. */
function DeliveryPanel({ delivery }: { delivery: DeliveryStatus }) {
  const { run, pending, error } = useAction();
  const [sentTo, setSentTo] = useState<string | null>(null);

  const problems: string[] = [];
  if (delivery.serviceKeyProblem) problems.push(delivery.serviceKeyProblem);
  if (delivery.transport === "none") {
    problems.push("No mail transport is set, so nothing can be emailed. Set SMTP_HOST, SMTP_USER and SMTP_PASS.");
  }
  if (delivery.transport === "smtp" && !delivery.secretSet) {
    problems.push("SMTP_PASS is empty — the mail server will refuse the connection.");
  }
  if (!delivery.siteUrl) {
    problems.push("NEXT_PUBLIC_SITE_URL is not set; links use whatever host the request arrived on.");
  } else if (delivery.siteUrl.includes("localhost")) {
    problems.push(`NEXT_PUBLIC_SITE_URL is ${delivery.siteUrl} — emailed links will point at localhost.`);
  }

  return (
    <Panel
      title="Email delivery"
      subtitle="What this deployment is configured with. Every value here comes from its environment."
    >
      <div className="space-y-2 text-xs">
        <KeyValue label="Transport">
          {delivery.transport === "none" ? (
            <Badge tone="danger">Not configured</Badge>
          ) : (
            <span className="font-mono">{delivery.detail}</span>
          )}
        </KeyValue>
        <KeyValue label="From">
          <span className="font-mono">{delivery.from}</span>
        </KeyValue>
        <KeyValue label="Links point to">
          <span className="font-mono">{delivery.siteUrl ?? "the incoming request's host"}</span>
        </KeyValue>
        <KeyValue label="Service key">
          {delivery.serviceKey === "ok" ? (
            <Badge tone="success">Valid</Badge>
          ) : delivery.serviceKey === "missing" ? (
            <Badge tone="danger">Missing</Badge>
          ) : (
            <Badge tone="danger">Wrong key</Badge>
          )}
        </KeyValue>

        {problems.length > 0 && (
          <ul className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            {problems.map((p) => (
              <li key={p}>• {p}</li>
            ))}
          </ul>
        )}

        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-red-700 dark:bg-red-500/10 dark:text-red-300">
            <p className="font-semibold">The mail server refused it:</p>
            <p className="mt-1 font-mono break-words">{error}</p>
          </div>
        )}
        {sentTo && !error && (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            Accepted for delivery to <b>{sentTo}</b>. If it does not arrive, it was accepted and then
            dropped — check spam, then the domain&apos;s SPF and DKIM records.
          </p>
        )}

        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(
              () => sendTestEmail(),
              (data) => setSentTo(data?.to ?? null),
            )
          }
        >
          {pending ? "Sending…" : "Send a test email to myself"}
        </Button>
      </div>
    </Panel>
  );
}

/** `state` is undefined for non-admins and for a deployment without the service
 *  key — then we show only what `profiles` knows, exactly as before. */
function StatusCell({ person, state }: { person: Profile; state: AccountState | undefined }) {
  if (!person.is_active) return <Badge tone="neutral">Deactivated</Badge>;

  if (state && !state.confirmed) {
    return (
      <div className="space-y-0.5">
        <Badge tone="warning">Invited</Badge>
        <p className="text-[11px] text-muted">
          {state.invitedAt ? `sent ${relTime(state.invitedAt)}` : "not signed in yet"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <Badge tone="success">Active</Badge>
      {state?.lastSignInAt && <p className="text-[11px] text-muted">seen {relTime(state.lastSignInAt)}</p>}
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
