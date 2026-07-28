"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { convertAllSignups, convertSignup } from "@/lib/actions/signups";
import { Badge, Button, EmptyState, Select } from "@/components/ui/primitives";
import { actionErrorClass, useAction } from "@/components/ui/use-action";
import { formatDate } from "@/lib/format";
import type { RawSignup } from "@/lib/types";

export function SignupList({ signups }: { signups: RawSignup[] }) {
  const { run, pending, error } = useAction();
  const [type, setType] = useState("");
  const [status, setStatus] = useState<"pending" | "converted" | "all">("pending");
  const [message, setMessage] = useState<string | null>(null);

  const types = useMemo(
    () => [...new Set(signups.map((s) => s.submit_type).filter(Boolean))] as string[],
    [signups],
  );

  const filtered = useMemo(
    () =>
      signups.filter((s) => {
        if (type && s.submit_type !== type) return false;
        if (status === "pending" && s.converted_lead_id) return false;
        if (status === "converted" && !s.converted_lead_id) return false;
        return true;
      }),
    [signups, type, status],
  );

  const pendingIds = filtered.filter((s) => !s.converted_lead_id).map((s) => s.id);

  return (
    <div className="space-y-3">
      <div className="surface flex flex-wrap items-center gap-2 rounded-xl border p-3">
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="w-auto py-1.5 text-xs"
          aria-label="Filter by status"
        >
          <option value="pending">Not converted</option>
          <option value="converted">Converted</option>
          <option value="all">All</option>
        </Select>
        <Select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="w-auto py-1.5 text-xs"
          aria-label="Filter by form type"
        >
          <option value="">All form types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>

        {pendingIds.length > 0 && (
          <Button
            size="sm"
            variant="gold"
            disabled={pending}
            onClick={() =>
              run(
                () => convertAllSignups(pendingIds),
                (data) => setMessage(`Converted ${data?.converted ?? 0} signup(s).`),
              )
            }
          >
            {pending ? "Converting…" : `Convert all ${pendingIds.length}`}
          </Button>
        )}
      </div>

      {message && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          {message}
        </p>
      )}
      {error && <p className={actionErrorClass()}>{error}</p>}

      <div className="surface overflow-x-auto rounded-xl border scroll-thin">
        {filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Nothing here" hint="Website form submissions land in this list." />
          </div>
        ) : (
          <table className="w-full min-w-[800px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-app text-left">
                {["Submitted", "Name", "Email", "Type", "Source", ""].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((signup) => (
                <tr key={signup.id} className="border-b border-app last:border-0 hover:surface-alt">
                  <td className="px-3 py-2 text-xs text-muted">
                    {formatDate(signup.submitted_at ?? signup.created_at)}
                  </td>
                  <td className="px-3 py-2">{signup.name ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{signup.email}</td>
                  <td className="px-3 py-2">
                    <Badge>{signup.submit_type ?? "—"}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{signup.source ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {signup.converted_lead_id ? (
                      <Link
                        href={`/leads/${signup.converted_lead_id}`}
                        className="text-xs text-brand-500 hover:underline"
                      >
                        View lead →
                      </Link>
                    ) : (
                      <Button
                        size="sm"
                        variant="gold"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => convertSignup(signup.id),
                            (data) =>
                              setMessage(
                                data?.duplicateOf
                                  ? `Matched the existing lead “${data.duplicateOf}” — logged an inbound touch instead of creating a duplicate.`
                                  : "Lead created.",
                              ),
                          )
                        }
                      >
                        Convert
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-muted">
        Showing {filtered.length} of {signups.length}. Converting checks the email against existing leads first,
        so repeat signups append to the original record.
      </p>
    </div>
  );
}
