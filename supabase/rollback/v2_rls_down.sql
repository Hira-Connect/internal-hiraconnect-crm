-- ROLLBACK for 20260729120200_v2_rls.sql — restores the previous
-- "any authenticated user has full access" convention on the CRM tables.
--
-- This file is NOT a migration (it lives outside supabase/migrations/ so that
-- `supabase db push` never runs it). Apply it by hand only if role scoping
-- locks the team out:
--
--   supabase db execute --file supabase/rollback/v2_rls_down.sql
--   -- or paste it into the SQL editor in the Supabase dashboard
--
-- Schema and data are untouched by this file; only policies change.

do $$
declare
  managed text[] := array[
    'leads','activities','stage_history','lead_score_history','companies',
    'contacts','monthly_targets','saved_views','lost_reasons','profiles',
    'teams','notifications','stages'
  ];
  t text;
  r record;
begin
  foreach t in array managed loop
    if to_regclass('public.' || t) is not null then
      for r in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
        execute format('drop policy if exists %I on public.%I', r.policyname, t);
      end loop;
      execute format(
        'create policy %I on public.%I for all to authenticated using (true) with check (true)',
        'auth full access ' || t, t
      );
    end if;
  end loop;
end $$;

-- the privilege guard is what stops a rep granting themselves admin;
-- drop it only if you are also reverting the role model entirely.
-- drop trigger if exists profiles_guard_update on public.profiles;
