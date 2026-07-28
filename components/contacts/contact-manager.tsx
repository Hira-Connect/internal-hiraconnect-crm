"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createContact, deleteContact, updateContact } from "@/lib/actions/accounts";
import { Badge, Button, EmptyState, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { actionErrorClass, useAction } from "@/components/ui/use-action";
import { inferSeniority } from "@/lib/scoring";
import { cn } from "@/lib/format";
import type { Company, Contact, Profile } from "@/lib/types";
import { isManagerUp } from "@/lib/permissions";

export function ContactManager({
  contacts,
  companies,
  me,
  focusId,
}: {
  contacts: Contact[];
  companies: Company[];
  me: Profile;
  focusId?: string;
}) {
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [editing, setEditing] = useState<Contact | null>(null);
  const [creating, setCreating] = useState(false);

  const companyName = useMemo(
    () => new Map(companies.map((c) => [c.id, c.name] as const)),
    [companies],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (companyFilter && c.company_id !== companyFilter) return false;
      if (!q) return true;
      const hay = [c.full_name, c.title, c.email, c.phone, companyName.get(c.company_id ?? "")]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [contacts, query, companyFilter, companyName]);

  return (
    <div className="space-y-3">
      <div className="surface flex flex-wrap items-center gap-2 rounded-xl border p-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search contacts…"
          className="w-auto min-w-[200px] flex-1 py-1.5"
        />
        <Select
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
          className="w-auto py-1.5 text-xs"
          aria-label="Filter by company"
        >
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Button size="sm" onClick={() => setCreating(true)}>
          + New contact
        </Button>
      </div>

      <div className="surface overflow-x-auto rounded-xl border scroll-thin">
        {filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No contacts match" hint="Contacts are created automatically with each new lead." />
          </div>
        ) : (
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-app text-left">
                {["Contact", "Company", "Seniority", "Email", "Phone", ""].map((h) => (
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
              {filtered.map((contact) => (
                <tr
                  key={contact.id}
                  className={cn(
                    "border-b border-app last:border-0 hover:surface-alt",
                    focusId === contact.id && "surface-alt",
                  )}
                >
                  <td className="px-3 py-2">
                    <span className="font-medium">{contact.full_name}</span>
                    {contact.is_primary && (
                      <Badge tone="brand" className="ml-2">
                        Primary
                      </Badge>
                    )}
                    {contact.title && <div className="text-[11px] text-muted">{contact.title}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {contact.company_id ? (companyName.get(contact.company_id) ?? "—") : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs capitalize">
                    {contact.seniority ?? inferSeniority(contact.title)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {contact.email ? (
                      <a href={`mailto:${contact.email}`} className="text-brand-500 hover:underline">
                        {contact.email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{contact.phone ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(contact)}>
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
        <ContactDialog
          contact={editing ?? undefined}
          companies={companies}
          canDelete={isManagerUp(me)}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ContactDialog({
  contact,
  companies,
  canDelete,
  onClose,
}: {
  contact?: Contact;
  companies: Company[];
  canDelete: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const formRef = useRef<HTMLFormElement>(null);
  const [confirming, setConfirming] = useState(false);

  const submit = () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    run(
      () => (contact ? updateContact(contact.id, data) : createContact(data)),
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
        <h2 className="text-base">{contact ? "Edit contact" : "Add a contact"}</h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name *">
            <Input name="full_name" defaultValue={contact?.full_name ?? ""} required />
          </Field>
          <Field label="Company">
            <Select name="company_id" defaultValue={contact?.company_id ?? ""}>
              <option value="">— none —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Job title" hint="Seniority is inferred from this.">
            <Input name="title" defaultValue={contact?.title ?? ""} />
          </Field>
          <Field label="Email">
            <Input name="email" type="email" defaultValue={contact?.email ?? ""} />
          </Field>
          <Field label="Phone">
            <Input name="phone" defaultValue={contact?.phone ?? ""} />
          </Field>
          <Field label="WhatsApp">
            <Input name="whatsapp" defaultValue={contact?.whatsapp ?? ""} />
          </Field>
          <Field label="LinkedIn" className="sm:col-span-2">
            <Input name="linkedin" defaultValue={contact?.linkedin ?? ""} />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_primary" defaultChecked={contact?.is_primary ?? false} />
          Primary contact for this company
        </label>

        <Field label="Notes">
          <Textarea name="notes" defaultValue={contact?.notes ?? ""} />
        </Field>

        {error && <p className={actionErrorClass()}>{error}</p>}

        <div className="flex items-center gap-2">
          {contact && canDelete && (
            <>
              {confirming ? (
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  disabled={pending}
                  onClick={() =>
                    run(() => deleteContact(contact.id), () => {
                      router.refresh();
                      onClose();
                    })
                  }
                >
                  Confirm delete
                </Button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="text-[11px] text-red-600 hover:underline dark:text-red-400"
                >
                  Delete
                </button>
              )}
            </>
          )}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : contact ? "Save" : "Add contact"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
