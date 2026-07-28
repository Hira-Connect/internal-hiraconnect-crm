"use client";

import { useEffect } from "react";
import { Button, Panel } from "@/components/ui/primitives";

/** Most failures here are one of two things: the v2 migrations have not been
 *  pushed yet (missing table/column), or RLS refused the row. Say which. */
export default function CrmError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const message = error.message ?? "";
  const looksLikeMissingSchema =
    /relation .* does not exist|column .* does not exist|could not find|schema cache|PGRST/i.test(message);

  return (
    <div className="mx-auto max-w-2xl py-10">
      <Panel title="This screen could not load">
        {looksLikeMissingSchema ? (
          <>
            <p className="text-sm">
              The database is missing tables or columns this build expects — the v2 migrations probably
              have not been applied yet.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-navy-50 p-3 text-[11px] dark:bg-navy-900">
              supabase link --project-ref tcojgrxtpldiieytvthl{"\n"}
              supabase db push
            </pre>
          </>
        ) : (
          <p className="text-sm">
            Something went wrong loading this page. If this keeps happening, it may be a permissions rule —
            ask an admin to check your role on the Team screen.
          </p>
        )}

        <p className="mt-3 rounded-lg bg-navy-50 px-3 py-2 font-mono text-[11px] break-words dark:bg-navy-900">
          {message || "Unknown error"}
        </p>

        <div className="mt-4">
          <Button onClick={reset}>Try again</Button>
        </div>
      </Panel>
    </div>
  );
}
