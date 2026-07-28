# HIRA Connect CRM — Master Plan: *Build the World's Best Lean CRM*

> Goal: turn the current 5-tab tracker into a **world-class CRM that a small team of admins can run at full efficiency** — full visibility into every lead's lifecycle, conversations, and stage; real lead scoring; structured stage feedback; targets with trends; and powerful analytics.
>
> Benchmarked against **Twenty** (open-source, object/timeline/kanban model), **HubSpot** (lifecycle stages, fit-vs-engagement scoring, pipeline analytics), and **Odoo** (activity scheduling, lost reasons, forecasting).
>
> **Working rule:** execute one increment at a time → test it → audit it → mark ✅ Done in this file → move to next. Every DB change is **additive and reversible** (new tables / nullable columns only). No destructive migrations against the live data (34 real leads).

---

> **Status update — 2026-07-29.** The app was rebuilt as a **Next.js 16 + TypeScript + Tailwind 4** application (see [`README.md`](README.md)). Phases 2–6 below are now largely delivered as part of that rebuild; per-item status is marked inline. Section 1 describes the pre-rebuild state and is kept for context.

## 1. Current State (audited 2026-07-16)

**App:** single `index.html` (~17 KB). Preact + `htm` + `@supabase/supabase-js` loaded via ESM CDN. **Zero build step**, deployed static on Vercel. Auth = Supabase email/password. RLS = "authenticated full access" on every table (fine for a trusted admin team). *(Archived to `legacy/index.html` on 2026-07-29.)*

**Tabs:** Dashboard · Leads · Companies · Signups · Targets.

**Database (Supabase `tcojgrxtpldiieytvthl`):**

| Table | Rows | Notes |
|---|---|---|
| `leads` | 34 | has **unused** columns: `whatsapp`, `linkedin`, `owner` |
| `companies` | 32 | `notes` unused |
| `activities` | 17 | **has no UI** — `type`, `outcome`, `activity_date` exist; timeline never shown |
| `raw_signups` | 53 | website form captures; convert-to-lead works |
| `monthly_targets` | 7 | single value per metric/month; no trend |
| `documents`, `sheets`, `portal_page` | 0/0/1 | scaffolding, no UI |

**Stages (11):** New · Contacted · Follow Up · Meeting Scheduled · Meeting Done · Demo Setup · Demo Done · Onboarding · Won · Delayed · Lost.

### Gap analysis (what separates this from world-class)

| # | Gap | Impact |
|---|---|---|
| G1 | **No lead detail view.** Notes are logged blind into `activities`; nobody can read a lead's history/conversation. | Zero lifecycle visibility — the #1 ask. |
| G2 | **No activity timeline.** Calls/emails/meetings/WhatsApp/stage-changes aren't captured or shown chronologically. | Can't see "what happened at each stage." |
| G3 | **No lead scoring.** All leads look equal; no prioritization. | Team wastes time on cold leads. |
| G4 | **Flat stage dropdown.** No stage-entry timestamps, no time-in-stage, no rotting/stale detection, no Lost/Delayed reason. | No pipeline hygiene or diagnosis. |
| G5 | **No structured stage feedback.** No "what happened / next step / sentiment" per stage transition. | Knowledge lives in people's heads. |
| G6 | **Targets are static & single-month.** No trend, no pacing, no per-owner. | Can't see trajectory. |
| G7 | **Thin dashboard.** Counts only — no funnel conversion, win rate, sales-cycle length, velocity, source ROI, activity load. | No decision support. |
| G8 | **`owner` unused.** No assignment, no per-rep views/leaderboard. | No accountability in a team. |
| G9 | **Reachouts = manual +1 counter**, disconnected from real activities. | Vanity metric, not truth. |
| G10 | **No global search / saved views / data-quality guards** (dedup, required fields). | Friction at scale. |

---

## 2. Target Architecture

