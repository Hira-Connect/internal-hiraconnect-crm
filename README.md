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
| `npm run mail:test` | Send a real account email through the configured SMTP account |

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
    confirm/            verifies an emailed invite/reset token, opens a session
    callback/           legacy PKCE `?code=` exchange, kept for old links
    update-password/    completes an invitation or a reset
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
  supabase/             browser / server / session clients, plus the admin one
  email/                account emails — transport (Resend or SMTP) + templates
  auth-links.ts         builds the one-time /auth/confirm links we email
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

Admins add people from **Team → Invite a teammate**: give an email, name, role and team, and the CRM
creates the login and emails a one-time link to choose a password. Until they open it they show as
**Invited**, and the invitation can be resent or cancelled. Deactivating a user who has signed in preserves
all their history, and their open leads can be transferred to someone else in one click.

---

## Account emails

Invitations and password resets are sent **by this app**, not by Supabase. Supabase mints the account and
the one-time token; the link in the email points at `/auth/confirm` on this domain, which verifies the
token and opens a session.

That is deliberate. The obvious alternative — Supabase's own mailer with `{{ .ConfirmationURL }}` — sends
every click through GoTrue's redirect allow-list, and when the destination is not on that list GoTrue
**silently falls back to the project's Site URL**. That is what broke password reset here: Site URL was
`http://localhost:3000`, so every reset email in production pointed at the user's own laptop. Owning the
link removes that failure mode, keeps the templates in this repo, and makes the link work on any device —
a `token_hash` needs no cookie from the browser that asked for the reset, unlike the PKCE `?code=` flow.

Three server-side variables make it work — see [`.env.example`](.env.example):

| Variable | Why |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | mints accounts and one-time tokens. **Never** prefix it `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_SITE_URL` | where emailed links point, so a preview deploy cannot email a link into the preview |
| `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` (+ optional `EMAIL_FROM`) | the transport |

**Without a transport the features still work, they just do not send.** The account is created and the
one-time link is shown in the UI for an admin to pass on by hand. `SUPABASE_SERVICE_ROLE_KEY` is the one
hard requirement: without it, invitations and "Forgot your password?" are disabled outright.

### Hostinger mail

The mailbox comes from **hPanel → Emails → your mailbox → Configuration settings**:

```
SMTP_HOST=smtp.hostinger.com     # Titan-based plans use smtp.titan.email
SMTP_PORT=465                    # SSL. Port 587 also works — the app picks STARTTLS for it
SMTP_USER=crm@hiraconnect.com    # the FULL address, not just the part before the @
SMTP_PASS=…                      # that mailbox's own password
```

Use a dedicated mailbox (`crm@`) rather than a personal one — its password ends up in the deployment's
environment. `EMAIL_FROM` may be left unset, in which case `SMTP_USER` is used: Hostinger refuses to send
as any address you did not authenticate as, so a mismatched From only produces bounces.

Prove the credentials before anyone relies on them:

```bash
npm run mail:test -- --to you@hiraconnect.com              # the reset email
npm run mail:test -- --to you@hiraconnect.com --template invite
```

`RESEND_API_KEY` is supported as an alternative and takes precedence if both are set.

Anyone signed in can rotate their own password from **Settings → Password** (it asks for the current one
first). An admin can email anybody a reset link from **Team → Send reset link**, which is the fastest way to
rescue a locked-out teammate.

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
5. `20260802120000_profile_guard_service_role.sql` — lets the service-role key through the privilege guard.
   Without it the guard reverts role/team/is\_active writes made with that key **and reports no error**, so
   `setup:user --role admin` silently did nothing on an account that already had a profile row

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

| Variable | Value | Exposed to the browser |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://tcojgrxtpldiieytvthl.supabase.co` | yes — safe, RLS enforces access |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the project's anon key | yes — safe, RLS enforces access |
| `NEXT_PUBLIC_SITE_URL` | `https://<production-domain>` | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | the project's service\_role key | **no — server only** |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` | the Hostinger mailbox — see [Account emails](#account-emails) | **no — server only** |

The build **fails fast** if either `NEXT_PUBLIC_SUPABASE_*` is missing, rather than shipping a broken app.
Invitations and password resets are disabled without `SUPABASE_SERVICE_ROLE_KEY`, and fall back to a
copyable link without a mail transport.

**3. Set the auth URLs** in Supabase → Authentication → URL Configuration. The invitation and reset emails
this app sends do not depend on them — they point straight at `/auth/confirm` — but Site URL is still the
destination for anything triggered from the Supabase dashboard, and it must not be left on localhost:

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

Day to day, add people from **Team → Invite a teammate** — see [Account emails](#account-emails).

`npm run setup:user` is the break-glass path: it works without a mail transport and can set a password
directly, which is what you want for the very first admin or a locked-out one.

```bash
# add SUPABASE_SERVICE_ROLE_KEY to .env.local first (see .env.example)
npm run setup:user -- --email you@hiraconnect.com --password 'your-password' --name 'Your Name' --role admin
```

Re-running it on an existing address **resets that account's password**. Setting `--role` on an account
that already has a profile row needs migration 5 applied; the script now reads the row back and says so if
the privilege guard reverted it.

Creating users in **Supabase → Authentication → Users** still works, with two caveats the invite flow and
the script both avoid: tick **Auto Confirm User** or sign-in fails with *"Email not confirmed"*, and the
new account lands as a `rep` with no route to promote itself.

### Login troubleshooting

| Symptom | Cause |
|---|---|
| *Invalid login credentials* | The account does not exist — invite them from **Team**, or run `npm run setup:user`. |
| *Email not confirmed* | Created via the dashboard without Auto Confirm. Re-run `setup:user` on the same address. |
| Reset email never arrives | Run `npm run mail:test -- --to <you>`. If that works the transport is fine and the mail is in spam; if it does not, the error names the cause. An admin can hand over a link from **Team → Send reset link** in the meantime. |
| *535 Authentication failed* from Hostinger | `SMTP_USER` must be the full mailbox address and `SMTP_PASS` that mailbox's own password — not the hPanel login. |
| *Sender address rejected* | `EMAIL_FROM` is not the mailbox you authenticated as. Clear it and the app uses `SMTP_USER`. |
| *That link has already been used or has expired* | Links are single-use and short-lived; a corporate email scanner that pre-opens links will burn one. Ask for a new one. |
| *Password reset is not set up on this server yet* | `SUPABASE_SERVICE_ROLE_KEY` is missing from the deployment. |
| Signs in, then every screen shows "could not load" | Migrations not applied. Run `supabase db push`. |
| Signs in, but sees almost nothing | Profile role is `rep`. Promote from **Team**, or re-run `setup:user` with `--role admin`. |
| Build fails on Vercel with a missing-env error | `NEXT_PUBLIC_SUPABASE_*` not set for that environment. The app fails fast by design. |
