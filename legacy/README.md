# Legacy app (v1)

`index.html` is the original single-file CRM: Preact + `htm` + `@supabase/supabase-js` over ESM CDN,
no build step, deployed static on Vercel. It was the live app until the v2 rebuild.

**Kept as a rollback artifact.** It talks to the same Supabase project (`tcojgrxtpldiieytvthl`) using the
same anon key, and the v2 migrations are additive, so it still runs against the current schema — with one
caveat: after `20260729120200_v2_rls.sql`, row access is scoped by role. A user whose profile is `rep`
will only see their own leads in this app too.

To serve it again, either:

- deploy this file as a static site (it needs no toolchain), or
- roll the database back to blanket access first with `supabase/rollback/v2_rls_down.sql`.

Do not develop against it — all work now happens in the Next.js app at the repo root.
