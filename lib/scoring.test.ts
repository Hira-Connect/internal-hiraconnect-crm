import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_STAGES } from "./stages";
import {
  EMPTY_STATS,
  FIT_GATE,
  gradeFor,
  inferSeniority,
  scoreLead,
  statsFromActivities,
  type ScoringInput,
} from "./scoring";

const NOW = new Date("2026-07-29T10:00:00Z");

function input(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    lead: {
      source: null,
      title: null,
      status: "New",
      total_reachouts: 0,
      last_activity_at: null,
      created_at: "2026-07-01T00:00:00Z",
    },
    company: null,
    contactTitle: null,
    stages: DEFAULT_STAGES,
    activityStats: EMPTY_STATS,
    now: NOW,
    ...overrides,
  };
}

test("seniority is inferred from job titles", () => {
  assert.equal(inferSeniority("Co-Founder & CEO"), "exec");
  assert.equal(inferSeniority("VP of Talent"), "head");
  assert.equal(inferSeniority("Head of People"), "head");
  assert.equal(inferSeniority("Recruitment Manager"), "manager");
  assert.equal(inferSeniority("Recruiter"), "ic");
  assert.equal(inferSeniority(null), "unknown");
});

test("a bare lead scores low and grades D", () => {
  const result = scoreLead(input());
  assert.ok(result.total < 35, `expected a cold score, got ${result.total}`);
  assert.equal(result.grade, "D");
  // the only engagement a brand-new, untouched lead can earn is the sliver of
  // stage depth that "New" carries (5% win probability)
  assert.ok(result.engagement <= 1, `expected no meaningful engagement, got ${result.engagement}`);
});

test("fit rewards ICP, size, seniority and source", () => {
  const fitFor = (title: string) =>
    scoreLead(
      input({
        lead: {
          source: "Referral",
          title,
          status: "New",
          total_reachouts: 0,
          last_activity_at: null,
          created_at: "2026-07-01T00:00:00Z",
        },
        company: {
          size_band: "enterprise",
          employee_count: 4000,
          industry: "IT Services",
          is_icp: true,
          hiring_need: "niche",
        },
      }),
    ).fit;

  const weak = scoreLead(input()).fit;
  const exec = fitFor("Co-Founder & CEO");
  const head = fitFor("Head of Talent");

  assert.ok(exec > weak, "a well-qualified lead must out-score an unknown one");
  assert.equal(exec, 50, "enterprise + ICP + exec + referral + niche should max the fit half");
  assert.ok(head < exec, "a functional head should score below a founder");
});

test("engagement is halved while fit sits below the gate", () => {
  const shared = {
    lead: {
      source: "Outbound",
      title: "Recruiter",
      status: "Demo Done",
      total_reachouts: 6,
      last_activity_at: NOW.toISOString(),
      created_at: "2026-07-01T00:00:00Z",
    },
    activityStats: { touches: 6, meetings: 1, demos: 1, inbound: 2 },
  };

  const poorFit = scoreLead(input(shared));
  const goodFit = scoreLead(
    input({
      ...shared,
      company: { size_band: "large", employee_count: 500, industry: "IT", is_icp: true, hiring_need: "niche" },
      contactTitle: "Chief People Officer",
    }),
  );

  assert.ok(poorFit.fit < FIT_GATE, "the poor-fit fixture must actually be below the gate");
  assert.equal(poorFit.gated, true);
  assert.equal(goodFit.gated, false);
  assert.ok(
    goodFit.engagement > poorFit.engagement,
    "identical activity must count for more on a good-fit lead",
  );
});

test("recency decays as a lead goes quiet", () => {
  const at = (iso: string) =>
    scoreLead(
      input({
        lead: {
          source: "Referral",
          title: "CEO",
          status: "Meeting Done",
          total_reachouts: 3,
          last_activity_at: iso,
          created_at: "2026-05-01T00:00:00Z",
        },
        company: { size_band: "mid", employee_count: 120, industry: "IT", is_icp: true, hiring_need: "niche" },
      }),
    ).engagement;

  const today = at("2026-07-29T09:00:00Z");
  const lastWeek = at("2026-07-24T09:00:00Z");
  const lastQuarter = at("2026-05-02T09:00:00Z");

  assert.ok(today > lastWeek, "a touch today must beat one from last week");
  assert.ok(lastWeek > lastQuarter, "a touch last week must beat one from months ago");
});

test("stage depth lifts the score as a deal advances", () => {
  const at = (status: string) =>
    scoreLead(
      input({
        lead: {
          source: "Referral",
          title: "CEO",
          status,
          total_reachouts: 4,
          last_activity_at: NOW.toISOString(),
          created_at: "2026-06-01T00:00:00Z",
        },
        company: { size_band: "large", employee_count: 600, industry: "IT", is_icp: true, hiring_need: "niche" },
      }),
    ).total;

  assert.ok(at("Onboarding") > at("Contacted"), "later stages must score higher");
});

test("scores and grades stay inside their bounds", () => {
  const maxed = scoreLead(
    input({
      lead: {
        source: "Referral",
        title: "Founder",
        status: "Won",
        total_reachouts: 99,
        last_activity_at: NOW.toISOString(),
        created_at: "2026-01-01T00:00:00Z",
      },
      company: {
        size_band: "enterprise",
        employee_count: 9000,
        industry: "IT",
        is_icp: true,
        hiring_need: "niche",
      },
      activityStats: { touches: 99, meetings: 9, demos: 9, inbound: 9 },
    }),
  );

  assert.ok(maxed.fit <= 50 && maxed.engagement <= 50 && maxed.total <= 100);
  assert.equal(maxed.grade, "A");
  assert.equal(gradeFor(0), "D");
  assert.equal(gradeFor(100), "A");
});

test("activity rows roll up into the engagement counters", () => {
  const stats = statsFromActivities([
    { type: "Call", direction: "out" },
    { type: "Email", direction: "in" },
    { type: "Meeting", direction: "out" },
    { type: "Demo", direction: "in" },
    { type: "Note", direction: null },
    { type: "StageChange", direction: null },
  ]);

  assert.deepEqual(stats, { touches: 4, meetings: 1, demos: 1, inbound: 2 });
});
