"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createLead, updateLead } from "@/lib/actions/leads";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { actionErrorClass, useAction } from "@/components/ui/use-action";
import { assignableOwners } from "@/lib/permissions";
import { displayName } from "@/lib/format";
import type { Company, LeadRow, Profile, Stage } from "@/lib/types";

const SOURCES = [
  "Referral",
  "Website Signup",
  "Inbound",
  "Outbound",
  "LinkedIn",
  "Event",
  "Partner",
  "Other",
];

/** Create/edit form shared by the "New lead" dialog and the detail page. */
export function LeadForm({
  lead,
  companies,
  profiles,
  me,
  stages,
  existingLeads = [],
  onDone,
}: {
  lead?: LeadRow;
  companies: Company[];
  profiles: Profile[];
  me: Profile;
  stages: Stage[];
  /** Used for the duplicate-email nudge when adding. */
  existingLeads?: { id: string; name: string; email: string | null }[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const formRef = useRef<HTMLFormElement>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);

  const owners = assignableOwners(me, profiles);
  const editing = Boolean(lead);

  /** Data-quality guard: flag an existing lead on the same address before we
   *  create a twin record. Non-blocking — sometimes a second deal is genuine. */
  const checkDuplicate = (email: string) => {
    const value = email.trim().toLowerCase();
    if (!value) {
      setDuplicate(null);
      return;
    }
    const hit = existingLeads.find((l) => l.email?.toLowerCase() === value && l.id !== lead?.id);
    setDuplicate(hit ? { id: hit.id, name: hit.name } : null);
  };

  const submit = () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    run(
      () => (lead ? updateLead(lead.id, data) : createLead(data)),
      (result) => {
        if (!lead && result && typeof result === "object" && "id" in result) {
          router.push(`/leads/${(result as { id: string }).id}`);
        } else {
          router.refresh();
        }
        onDone?.();
      },
    );
  };

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name *">
          <Input name="name" defaultValue={lead?.name ?? ""} required placeholder="Contact name" />
        </Field>
        <Field label="Company">
          <Select name="company_id" defaultValue={lead?.company_id ?? ""}>
            <option value="">— none —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Job title" hint="Drives the decision-maker part of the fit score.">
          <Input name="title" defaultValue={lead?.title ?? ""} placeholder="e.g. Head of Talent" />
        </Field>
        <Field label="Source" hint="Referrals and inbound score higher than cold outbound.">
          <Select name="source" defaultValue={lead?.source ?? ""}>
            <option value="">— unknown —</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Email">
          <Input
            name="email"
            type="email"
            defaultValue={lead?.email ?? ""}
            onBlur={(e) => checkDuplicate(e.target.value)}
            placeholder="name@company.com"
          />
        </Field>
        <Field label="Phone">
          <Input name="phone" defaultValue={lead?.phone ?? ""} placeholder="+91…" />
        </Field>
        <Field label="WhatsApp">
          <Input name="whatsapp" defaultValue={lead?.whatsapp ?? ""} />
        </Field>
        <Field label="LinkedIn">
          <Input name="linkedin" defaultValue={lead?.linkedin ?? ""} placeholder="https://linkedin.com/in/…" />
        </Field>
        <Field label="Next action">
          <Input name="next_action" defaultValue={lead?.next_action ?? ""} placeholder="e.g. Send proposal" />
        </Field>
        <Field label="Follow up on">
          <Input name="next_action_date" type="date" defaultValue={lead?.next_action_date ?? ""} />
        </Field>
        <Field label="Expected value (₹)">
          <Input
            name="expected_value"
            type="number"
            min="0"
            step="1000"
            defaultValue={lead?.expected_value ?? ""}
            placeholder="0"
          />
        </Field>
        <Field label="Expected close">
          <Input name="close_date" type="date" defaultValue={lead?.close_date ?? ""} />
        </Field>

        {!editing && (
          <>
            <Field label="Stage">
              <Select name="status" defaultValue={lead?.status ?? "New"}>
                {stages
                  .filter((s) => s.is_active && s.category === "open")
                  .map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Owner">
              <Select name="owner_id" defaultValue={me.id}>
                {owners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {displayName(p)}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        {editing && (
          <Field label="Priority" className="sm:col-span-2">
            <Select name="priority" defaultValue={lead?.priority ?? ""}>
              <option value="">— none —</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </Select>
          </Field>
        )}
      </div>

      {duplicate && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          <a href={`/leads/${duplicate.id}`} className="font-semibold underline">
            {duplicate.name}
          </a>{" "}
          already uses this email. Add anyway only if this is a separate deal.
        </p>
      )}
      {error && <p className={actionErrorClass()}>{error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        {onDone && (
          <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create lead"}
        </Button>
      </div>
    </form>
  );
}
