import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_STAGES, categoryOf, daysInStage, isOpen, nextStages, rotState, weightedValue } from "./stages";
import { buildFunnel, salesCycleDays, sourceRoi, winRate } from "./analytics";
import type { LeadRow, StageHistory } from "./types";

const NOW = new Date("2026-07-29T10:00:00Z");

function lead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: crypto.randomUUID(),
    name: "Test lead",
    company_id: null,
    contact_id: null,
    owner_id: null,
    team_id: null,
    title: null,
    email: null,
    phone: null,
    whatsapp: null,
    linkedin: null,
    owner: null,
    status: "New",
    source: null,
    next_action: null,
    next_action_date: null,
    total_reachouts: 0,
    score_fit: 0,
    score_engagement: 0,
    score_total: 0,
    grade: null,
    score_updated_at: null,
    stage_since: "2026-07-29",
    lost_reason: null,
    expected_value: null,
    close_date: null,
    currency: "INR",
    priority: null,
    last_activity_at: null,
    first_contacted_at: null,
    qualified_at: null,
    won_at: null,
    lost_at: null,
    created_at: "2026-07-01T00:00:00Z",
    company: null,
    owner_profile: null,
    ...overrides,
  };
}

test("stage categories separate open from closed", () => {
  assert.equal(categoryOf(DEFAULT_STAGES, "Demo Done"), "open");
  assert.equal(categoryOf(DEFAULT_STAGES, "Won"), "won");
  assert.equal(categoryOf(DEFAULT_STAGES, "Lost"), "lost");
  assert.equal(isOpen(DEFAULT_STAGES, "Delayed"), true, "Delayed is stalled, not closed");
});

test("rot state escalates past the stage SLA", () => {
  // "Contacted" carries a 3-day SLA
  const fresh = lead({ status: "Contacted", stage_since: "2026-07-28" });
  const warn = lead({ status: "Contacted", stage_since: "2026-07-24" });
  const rotten = lead({ status: "Contacted", stage_since: "2026-07-15" });

  assert.equal(rotState(DEFAULT_STAGES, fresh, NOW), "fresh");
  assert.equal(rotState(DEFAULT_STAGES, warn, NOW), "warning");
  assert.equal(rotState(DEFAULT_STAGES, rotten, NOW), "rotting");
  assert.equal(
    rotState(DEFAULT_STAGES, lead({ status: "Won", stage_since: "2020-01-01" }), NOW),
    "fresh",
    "closed deals never rot",
  );
});

test("days in stage falls back to created_at", () => {
  assert.equal(daysInStage(lead({ stage_since: "2026-07-19" }), NOW), 10);
  assert.equal(
    daysInStage(lead({ stage_since: null, created_at: "2026-07-27T10:00:00Z" }), NOW),
    2,
    "a lead with no stage_since is aged from creation",
  );
});

test("weighted value discounts by stage probability and ignores closed deals", () => {
  const leads = [
    { status: "Demo Done", expected_value: 100_000 }, // 65%
    { status: "New", expected_value: 100_000 }, // 5%
    { status: "Won", expected_value: 999_999 }, // excluded
    { status: "Lost", expected_value: 999_999 }, // excluded
  ];
  assert.equal(weightedValue(DEFAULT_STAGES, leads), 70_000);
});

test("nextStages lists forward moves before backward ones", () => {
  const options = nextStages(DEFAULT_STAGES, "Follow Up");
  assert.equal(options[0].key, "Meeting Scheduled");
  assert.ok(
    options.findIndex((s) => s.key === "Won") < options.findIndex((s) => s.key === "New"),
    "forward stages come first",
  );
});

test("funnel counts every lead that has ever reached a stage", () => {
  const advanced = lead({ status: "Demo Done" });
  const early = lead({ status: "Contacted" });
  const history: StageHistory[] = [
    {
      id: "h1",
      lead_id: early.id,
      from_stage: "Contacted",
      to_stage: "Meeting Scheduled",
      note: null,
      changed_by: null,
      changed_by_id: null,
      days_in_from_stage: 4,
      changed_at: "2026-07-10T00:00:00Z",
    },
  ];

  const funnel = buildFunnel([advanced, early], history, DEFAULT_STAGES);
  const step = (key: string) => funnel.find((s) => s.stage === key);

  assert.equal(step("New")?.reached, 2, "both leads passed through New");
  assert.equal(step("Demo Done")?.reached, 1);
  assert.equal(
    step("Meeting Scheduled")?.reached,
    2,
    "history counts even though the lead has since moved back",
  );
  assert.equal(step("Contacted")?.current, 1, "current sits where the lead is now");
});

test("win rate ignores open deals", () => {
  const leads = [
    lead({ status: "Won" }),
    lead({ status: "Won" }),
    lead({ status: "Lost" }),
    lead({ status: "Demo Done" }),
  ];
  const result = winRate(leads, DEFAULT_STAGES);
  assert.deepEqual(result, { won: 2, lost: 1, rate: 67 });
});

test("source ROI splits outcomes and sums won revenue", () => {
  const rows = sourceRoi(
    [
      lead({ source: "Referral", status: "Won", expected_value: 200_000 }),
      lead({ source: "Referral", status: "Lost" }),
      lead({ source: "Outbound", status: "New" }),
      lead({ source: null, status: "New" }),
    ],
    DEFAULT_STAGES,
  );

  const referral = rows.find((r) => r.source === "Referral");
  assert.equal(referral?.total, 2);
  assert.equal(referral?.winRate, 50);
  assert.equal(referral?.revenue, 200_000);
  assert.ok(rows.some((r) => r.source === "Unknown"), "leads with no source are bucketed, not dropped");
});

test("sales cycle averages creation-to-won", () => {
  const result = salesCycleDays([
    lead({ created_at: "2026-06-01T00:00:00Z", won_at: "2026-06-11T00:00:00Z" }),
    lead({ created_at: "2026-06-01T00:00:00Z", won_at: "2026-06-21T00:00:00Z" }),
    lead({ created_at: "2026-06-01T00:00:00Z" }), // still open, must not count
  ]);
  assert.deepEqual(result, { avg: 15, samples: 2 });
});
