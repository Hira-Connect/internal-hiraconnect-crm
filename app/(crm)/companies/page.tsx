import type { Metadata } from "next";
import { CompanyManager } from "@/components/companies/company-manager";
import { StatCard } from "@/components/ui/primitives";
import { getCompanies, getLeads } from "@/lib/queries";

export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const [{ focus }, companies, leads] = await Promise.all([searchParams, getCompanies(), getLeads()]);

  const icp = companies.filter((c) => c.is_icp === true).length;
  const unassessed = companies.filter((c) => c.is_icp === null).length;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl">Companies</h1>
        <p className="text-xs text-muted">
          The accounts behind your leads. Firmographics here drive the fit score.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Companies" value={companies.length} />
        <StatCard label="ICP matches" value={icp} tone="success" />
        <StatCard
          label="Not yet assessed"
          value={unassessed}
          tone={unassessed ? "warning" : "default"}
          hint="Each one caps its leads' fit score"
        />
        <StatCard label="Linked leads" value={leads.filter((l) => l.company_id).length} />
      </div>

      <CompanyManager companies={companies} leads={leads} focusId={focus} />
    </div>
  );
}
