import type { Metadata } from "next";
import { SignupList } from "@/components/signups/signup-list";
import { StatCard } from "@/components/ui/primitives";
import { getSignups } from "@/lib/queries";

export const metadata: Metadata = { title: "Signups" };

export default async function SignupsPage() {
  const signups = await getSignups();
  const converted = signups.filter((s) => s.converted_lead_id).length;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl">Website signups</h1>
        <p className="text-xs text-muted">
          Raw form captures from the website. Convert the real ones into leads — the rest stay here as a record.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Total signups" value={signups.length} />
        <StatCard label="Converted" value={converted} tone="success" />
        <StatCard
          label="Waiting"
          value={signups.length - converted}
          tone={signups.length - converted ? "warning" : "default"}
        />
      </div>

      <SignupList signups={signups} />
    </div>
  );
}
