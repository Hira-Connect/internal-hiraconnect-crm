# HIRA Connect CRM

Internal CRM and business-planning portal. **Next.js 16 (App Router) + TypeScript + Tailwind 4** on Vercel,
**Supabase** for Postgres, Auth and row-level security.

The whole funnel lives here: capture → qualify → meet → demo → close, with a scored, owned, auditable
record for every lead.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # fill in the Supabase URL + anon key
npm run dev                    # http://localhost:3000
```

| Script | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit tests for scoring, stages and analytics |
| `npm run db:push` | Apply pending migrations to Supabase |
| `npm run db:list` | Compare local and remote migration history |
| `npm run setup:user` | Create a login (or reset its password) and set its role |

> **First deploy of v2 must apply the database migrations first.** See
> [Database](#database) — the app expects tables (`profiles`, `stages`, `contacts`, …) that the v2
> migrations create. Until they exist, every screen shows a "could not load" panel with the fix.

---

## Architecture

```
app/
  layout.tsx            root shell, fonts, theme bootstrap
  login/                email + password sign-in, password reset request
  auth/
    callback/           exchanges Supabase email-link codes for a session
    update-password/    completes a reset, or rotates your own password
  (crm)/
    layout.tsx          top nav, ⌘K palette, notifications, user menu
    page.tsx            dashboard — follow-up queue, hot leads, tasks, targets, trend
    leads/              list with filters + bulk actions; [id] detail with timeline
    pipeline/           drag-and-drop kanban with SLA/rotting indicators
    companies/          accounts + firmographics (feeds the fit score)
    contacts/           people, separate from opportunities
    signups/            website captures, dedupe-aware conversion
    reports/            funnel, velocity, source ROI, lost reasons, leaderboard
    targets/            per-owner monthly quotas with auto-computed actuals
    team/               roles, teams, lead transfer, bulk rescore
    settings/           own profile + scoring and SLA reference
lib/
  supabase/             browser / server / session clients
  queries.ts            all server-side reads (React `cache`d per render)
  actions/              server actions — the only write path
  scoring.ts            fit + engagement scoring (pure, tested)
  stages.ts             stage config, SLA, rotting, weighted value (pure, tested)
  analytics.ts          funnel, velocity, ROI, leaderboard (pure, tested)
  permissions.ts        UI mirror of the RLS policies
components/             UI kit, charts, and per-domain widgets
supabase/
  migrations/           versioned schema — the source of truth
  rollback/             hand-run scripts (never applied by `db push`)
