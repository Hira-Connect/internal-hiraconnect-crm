import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, KeyValue, Panel, StatCard } from "@/components/ui/primitives";
import { GradeBadge, FunnelBadge, RotBadge, StageBadge } from "@/components/leads/badges";
import { ActivityComposer } from "@/components/leads/activity-composer";
import { OwnerControl } from "@/components/leads/owner-control";
import { ScorePanel } from "@/components/leads/score-panel";
import { StageControl } from "@/components/leads/stage-control";
import { Timeline } from "@/components/leads/timeline";
import { LeadEditPanel } from "@/components/leads/lead-edit-panel";
import {
  getCompanies,
  getLead,
  getLeadActivities,
  getLeadScoreHistory,
  getLeadStageHistory,
  getLostReasons,
  getProfiles,
  getStages,
  requireProfile,
} from "@/lib/queries";
import { scoreLead, statsFromActivities } from "@/lib/scoring";
import { canReassign } from "@/lib/permissions";
import { daysInStage, findStage, rotState } from "@/lib/stages";
import { formatCurrency, formatDate, relTime } from "@/lib/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const lead = await getLead(id);
  return { title: lead?.name ?? "Lead" };
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [me, lead, stages, profiles, companies, lostReasons] = await Promise.all([
    requireProfile(),
    getLead(id),
    getStages(),
    getProfiles(),
    getCompanies(),
    getLostReasons(),
  ]);
  if (!lead) notFound();

  const [activities, history, scoreHistory] = await Promise.all([
    getLeadActivities(id),
    getLeadStageHistory(id),
    getLeadScoreHistory(id),
  ]);

  const score = scoreLead({
    lead,
    company: lead.company,
    contactTitle: lead.title,
    stages,
    activityStats: statsFromActivities(activities),
  });

  const stageConfig = findStage(stages, lead.status);
  const rot = rotState(stages, lead);
  const days = daysInStage(lead);
  const openTasks = activities.filter((a) => a.type === "Task" && !a.done);

  return (
    <div className="space-y-4">
      {/* --------------------------------------------------------- header */}
      <div className="surface rounded-xl border p-4">
        <nav className="mb-2 text-xs text-muted">
          <Link href="/leads" className="hover:underline">
            Leads
          </Link>
          <span> / {lead.name}</span>
        </nav>

        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl">{lead.name}</h1>
            <p className="mt-0.5 text-sm text-muted">
              {lead.company ? (
                <Link href={`/companies?focus=${lead.company.id}`} className="hover:underline">
                  {lead.company.name}
                </Link>
              ) : (
                "No company linked"
              )}
              {lead.title && ` · ${lead.title}`}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StageBadge stage={lead.status} stages={stages} />
              <FunnelBadge stage={lead.status} stages={stages} />
              <GradeBadge grade={lead.grade} score={lead.score_total} />
              <RotBadge state={rot} days={days} />
              <span className="text-[11px] text-muted">
                in stage {days}d
                {stageConfig && stageConfig.sla_days > 0 && ` · SLA ${stageConfig.sla_days}d`}
              </span>
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-56">
            <label className="text-[11px] font-semibold tracking-wide text-muted uppercase">Stage</label>
            <StageControl
              leadId={lead.id}
              current={lead.status}
              stages={stages}
              lostReasons={lostReasons}
            />
            <label className="mt-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Owner</label>
            <OwnerControl
              leadId={lead.id}
              ownerId={lead.owner_id}
              options={profiles}
              disabled={!canReassign(me)}
            />
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------- stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <StatCard label="Score" value={score.total} hint={`Fit ${score.fit} · Eng ${score.engagement}`} />
        <StatCard label="Touches" value={lead.total_reachouts ?? 0} hint={relTime(lead.last_activity_at)} />
        <StatCard label="Deal value" value={formatCurrency(lead.expected_value, lead.currency)} />
        <StatCard
          label="Win probability"
          value={`${stageConfig?.probability ?? 0}%`}
          hint={stageConfig?.funnel}
        />
        <StatCard
          label="Open tasks"
          value={openTasks.length}
          tone={openTasks.length ? "warning" : "default"}
        />
        <StatCard label="Follow-up" value={formatDate(lead.next_action_date)} hint={lead.next_action ?? "—"} />
      </div>

      {lead.lost_reason && (
        <div className="rounded-lg border border-red-500/30 bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200">
          <b>Reason on record:</b> {lead.lost_reason}
        </div>
      )}

      {/* ------------------------------------------------------- main grid */}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Panel title="Log what happened" subtitle="Every entry here builds the lead's history.">
            <ActivityComposer leadId={lead.id} />
          </Panel>

          <Panel title="Timeline" subtitle={`${activities.length} activities · ${history.length} stage moves`}>
            <Timeline activities={activities} history={history} />
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Contact">
            <KeyValue label="Email">
              {lead.email ? (
                <a href={`mailto:${lead.email}`} className="text-brand-500 hover:underline">
                  {lead.email}
                </a>
              ) : (
                "—"
              )}
            </KeyValue>
            <KeyValue label="Phone">
              {lead.phone ? (
                <a href={`tel:${lead.phone}`} className="text-brand-500 hover:underline">
                  {lead.phone}
                </a>
              ) : (
                "—"
              )}
            </KeyValue>
            <KeyValue label="WhatsApp">{lead.whatsapp ?? "—"}</KeyValue>
            <KeyValue label="LinkedIn">
              {lead.linkedin ? (
                <a
                  href={lead.linkedin}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-500 hover:underline"
                >
                  Profile
                </a>
              ) : (
                "—"
              )}
            </KeyValue>
            <KeyValue label="Source">{lead.source ?? "—"}</KeyValue>
            <KeyValue label="Created">{formatDate(lead.created_at)}</KeyValue>
            <KeyValue label="First touch">{formatDate(lead.first_contacted_at)}</KeyValue>
            <KeyValue label="Qualified">{formatDate(lead.qualified_at)}</KeyValue>
          </Panel>

          <Panel title="Why this score" subtitle="Fit is who they are, engagement is what they did.">
            <ScorePanel score={score} />
            {scoreHistory.length > 1 && (
              <div className="mt-4 border-t border-app pt-3">
                <h4 className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
                  Recent changes
                </h4>
                <ul className="space-y-1 text-[11px] text-muted">
                  {scoreHistory.slice(0, 5).map((s) => (
                    <li key={s.id} className="flex justify-between gap-2">
                      <span className="truncate">{s.reason ?? "Recalculated"}</span>
                      <span className="shrink-0 tabular-nums">
                        {s.score_total} · {relTime(s.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          {lead.company && (
            <Panel title="Company">
              <KeyValue label="Industry">{lead.company.industry ?? "—"}</KeyValue>
              <KeyValue label="Size">
                {lead.company.size_band ?? "—"}
                {lead.company.employee_count ? ` · ${lead.company.employee_count} people` : ""}
              </KeyValue>
              <KeyValue label="Location">{lead.company.location ?? "—"}</KeyValue>
              <KeyValue label="ICP">
                {lead.company.is_icp === true ? (
                  <Badge tone="success">Yes</Badge>
                ) : lead.company.is_icp === false ? (
                  <Badge tone="neutral">No</Badge>
                ) : (
                  <Badge tone="warning">Not assessed</Badge>
                )}
              </KeyValue>
              <KeyValue label="Hiring need">{lead.company.hiring_need ?? "—"}</KeyValue>
            </Panel>
          )}

          <LeadEditPanel
            lead={lead}
            companies={companies}
            profiles={profiles}
            me={me}
            stages={stages}
          />
        </div>
      </div>
    </div>
  );
}
