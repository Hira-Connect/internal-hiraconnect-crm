"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { inviteMember, type InviteOutcome } from "@/lib/actions/team";
import { Button, Field, Input, Panel, Select } from "@/components/ui/primitives";
import { actionErrorClass, useAction } from "@/components/ui/use-action";
import { ROLES } from "@/lib/permissions";
import type { Team } from "@/lib/types";

export function InviteForm({ teams }: { teams: Team[] }) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const formRef = useRef<HTMLFormElement>(null);
  const [result, setResult] = useState<InviteOutcome | null>(null);

  return (
    <Panel
      title="Invite a teammate"
      subtitle="They get an email with a one-time link to choose their own password."
    >
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          const form = formRef.current;
          if (!form) return;
          setResult(null);
          run(
            () => inviteMember(new FormData(form)),
            (data) => {
              setResult(data ?? null);
              router.refresh();
              form.reset();
            },
          );
        }}
        className="space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Work email">
            <Input name="email" type="email" required placeholder="name@hiraconnect.com" autoComplete="off" />
          </Field>
          <Field label="Full name">
            <Input name="full_name" placeholder="Priya Sharma" autoComplete="off" />
          </Field>
          <Field label="Role" hint={ROLES.find((r) => r.value === "rep")?.blurb}>
            <Select name="role" defaultValue="rep">
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Team">
            <Select name="team_id" defaultValue="">
              <option value="">No team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {error && <p className={actionErrorClass()}>{error}</p>}
        {result && <InviteResult outcome={result} />}

        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send invitation"}
        </Button>
      </form>
    </Panel>
  );
}

/** The account exists either way. When the mail did not go out we hand the admin
 *  the link instead of pretending it did — it is the difference between a
 *  teammate who can sign in today and one who is stuck. */
export function InviteResult({ outcome }: { outcome: InviteOutcome }) {
  const [copied, setCopied] = useState(false);

  if (outcome.emailed) {
    return (
      <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
        Sent to <b>{outcome.email}</b>. The link works once and expires, so nudge them if they sit on it.
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
      <p>
        The account is ready, but we could not email <b>{outcome.email}</b>
        {outcome.reason ? ` — ${outcome.reason}` : ""}. Send them this one-time link yourself instead:
      </p>
      <div className="flex gap-2">
        <input
          readOnly
          value={outcome.link}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded border border-amber-500/40 bg-white/70 px-2 py-1 font-mono text-[11px] dark:bg-navy-900/40"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(outcome.link).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
