"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createCompany, setCompanyIcp, updateCompany } from "@/lib/actions/accounts";
import { Badge, Button, EmptyState, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { actionErrorClass, useAction } from "@/components/ui/use-action";
import { cn } from "@/lib/format";
import type { Company, LeadRow } from "@/lib/types";

const SIZE_BANDS = [
  { value: "", label: "— unknown —" },
  { value: "small", label: "Small (<50)" },
  { value: "mid", label: "Mid (50–249)" },
  { value: "large", label: "Large (250–999)" },
  { value: "enterprise", label: "Enterprise (1000+)" },
];

const HIRING_NEEDS = [
  { value: "", label: "— unknown —" },
  { value: "niche", label: "Niche roles" },
  { value: "general", label: "General hiring" },
];

export function CompanyManager({
  companies,
  leads,
  focusId,
}: {
  companies: Company[];
  leads: LeadRow[];
  focusId?: string;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Company | null>(null);
  const [creating, setCreating] = useState(false);

  const leadCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const lead of leads) {
      if (!lead.company_id) continue;
      map.set(lead.company_id, (map.get(lead.company_id) ?? 0) + 1);
    }
    return map;
  }, [leads]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) =>
      [c.name, c.industry, c.location, c.domain].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [companies, query]);

  return (
    <div className="space-y-3">
      <div className="surface flex flex-wrap items-center gap-2 rounded-xl border p-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search companies…"
          className="w-auto min-w-[200px] flex-1 py-1.5"
        />
        <Button size="sm" onClick={() => setCreating(true)}>
          + New company
        </Button>
      </div>

      <div className="surface overflow-x-auto rounded-xl border scroll-thin">
        {filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No companies yet" hint="Add one so leads can inherit its firmographics." />
          </div>
        ) : (
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-app text-left">
                {["Company", "Industry", "Size", "Location", "ICP", "Leads", ""].map((h) => (
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
              {filtered.map((company) => (
                <tr
                  key={company.id}
                  className={cn(
                    "border-b border-app last:border-0 hover:surface-alt",
                    focusId === company.id && "surface-alt",
                  )}
                >
                  <td className="px-3 py-2">
                    <span className="font-medium">{company.name}</span>
                    {company.website && (
                      <a
                        href={company.website.startsWith("http") ? company.website : `https://${company.website}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-[11px] text-brand-500 hover:underline"
                      >
                        {company.domain ?? company.website}
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{company.industry ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {company.size_band ?? "—"}
                    {company.employee_count ? ` · ${company.employee_count}` : ""}
                  </td>
                  <td className="px-3 py-2 text-xs">{company.location ?? "—"}</td>
                  <td className="px-3 py-2">
                    <IcpToggle company={company} />
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums">
                    {leadCounts.get(company.id) ? (
                      <Link href={`/leads?q=${encodeURIComponent(company.name)}`} className="hover:underline">
                        {leadCounts.get(company.id)}
                      </Link>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(company)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(creating || editing) && (
        <CompanyDialog
          company={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function IcpToggle({ company }: { company: Company }) {
  const { run, pending } = useAction();
  const next = company.is_icp === true ? false : true;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => run(() => setCompanyIcp(company.id, next))}
      title="ICP match lifts the fit score by up to 10 points"
    >
      {company.is_icp === true ? (
        <Badge tone="success">ICP</Badge>
      ) : company.is_icp === false ? (
        <Badge tone="neutral">Not ICP</Badge>
      ) : (
        <Badge tone="warning">Set ICP</Badge>
      )}
    </button>
  );
}

function CompanyDialog({ company, onClose }: { company?: Company; onClose: () => void }) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const formRef = useRef<HTMLFormElement>(null);

  const submit = () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    run(
      () => (company ? updateCompany(company.id, data) : createCompany(data)),
      () => {
        router.refresh();
        onClose();
      },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/50 px-4 py-10">
      <button type="button" aria-label="Close" className="fixed inset-0 cursor-default" onClick={onClose} />
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="surface relative w-full max-w-xl space-y-3 rounded-xl border p-5 shadow-2xl"
      >
        <h2 className="text-base">{company ? "Edit company" : "Add a company"}</h2>
        <p className="text-xs text-muted">
          Size, industry and the ICP flag feed the fit half of every linked lead&apos;s score.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name *">
            <Input name="name" defaultValue={company?.name ?? ""} required />
          </Field>
          <Field label="Website">
            <Input name="website" defaultValue={company?.website ?? ""} placeholder="company.com" />
          </Field>
          <Field label="Industry">
            <Input name="industry" defaultValue={company?.industry ?? ""} />
          </Field>
          <Field label="Location">
            <Input name="location" defaultValue={company?.location ?? ""} />
          </Field>
          <Field label="Employees" hint="Leave blank to pick a band manually.">
            <Input name="employee_count" type="number" min="0" defaultValue={company?.employee_count ?? ""} />
          </Field>
          <Field label="Size band">
            <Select name="size_band" defaultValue={company?.size_band ?? ""}>
              {SIZE_BANDS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Hiring need">
            <Select name="hiring_need" defaultValue={company?.hiring_need ?? ""}>
              {HIRING_NEEDS.map((h) => (
                <option key={h.value} value={h.value}>
                  {h.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ideal customer profile">
            <label className="flex items-center gap-2 py-2 text-sm">
              <input type="checkbox" name="is_icp" defaultChecked={company?.is_icp === true} />
              This company matches our ICP
            </label>
          </Field>
        </div>

        <Field label="Notes">
          <Textarea name="notes" defaultValue={company?.notes ?? ""} />
        </Field>

        {error && <p className={actionErrorClass()}>{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : company ? "Save" : "Add company"}
          </Button>
        </div>
      </form>
    </div>
  );
}