legacy/                 the v1 single-file app, kept for rollback
proxy.ts                refreshes the auth cookie, gates every route
```

**Writes go through server actions only.** Each one re-resolves the caller from the session — the client
never supplies a user id. Reads live in `lib/queries.ts` so a page fetches once and passes data down.

---

## Lead lifecycle

Eleven stages, grouped into the funnel your playbook uses:

| Funnel | Stages | Meaning |
|---|---|---|
| **TOFU** | New · Contacted · Follow Up | Awareness and qualification |
| **MOFU** | Meeting Scheduled · Meeting Done · Demo Setup · Demo Done | Nurture, meetings, demos |
| **BOFU** | Onboarding · Won · Delayed · Lost | Negotiation and close |

Each stage carries an **SLA** and a **win probability** (`public.stages`, editable by admins). A lead past
its SLA turns amber; past double, red. Probability drives the weighted pipeline figure.

Every stage change writes three things — the lead's new state, a `stage_history` row (with days spent in
the previous stage), and a `StageChange` activity. **Lost and Delayed require a reason**, enforced in both
the action and the UI, which is what makes the "why we lose" report trustworthy.

---

## Lead scoring

Out of 100, split in half, following HubSpot's fit-vs-engagement model:

**Fit (0–50) — who they are**

| Factor | Max | Source |
|---|---|---|
| Company size | 12 | `companies.size_band` / `employee_count` |
| ICP match | 10 | `companies.is_icp` |
| Decision-maker level | 12 | inferred from the job title |
| Source quality | 10 | referral > inbound > event > outbound |
| Hiring need | 6 | `companies.hiring_need` |

**Engagement (0–50) — what they did**

| Factor | Max | Source |
|---|---|---|
| Recency | 12 | `last_activity_at` |
| Outreach volume | 10 | logged touches |
| Stage depth | 14 | the stage's win probability |
| Meetings & demos | 12 | activity types |
| Replies received | 6 | inbound-direction activities |

Engagement is **gated**: below 18/50 fit it counts for half, so a busy poor-fit lead cannot outrank a quiet
good-fit one. Grades: **A** ≥ 75, **B** ≥ 55, **C** ≥ 35, **D** below.

Scores recompute on every activity, stage change and edit; the drivers are shown per lead under
"Why this score", and changes are kept in `lead_score_history`. Admins can rescore everything from
**Team → Maintenance** after bulk-editing firmographics.

---

## Roles and access

| Role | Sees |
|---|---|
| **Admin** | Everything, plus user/team management and settings |
| **Manager** | Their own leads, every teammate's leads, and unassigned leads |
| **Rep** | Only the leads they own |

Enforced in Postgres by RLS, not just in the UI — `lib/permissions.ts` mirrors the policies so buttons that
would fail are hidden, but the database is the authority. Child rows (activities, stage history, score
history) inherit their lead's visibility. A trigger stops non-admins editing their own role, team or
active flag.

Accounts are created in **Supabase → Authentication → Users**. A profile row appears automatically on first
sign-in with the `rep` role; promote from the Team screen. Deactivating a user preserves all their history,
and their open leads can be transferred to someone else in one click.

---

## Targets

Monthly quotas, company-wide or per person, across six metrics: New leads, Reachouts, Meetings, Demos,
Deals won, Revenue. Actuals are **computed from the CRM's own data** rather than typed in, so they cannot
drift; a manual override is available per row. Each row shows pacing against where the month should be
("Ahead / On track / Behind"), and the trend chart compares target against actual across months.

---

## Database

Project `tcojgrxtpldiieytvthl` (org `akqbnjemvmmgfwyxgzwo`, account `shivang@hiraconnect.com`).
See [`supabase/README.md`](supabase/README.md) for the full workflow.

```bash
supabase login
supabase link --project-ref tcojgrxtpldiieytvthl
supabase db push
```

The v2 migrations are **additive** — new tables and nullable/defaulted columns only, no drops or renames —
and idempotent. They run in this order, and the order matters:

1. `20260729120000_v2_schema.sql` — teams, profiles, stages, contacts, scoring, notifications
2. `20260729120100_v2_backfill.sql` — **bootstraps every existing user as an admin**, derives contacts from
   leads, backfills lifecycle timestamps
3. `20260729120200_v2_rls.sql` — replaces blanket authenticated access with role-scoped policies
4. `20260729120300_v2_first_user_admin.sql` — the first account created while no admin exists becomes one,
   so a fresh project cannot lock its own owner out

Step 2 must run before step 3 or the team locks itself out. If scoped access causes a problem, restore the
previous behaviour with `supabase/rollback/v2_rls_down.sql` — it touches policies only, never data.

`raw_signups`, `documents`, `sheets` and `portal_page` are deliberately **left alone** by the RLS migration:
the public website writes into `raw_signups`, and re-policing it could silently break lead capture.

---

## Deploying

Vercel builds this repo as a Next.js app. [`vercel.json`](vercel.json) pins `framework: "nextjs"`, which
**overrides the dashboard preset** — the project was originally created for the v1 static `index.html`, so
without it Vercel runs a build and then fails looking for a `public/` directory that Next.js never
produces (*"No Output Directory named public found"*).

If that error persists after this file lands, the project also has an explicit **Output Directory**
override in the dashboard, which `vercel.json` cannot clear by omission. Reset it with:

```bash
vercel project update --framework nextjs --auto-detect output-directory --auto-detect build-command
```

or in Settings → Build & Deployment, switch Framework Preset to **Next.js** and turn the Output Directory
override off.

Run through the rest in order; steps 1–3 must happen **before** production traffic hits the new build.

**1. Apply the migrations.**

```bash
supabase link --project-ref tcojgrxtpldiieytvthl
supabase db push
```

**2. Set the environment variables** on the Vercel project, for Production *and* Preview:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://tcojgrxtpldiieytvthl.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the project's anon key |

Both are safe to expose — row access is enforced by RLS. The build **fails fast** if either is missing,
rather than shipping a broken app.

**3. Allowlist the auth redirect URLs** in Supabase → Authentication → URL Configuration. Password-reset
links are rejected if the origin is not listed:

- Site URL: your production domain
- Redirect URLs: `https://<production-domain>/auth/callback`, `https://*.vercel.app/auth/callback`
  (for previews), `http://localhost:3000/auth/callback` (for local work)

**4. Deploy**, then verify in this order:

1. Sign in — you land on the dashboard, not an error panel.
2. **Team** — every existing user shows as *Admin*. Demote to manager/rep from here; that is the only
   place roles change.
3. Open a lead — timeline, score breakdown and stage control all render.
4. Move a lead to **Lost** — it should refuse without a reason.
5. **Targets → Refresh actuals** — numbers populate from real data.

**Rolling back.** The database rollback is `supabase/rollback/v2_rls_down.sql` (policies only, never data).
The app rollback is the previous Vercel deployment, or `legacy/index.html` served statically — it still
talks to the same project.

### Accounts

The quickest path — creates the login, confirms the email, and sets the role in one step:

```bash
# add SUPABASE_SERVICE_ROLE_KEY to .env.local first (see .env.example)
npm run setup:user -- --email you@hiraconnect.com --password 'your-password' --name 'Your Name' --role admin
```

Re-running it on an existing address **resets that account's password**, which is the fastest way to
recover a locked-out user.

You can also create users in **Supabase → Authentication → Users**, with two caveats the script exists to
avoid:

- tick **Auto Confirm User**, or sign-in fails with *"Email not confirmed"*
- an account created **after** the migrations gets the `rep` role, and a rep has no route to the Team
  screen to promote themselves. `20260729120300_v2_first_user_admin.sql` covers the *first* such account;
  after that, an existing admin must promote people from **Team**.

Users can change their own password from the "Forgot your password?" link on sign-in, or
**Settings → Change my password** once inside.

### Login troubleshooting

| Symptom | Cause |
|---|---|
| *Invalid login credentials* | The account does not exist — run `npm run setup:user`. |
| *Email not confirmed* | Created via the dashboard without Auto Confirm. Re-run `setup:user` on the same address. |
| Signs in, then every screen shows "could not load" | Migrations not applied. Run `supabase db push`. |
| Signs in, but sees almost nothing | Profile role is `rep`. Promote from **Team**, or re-run `setup:user` with `--role admin`. |
| Build fails on Vercel with a missing-env error | `NEXT_PUBLIC_SUPABASE_*` not set for that environment. The app fails fast by design. |
