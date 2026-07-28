import type { Metadata } from "next";
import { PipelineBoard } from "@/components/pipeline/board";
import { StatCard } from "@/components/ui/primitives";
import { getLeads, getLostReasons, getProfiles, getStages } from "@/lib/queries";
import { categoryOf, rotState, weightedValue } from "@/lib/stages";
import { formatCurrency } from "@/lib/format";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  const [leads, stages, profiles, lostReasons] = await Promise.all([
    getLeads(),
    getStages(),
    getProfiles(),
    getLostReasons(),
  ]);

  const open = leads.filter((l) => categoryOf(stages, l.status) === "open");
  const rotting = open.filter((l) => rotState(stages, l) === "rotting");
  const totalValue = open.reduce((n, l) => n + (l.expected_value ?? 0), 0);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl">Pipeline</h1>
        <p className="text-xs text-muted">
          Every open deal by stage. Cards turn amber past the stage SLA and red at double it.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Open deals" value={open.length} />
        <StatCard label="Pipeline value" value={formatCurrency(totalValue)} />
        <StatCard
          label="Weighted value"
          value={formatCurrency(weightedValue(stages, open))}
          hint="Value × stage win probability"
        />
        <StatCard label="Rotting" value={rotting.length} tone={rotting.length ? "danger" : "default"} />
      </div>

      <PipelineBoard leads={leads} stages={stages} profiles={profiles} lostReasons={lostReasons} />
    </div>
  );
}
