import type { Metadata } from "next";
import Link from "next/link";
import { KeyValue, Panel } from "@/components/ui/primitives";
import { ProfileForm } from "@/components/team/profile-form";
import { getStages, getTeams, requireProfile } from "@/lib/queries";
import { FUNNEL_MEANING } from "@/lib/stages";
import { FIT_GATE, GRADE_THRESHOLDS } from "@/lib/scoring";
import { roleLabel } from "@/lib/permissions";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "My profile" };

export default async function SettingsPage() {
  const [me, teams, stages] = await Promise.all([requireProfile(), getTeams(), getStages()]);
  const team = teams.find((t) => t.id === me.team_id);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl">My profile</h1>
        <p className="text-xs text-muted">Your details, and a reference for how the CRM scores and ages leads.</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Your details">
          <ProfileForm profile={me} />
        </Panel>

        <Panel title="Access">
          <KeyValue label="Email">{me.email ?? "—"}</KeyValue>
          <KeyValue label="Role">{roleLabel(me.role)}</KeyValue>
          <KeyValue label="Team">{team?.name ?? "No team"}</KeyValue>
          <KeyValue label="Member since">{formatDate(me.created_at)}</KeyValue>
          <p className="mt-3 text-[11px] text-muted">
            {me.role === "admin"
              ? "You can see and change everything, including other people's roles."
              : me.role === "manager"
                ? "You can see every lead owned by your team, plus anything unassigned."
                : "You can see the leads you own. Ask an admin if something is missing."}
          </p>
          <div className="mt-3 border-t border-app pt-3">
            <Link href="/auth/update-password" className="text-xs text-brand-500 hover:underline">
              Change my password →
            </Link>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="How scoring works" subtitle="Same maths on every screen">
          <p className="text-xs text-muted">
            A lead scores out of 100: up to 50 for <b>fit</b> (company size, ICP match, seniority of the contact,
            source quality, hiring need) and up to 50 for <b>engagement</b> (recency, outreach volume, stage
            depth, meetings and demos, replies received).
          </p>
          <p className="mt-2 text-xs text-muted">
            If fit lands below {FIT_GATE}/50, engagement is halved — activity alone should not lift a poor-fit
            lead above a good one.
          </p>
          <ul className="mt-3 space-y-1 text-xs">
            {GRADE_THRESHOLDS.map((g) => (
              <li key={g.grade} className="flex gap-2">
                <b className="w-6">{g.grade}</b>
                <span className="w-16 tabular-nums text-muted">{g.min}+</span>
                <span>{g.label}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Stages & SLAs" subtitle="A card turns amber past the SLA, red at double it" bodyClassName="p-0">
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-app text-left">
                  {["Stage", "Funnel", "SLA", "Win %"].map((h) => (
                    <th key={h} className="px-3 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stages.map((s) => (
                  <tr key={s.key} className="border-b border-app last:border-0">
                    <td className="px-3 py-1.5">{s.label}</td>
                    <td className="px-3 py-1.5 text-xs" title={FUNNEL_MEANING[s.funnel]}>
                      {s.funnel}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums">{s.sla_days ? `${s.sla_days}d` : "—"}</td>
                    <td className="px-3 py-1.5 tabular-nums">{s.probability}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
