"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteLead } from "@/lib/actions/leads";
import { Button, Panel } from "@/components/ui/primitives";
import { actionErrorClass, useAction } from "@/components/ui/use-action";
import { LeadForm } from "./lead-form";
import { canDeleteLead } from "@/lib/permissions";
import type { Company, LeadRow, Profile, Stage } from "@/lib/types";

export function LeadEditPanel({
  lead,
  companies,
  profiles,
  me,
  stages,
}: {
  lead: LeadRow;
  companies: Company[];
  profiles: Profile[];
  me: Profile;
  stages: Stage[];
}) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <Panel
      title="Lead details"
      action={
        <Button size="sm" variant="secondary" onClick={() => setEditing((v) => !v)}>
          {editing ? "Close" : "Edit"}
        </Button>
      }
    >
      {editing ? (
        <LeadForm
          lead={lead}
          companies={companies}
          profiles={profiles}
          me={me}
          stages={stages}
          onDone={() => setEditing(false)}
        />
      ) : (
        <p className="text-xs text-muted">
          Edit the contact details, source, deal value and follow-up. Stage and owner are changed from the
          header so every move is logged with a reason.
        </p>
      )}

      {canDeleteLead(me, lead) && (
        <div className="mt-4 border-t border-app pt-3">
          {confirming ? (
            <div className="space-y-2">
              <p className="text-xs text-red-600 dark:text-red-400">
                Delete <b>{lead.name}</b> and its whole history? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={pending}
                  onClick={() => run(() => deleteLead(lead.id), () => router.push("/leads"))}
                >
                  {pending ? "Deleting…" : "Yes, delete"}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-[11px] text-red-600 hover:underline dark:text-red-400"
            >
              Delete this lead
            </button>
          )}
          {error && <p className={actionErrorClass()}>{error}</p>}
        </div>
      )}
    </Panel>
  );
}
