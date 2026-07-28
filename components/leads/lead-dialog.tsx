"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { LeadForm } from "./lead-form";
import type { Company, LeadRow, Profile, Stage } from "@/lib/types";

/** "New lead" button + modal. Kept separate from LeadForm so the same form can
 *  also render inline on the detail page. */
export function LeadDialog({
  companies,
  profiles,
  me,
  stages,
  existingLeads,
  label = "New lead",
}: {
  companies: Company[];
  profiles: Profile[];
  me: Profile;
  stages: Stage[];
  existingLeads?: LeadRow[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        + {label}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/50 px-4 py-10">
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="surface relative w-full max-w-2xl rounded-xl border p-5 shadow-2xl">
            <div className="mb-4 flex items-start">
              <div>
                <h2 className="text-base">Add a lead</h2>
                <p className="mt-0.5 text-xs text-muted">
                  Company size, job title and source all feed the fit score — fill what you know.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="ml-auto text-2xl leading-none text-muted"
              >
                ×
              </button>
            </div>
            <LeadForm
              companies={companies}
              profiles={profiles}
              me={me}
              stages={stages}
              existingLeads={existingLeads}
              onDone={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}
