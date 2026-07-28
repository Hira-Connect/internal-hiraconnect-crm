import type { Metadata } from "next";
import { ContactManager } from "@/components/contacts/contact-manager";
import { getCompanies, getContacts, requireProfile } from "@/lib/queries";

export const metadata: Metadata = { title: "Contacts" };

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const [{ focus }, me, contacts, companies] = await Promise.all([
    searchParams,
    requireProfile(),
    getContacts(),
    getCompanies(),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl">Contacts</h1>
        <p className="text-xs text-muted">
          The people behind the deals. A contact is created automatically whenever you add a lead.
        </p>
      </header>

      <ContactManager contacts={contacts} companies={companies} me={me} focusId={focus} />
    </div>
  );
}
