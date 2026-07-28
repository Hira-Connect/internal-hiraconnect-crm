# HIRA Connect CRM — Supabase backend

Backend project for the Next.js CRM at the [repo root](../README.md). This folder is the **reproducible source of truth** for the database schema and edge functions, managed with the Supabase CLI.

- **Remote project ref:** `tcojgrxtpldiieytvthl`
- **Org:** `akqbnjemvmmgfwyxgzwo` (account `shivang@hiraconnect.com`)
- **URL:** `https://tcojgrxtpldiieytvthl.supabase.co`
- **App connection:** the frontend uses the project URL + **anon** key, read from `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Unchanged by the org move — the ref stayed the same.

## Layout
```
supabase/
  config.toml                 # CLI + local-stack config (PG major = 17)
  migrations/                 # versioned schema (source of truth)
    20260716120000_phase0_foundation.sql
    20260716120100_phase0_backfill.sql
    20260729120000_v2_schema.sql      # teams, profiles, stages, contacts, scoring, notifications
    20260729120100_v2_backfill.sql    # bootstrap admins, derive contacts, lifecycle timestamps
    20260729120200_v2_rls.sql         # role-scoped row security
  rollback/
    v2_rls_down.sql           # hand-run only; restores blanket authenticated access
  functions/
    _shared/cors.ts           # shared CORS/json helpers (not deployed)
    _template/index.ts        # copy-me reference function (not deployed; "_" dirs are skipped)
```

## The v2 migrations

All three are **additive** (new tables, nullable/defaulted columns — no drops, renames or type changes)
and idempotent. Order matters:

1. **`v2_schema`** creates `teams`, `profiles`, `stages`, `contacts`, `lead_score_history`,
   `notifications`, and adds ownership/lifecycle/scoring columns to `leads`, `activities`,
   `stage_history`, `monthly_targets` and `saved_views`.
2. **`v2_backfill`** creates a default team, gives **every existing auth user an `admin` profile**,
   maps the legacy `leads.owner` text onto `owner_id`, derives a contact per lead, and fills
   `first_contacted_at` / `qualified_at` / `won_at` / `lost_at` from `stage_history`.
3. **`v2_rls`** replaces the old `using(true)` policies with role-scoped ones
   (admin → all, manager → team + unassigned, rep → own).

> Step 2 **must** run before step 3. It is what guarantees the current team still has access once the
> scoped policies go live. `supabase db push` applies them in filename order, so a plain push is correct.

**Deliberately untouched by `v2_rls`:** `raw_signups`, `documents`, `sheets`, `portal_page`. The public
website writes into `raw_signups`; re-policing it here could silently break lead capture.

### If role scoping goes wrong

```bash
supabase db execute --file supabase/rollback/v2_rls_down.sql
```

That restores "any authenticated user has full access" on the CRM tables. It changes policies only —
schema and data are untouched — so you can push `v2_rls` again after fixing the cause.

## One-time setup
```bash
# Install CLI (any one)
npm i -g supabase          # or: scoop install supabase / brew install supabase/tap/supabase

supabase login             # log in as shivang@hiraconnect.com
supabase link --project-ref tcojgrxtpldiieytvthl
```

## Schema / migrations
The Phase 0 migrations were applied to the remote earlier (via MCP). They are **idempotent** (`if not exists` / `on conflict`), so they document the current state and re-run safely on a fresh restore. The three v2 migrations are **not yet applied** — pushing them is the first step of the v2 rollout.

```bash
supabase migration list                 # compare local vs remote history
supabase db push                        # applies the pending v2 migrations, in order
```

**If `db push` refuses with "Remote migration versions not found in local migrations directory"**, the
remote's `supabase_migrations.schema_migrations` bookkeeping table already lists some versions that have
no matching file in this repo — the original app's tables were created with ad hoc SQL before this
`supabase/` folder existed, and that history was never captured as files. The CLI's own error message
names the exact versions; repair those, then push again:

```bash
supabase migration repair --status reverted <the versions the error listed>
supabase db push
```

`repair` only edits that bookkeeping table — it does not touch schema or data. The tables those old runs
created stay exactly as they are; this just tells the CLI to stop expecting local files for them.

```bash
# Going forward — new schema change:
supabase migration new my_change        # creates a new timestamped file
#   ...edit the SQL...
supabase db push                        # apply to remote
```
Always add schema changes as a **new migration file** (never edit an applied one), and keep them additive where possible.

After pushing, sanity-check the bootstrap before handing the app to the team:

```sql
select email, role, is_active from public.profiles order by created_at;   -- everyone should be admin
select count(*) from public.stages;                                        -- 11
select count(*) from public.leads where contact_id is null;                -- 0
```

## Edge functions
```bash
cp -r functions/_template functions/my-func     # start from the template
supabase functions serve my-func                # run locally
supabase functions deploy my-func --project-ref tcojgrxtpldiieytvthl
supabase secrets set MY_KEY=value               # SUPABASE_URL / SERVICE_ROLE_KEY are auto-injected
```
Scoring and target actuals now run in the app's server actions (`lib/scoring.ts`, `lib/actions/targets.ts`), so no edge function is required for them. The remaining candidate is a scheduled **overdue-follow-up digest** that writes into `public.notifications`.

## Local development
```bash
supabase start     # spins up full local stack (db/api/studio/inbucket)
supabase db reset  # rebuild local db from migrations (+ seed.sql if present)
supabase stop
```

## Note on Claude's access
Claude's Supabase MCP connector was bound to the previous account and **lost access when the project moved** to `akqbnjemvmmgfwyxgzwo`. To let Claude run migrations/SQL again, re-authorize the Supabase connector to the `shivang@hiraconnect.com` account in claude.ai connector settings. Until then, apply changes via this CLI folder.