**Superseded 2026-07-29 — rebuilt on Next.js.** The original recommendation was to stay zero-build (Preact + `htm` + ESM CDN). That was reversed: full RBAC, server-enforced writes and the analytics surface are all materially easier with a real framework, and the spec called for Next.js on Vercel. The app is now Next.js 16 (App Router) + TypeScript + Tailwind 4, with the file layout documented in [`README.md`](README.md#architecture). The old app is archived at `legacy/index.html` as a rollback artifact.

**Backend ownership:** the DB lives in Supabase project `tcojgrxtpldiieytvthl` (org `akqbnjemvmmgfwyxgzwo`, account `shivang@hiraconnect.com`). After the cross-account move, Claude's MCP connector lost management access — schema changes now go through the committed `supabase/` folder via the CLI (`supabase db push`), or resume via MCP once the connector is re-authorized to that account. The frontend's URL + anon key are unchanged (ref preserved).

**Principles:** additive DB migrations only · pure functions for scoring/SLA (testable) · every stage change and reachout writes an `activities` row (single source of truth) · charts as hand-rolled inline SVG (no heavy deps) · optimistic UI with reload fallback (current pattern).

---

## 3. Data Model Evolution (all additive)

**New/updated tables & columns** (created in Phase 0, used by later phases):

- `leads` add: `score_fit int`, `score_engagement int`, `grade text` (A–D, computed), `stage_since date`, `lost_reason text`, `expected_value numeric`, `close_date date`, `last_activity_at timestamptz`.
- `activities` already good; standardize `type` ∈ {Note, Call, Email, WhatsApp, Meeting, Demo, StageChange, Task}; use `outcome` for sentiment/result; add `direction text` (in/out), `due_date date`, `done boolean` (for tasks).
- **NEW** `stage_history` (id, lead_id fk, from_stage, to_stage, note, changed_by, changed_at) — powers time-in-stage, velocity, funnel-by-time.
- **NEW** `lost_reasons` lookup (reason text) — seeded: Price, Timing, No budget, Went silent, Competitor, Not a fit, No response.
- `monthly_targets` already multi-row by month; add `owner text` (nullable) for per-rep targets. Trends come from querying multiple months.
- **NEW** `saved_views` (id, name, entity, filter jsonb, owner) — Phase 6.

**Reachouts truth:** keep `total_reachouts` but auto-increment it whenever a Call/Email/WhatsApp/Meeting activity is logged (via app logic), so it reflects real touches. Manual +1 stays as a quick fallback.

### v2 additions *(2026-07-29, migrations `20260729120000`–`20260729120200`)*

- **NEW** `teams` (name, description, manager_id) and `profiles` (1:1 with `auth.users`; role admin/manager/rep, team, is_active) — the RBAC backbone. A trigger creates a profile on first sign-in.
- **NEW** `stages` — the 11 stages as data: `funnel` (TOFU/MOFU/BOFU), `category`, `sort`, `sla_days`, `probability`. Admin-editable; drives rotting, weighted pipeline and the funnel report.
- **NEW** `contacts` — people split from opportunities, with `seniority` and company link. Backfilled one per existing lead.
- **NEW** `lead_score_history` and `notifications`.
- `leads` add: `owner_id`, `team_id`, `contact_id`, `score_total`, `score_updated_at`, `first_contacted_at`, `qualified_at`, `won_at`, `lost_at`, `currency`, `priority`.
- `companies` add: `employee_count`, `size_band`, `domain`, `hiring_need`, `is_icp` — the firmographics behind the fit score.
- `activities` add `owner_id`/`contact_id`/`completed_at`; `stage_history` adds `changed_by_id`/`days_in_from_stage`; `monthly_targets` adds `owner_id`/`team_id`/`auto_actual`.

---

## 4. Phased Roadmap (each item is a test+audit checkpoint)

Legend: ⬜ todo · 🔄 in progress · ✅ done (with audit note + date)

### Phase 0 — Foundation (DB + code split) 🔄
- **0.1** ✅ *2026-07-16* — Additive migration applied (`crm_phase0_foundation`): new cols on `leads`/`activities`; new tables `stage_history`, `lost_reasons` (7 seeded), `saved_views`; RLS added matching existing convention. Existing rows untouched.
- **0.2** ✅ *2026-07-16* — Backfill done: 34/34 leads have `stage_since` + `last_activity_at`; 34 `stage_history` rows seeded. Verified via SQL counts.
- **0.3** ⏸ *Deferred* — Code-split into `lib/` modules postponed to avoid changing the Vercel deploy structure mid-feature. Building Phase 1 inline first; will split once file size warrants. Security advisor: new tables inherit the pre-existing `USING(true)` policy convention (trusted-admin threat model) — RLS tightening tracked as **6.7**.

### Phase 1 — Lead Lifecycle & Conversation (the flagship) ✅ *(closes G1, G2, G5, G9)*
- **1.1** ✅ `LeadDrawer` slide-over — click any lead name (Leads table + Dashboard follow-up queue) → contact/company/owner/source/reachouts/last-touch + stage.
- **1.2** ✅ Timeline — merged reverse-chron feed of `activities` + `stage_history` with type icons, direction, outcome, author, relative time; empty-state guidance.
- **1.3** ✅ Activity composer — Call/Email/WhatsApp/Meeting/Demo/Note with outcome + direction; `logActivity` auto-bumps `total_reachouts` (touch types only) + `last_activity_at`. Quick "+1" and quick-note in the table now route through it too (real touches, not a vanity counter → closes G9).
- **1.4** ✅ Task activities — `due_date` + `done`, toggle "Mark done" from the timeline.
- **1.5** ✅ Stage feedback — stage change (drawer selector *and* table dropdown) writes `stage_history` + a `StageChange` activity; Lost/Delayed prompt for a reason (stored in `lead.lost_reason`).
- **Audit** *2026-07-16*: `node --check` syntax OK; SSR render test of all 7 components passes (LeadDrawer renders 2035 chars); live DB contract test (insert lead → Call → Task → 2 stage changes incl. Lost/Price) produced exactly 3 activities + 2 history rows + reachouts=1, then cleaned up (34/17/34 restored). **Remaining:** visual confirmation in browser by user.

### Phase 2 — Stage Management & Pipeline ✅ *2026-07-29* *(closes G4)*
- **2.1** ✅ Stage config moved into the **database** (`public.stages`: funnel, category, sort, `sla_days`, `probability`) with `lib/stages.ts` pure helpers — `daysInStage`, `rotState`, `nextStages`, `weightedValue`. Admin-editable rather than hard-coded.
- **2.2** ✅ Kanban `/pipeline` — native HTML5 drag-and-drop, columns per stage, cards sorted by score, per-column count and value. The Leads table keeps a stage dropdown for touch devices.
- **2.3** ✅ Rotting indicators (amber past SLA, red past double) on both board and table; Lost/Delayed require a reason, enforced in `changeStage` **and** prompted in the UI.
- **2.4** ✅ Time-in-stage badge on cards, table rows and the detail header; `days_in_from_stage` recorded on every transition.

### Phase 3 — Lead Scoring ✅ *2026-07-29* *(closes G3)*
- **3.1** ✅ `lib/scoring.ts` pure functions. **Fit (0–50)**: company size, ICP flag, decision-maker level (inferred from title), source quality, hiring need. **Engagement (0–50)**: recency, outreach volume, stage depth, meetings/demos, inbound replies. Engagement is **gated** — halved below 18/50 fit.
- **3.2** ✅ Grade A–D badge on the table, kanban cards, detail header, dashboard and hot list.
- **3.3** ✅ Recomputed server-side on every activity, stage change and edit; `score_*`/`grade` stored on the lead, deltas appended to `lead_score_history`, and a full "Why this score" breakdown panel on the detail page.
- **3.4** ✅ "Hot leads" widget (open, grade A/B, score-ranked) on the dashboard.
- **Audit** — 8 unit tests in `lib/scoring.test.ts` cover seniority inference, the fit ceiling, the gate, recency decay, stage depth and bounds. All pass.

### Phase 4 — Targets & Trends ✅ *2026-07-29* *(closes G6)*
- **4.1** ✅ `/targets` editor: month + metric + optional owner, six presets (New leads, Reachouts, Meetings, Demos, Won, Revenue), plus a one-click "add all metrics for this month".
- **4.2** ✅ Auto-actuals computed from CRM data (`leads.created_at`, `won_at`, activity types) with a per-row manual override and a "Refresh actuals" action.
- **4.3** ✅ Target-vs-actual line chart across months, plus a pacing indicator (Ahead / On track / Behind / Target met) on both `/targets` and the dashboard.

### Phase 5 — Analytics Dashboard ✅ *2026-07-29* *(closes G7, G8)*
- **5.1** ✅ Conversion funnel by *ever reached* (from `stage_history`, not just current stage) with stage-to-stage %, plus overall win rate.
- **5.2** ✅ Velocity: average days per stage from `days_in_from_stage`, plus average creation-to-won sales cycle.
- **5.3** ✅ Source ROI table — leads / won / lost / open / win-rate / revenue per source.
- **5.4** ✅ Team leaderboard and a user-wise lead-status matrix; owner filter on the leads table and pipeline board.
- **5.5** ✅ Twelve-week trend (new leads / won / activities) on the dashboard and reports.
- Also added: lost-reason donut ("why we lose").

### Phase 6 — Efficiency & Hardening 🔄 *(closes G10)*
- **6.1** ✅ ⌘K command palette across leads, companies, contacts and pages.
- **6.2** ⬜ Saved views — `saved_views` table now has `owner_id`/`is_shared`, but no UI yet.
- **6.3** ⬜ Company detail drawer — `/companies` has inline editing and an ICP toggle, but no per-company rollup page.
- **6.4** ✅ Duplicate-email warning when adding a lead, required-field validation, bulk assign and bulk stage change from the leads table.
- **6.5** ✅ Signup conversion dedupes on email — a repeat signup links to the existing lead and logs an inbound touch instead of creating a twin.
- **6.6** 🔄 Keyboard: ⌘K and Enter-to-log shipped. CSV export and scheduled reminders still open (in-app notifications exist).
- **6.7** ✅ RLS scoped per role (admin / manager / rep) with `SECURITY DEFINER` helpers pinned to `search_path`, plus a trigger blocking self-promotion. `portal_page`, `documents`, `sheets` and `raw_signups` were intentionally left on their existing policies — `raw_signups` receives public website writes.

---

## 5. Testing & Audit Protocol (per increment)

1. **Static checks** — `npm run typecheck`, `npm run lint`, `npm run build` all clean.
2. **Unit tests** — `npm test` covers the pure logic (scoring, stages/SLA, funnel, ROI, velocity).
3. **Functional test** — exercise the exact new path (add lead → log call → change stage → see timeline + score update).
4. **Data check** — confirm the right rows were written, existing data intact.
5. **Regression** — every route still renders.
6. **Audit note** — append a one-line result + date under the item here and flip ⬜→✅.

---

## 6. Success Criteria ("world-class" defined)

- Any admin can open a lead and **read its entire conversation & stage journey** in <2s.
- Every stage change carries a **reason + next step**; no silent moves.
- Leads are **ranked by score/grade**; the team works the hottest first.
- Pipeline is a **drag-and-drop board** with rotting alerts and per-stage SLAs.
- Targets show **trend & pacing**, not just a static number.
- Dashboard answers: *are we winning, where do we leak, who's doing what, which sources pay off.*
- Runs by 1–3 admins with **no training friction** and **one-command deploy**.

---

## 7. Change Log
- 2026-07-16 — Plan created. Current state audited; DB schema inspected live.
- 2026-07-16 — **Phase 0 done** (additive migration + backfill, verified). 0.3 code-split deferred.
- 2026-07-16 — **Phase 1 done** (lead drawer + conversation timeline + activity composer + task + stage feedback). Syntax + SSR + live-DB contract tests pass.
- 2026-07-16 — Project moved cross-account to org `akqbnjemvmmgfwyxgzwo` (ref preserved → app unaffected; verified `auth/health` 200 + anon REST 200). Added CLI-managed `supabase/` folder (config, Phase 0 migrations, edge-function scaffold). Claude MCP DB access pending connector re-auth to the new account. Next: Phase 2 (Kanban + stage SLAs).
- 2026-07-29 — **v2 rebuild.** Replaced the single-file Preact app with **Next.js 16 + TypeScript + Tailwind 4** (App Router, server actions, `@supabase/ssr` cookie auth). Delivered Phases 2–5 in full and most of Phase 6: role-based access (admin/manager/rep) enforced by RLS, teams and user management with lead transfer, contacts as a first-class object, drag-and-drop pipeline with SLAs, fit+engagement scoring with a "why this score" breakdown, auto-computed target actuals with pacing, and a reports suite (funnel, velocity, source ROI, lost reasons, leaderboard, owner matrix). Old app archived to `legacy/index.html`.
  - **Verified:** `tsc --noEmit` clean · `eslint` clean · `next build` succeeds (13 routes) · 17 unit tests pass · dev server smoke test — `/` correctly 307s to `/login`, login page renders.
  - **Not verified:** the three v2 migrations have **not been applied** — Claude's MCP connector is still bound to a different Supabase account and Docker is unavailable locally, so no live database run was possible. `supabase db push` is the next step, before any deploy.
  - **Open:** saved-views UI (6.2), company detail rollup (6.3), CSV export and scheduled reminder digest (6.6).
- 2026-07-29 — **Deployment readiness.** Completed the password-reset flow (`/auth/callback` code exchange + `/auth/update-password`, reachable from sign-in *and* Settings) — it previously sent an email that dead-ended. Added security headers (frame/sniff/referrer/permissions/HSTS/noindex, `poweredByHeader` off), a brand favicon, and a Node ≥ 20.9 engine pin. README now carries the full cutover checklist, including the Supabase **redirect-URL allowlist** that password resets require. Re-verified: typecheck, lint, 17 tests, build (15 routes); smoke-tested the auth routes, headers and icon against a running server.
