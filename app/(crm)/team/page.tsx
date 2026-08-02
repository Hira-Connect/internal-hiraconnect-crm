import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TeamManager } from "@/components/team/team-manager";
import { StatCard } from "@/components/ui/primitives";
import { getAccountStates, getLeads, getProfiles, getTeams, requireProfile } from "@/lib/queries";
import { isManagerUp } from "@/lib/permissions";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const me = await requireProfile();
  if (!isManagerUp(me)) redirect("/");

  const [profiles, teams, leads, accountStates] = await Promise.all([
    getProfiles(),
    getTeams(),
    getLeads(),
    getAccountStates(),
  ]);

  const active = profiles.filter((p) => p.is_active);
  const unassigned = leads.filter((l) => !l.owner_id && !["Won", "Lost"].includes(l.status)).length;
  const pending = active.filter((p) => accountStates[p.id]?.confirmed === false).length;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl">Team</h1>
        <p className="text-xs text-muted">
          Who has access, what they can see, and where each person&apos;s book stands.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Active people" value={active.length} hint={pending ? `${pending} not signed in yet` : undefined} />
        <StatCard label="Admins" value={active.filter((p) => p.role === "admin").length} />
        <StatCard label="Teams" value={teams.length} />
        <StatCard
          label="Unassigned open leads"
          value={unassigned}
          tone={unassigned ? "warning" : "default"}
          href="/leads?owner=unassigned"
        />
      </div>

      <TeamManager
        profiles={profiles}
        teams={teams}
        leads={leads}
        me={me}
        accountStates={accountStates}
      />
    </div>
  );
}
