import type { Metadata } from "next";
import { LeadTable } from "@/components/leads/lead-table";
import { getCompanies, getLeads, getLostReasons, getProfiles, getStages, requireProfile } from "@/lib/queries";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ owner?: string; q?: string; grade?: string; stage?: string }>;
}) {
  const { owner, q, grade, stage } = await searchParams;
  const [me, leads, stages, profiles, companies, lostReasons] = await Promise.all([
    requireProfile(),
    getLeads(),
    getStages(),
    getProfiles(),
    getCompanies(),
    getLostReasons(),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl">Leads</h1>
        <p className="text-xs text-muted">
          Every lead you have access to. Sorted by score so the hottest work sits at the top.
        </p>
      </header>

      <LeadTable
        leads={leads}
        stages={stages}
        profiles={profiles}
        companies={companies}
        me={me}
        lostReasons={lostReasons}
        initialOwner={owner}
        initialQuery={q}
        initialGrade={grade}
        initialStage={stage}
      />
    </div>
  );
}
