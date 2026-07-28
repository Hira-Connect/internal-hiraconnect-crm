-- v2.0 — Role-based row security (admin / manager / rep).
--
-- Replaces the previous "any authenticated user sees everything" convention on the
-- CRM tables. Visibility rules:
--   admin    → everything
--   manager  → own leads + any lead owned by a teammate + unassigned leads (for triage)
--   rep      → only leads they own
-- Child rows (activities, stage history, score history) inherit their lead's visibility.
--
-- Deliberately NOT touched: raw_signups, documents, sheets, portal_page.
-- The public website writes into raw_signups; re-policing it here could silently
-- break lead capture. Left exactly as-is.
--
-- Rollback: supabase/rollback/v2_rls_down.sql (restores blanket authenticated access).

-- =========================================================================
-- 1. Helper functions. SECURITY DEFINER so that reading public.profiles from
--    inside a profiles policy cannot recurse. search_path pinned.
-- =========================================================================
create or replace function public.crm_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select p.role from public.profiles p where p.id = auth.uid() and p.is_active), 'none');
$$;

create or replace function public.crm_team_id()
returns uuid language sql stable security definer set search_path = public as $$
  select (select p.team_id from public.profiles p where p.id = auth.uid() and p.is_active);
$$;

create or replace function public.crm_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.crm_role() = 'admin';
$$;

create or replace function public.crm_is_manager_up()
returns boolean language sql stable security definer set search_path = public as $$
  select public.crm_role() in ('admin','manager');
$$;

-- Can the current user see a lead with this owner / team?
create or replace function public.crm_can_see_lead(p_owner uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.crm_role()
    when 'admin' then true
    when 'manager' then
         p_owner is null
      or p_owner = auth.uid()
      or p_team is not distinct from public.crm_team_id()
      or exists (select 1 from public.profiles m
                 where m.id = p_owner and m.team_id is not distinct from public.crm_team_id())
    when 'rep' then p_owner = auth.uid()
    else false
  end;
$$;

-- Same test, by lead id — used by child tables.
create or replace function public.crm_can_see_lead_id(p_lead uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.id = p_lead and public.crm_can_see_lead(l.owner_id, l.team_id)
  );
$$;

grant execute on function
  public.crm_role(), public.crm_team_id(), public.crm_is_admin(),
  public.crm_is_manager_up(), public.crm_can_see_lead(uuid, uuid),
  public.crm_can_see_lead_id(uuid)
to authenticated;

-- =========================================================================
-- 2. Privilege guard: a rep may edit their own name/phone but must never be
--    able to grant themselves a role, switch team, or reactivate an account.
-- =========================================================================
create or replace function public.crm_guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.crm_is_admin() then
    return new;
  end if;
  new.role      := old.role;
  new.team_id   := old.team_id;
  new.is_active := old.is_active;
  new.id        := old.id;
  return new;
end $$;

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.crm_guard_profile_update();

-- =========================================================================
-- 3. Enable RLS and clear the legacy permissive policies on managed tables.
-- =========================================================================
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
      execute format('alter table public.%I enable row level security', t);
      for r in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
        execute format('drop policy if exists %I on public.%I', r.policyname, t);
      end loop;
    end if;
  end loop;
end $$;

-- =========================================================================
-- 4. Directory tables — every signed-in user may read, admins may write.
--    (Owner dropdowns, leaderboards and @-attribution all need the roster.)
-- =========================================================================
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (public.crm_is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (public.crm_is_admin() or id = auth.uid())
  with check (public.crm_is_admin() or id = auth.uid());
create policy profiles_delete on public.profiles for delete to authenticated using (public.crm_is_admin());

create policy teams_select on public.teams for select to authenticated using (true);
create policy teams_write  on public.teams for all    to authenticated
  using (public.crm_is_admin()) with check (public.crm_is_admin());

create policy stages_select on public.stages for select to authenticated using (true);
create policy stages_write  on public.stages for all    to authenticated
  using (public.crm_is_admin()) with check (public.crm_is_admin());

create policy lost_reasons_select on public.lost_reasons for select to authenticated using (true);
create policy lost_reasons_write  on public.lost_reasons for all    to authenticated
  using (public.crm_is_manager_up()) with check (public.crm_is_manager_up());

-- =========================================================================
-- 5. Accounts & people — shared reference data for the whole team.
-- =========================================================================
create policy companies_select on public.companies for select to authenticated using (true);
create policy companies_write  on public.companies for insert to authenticated with check (public.crm_role() <> 'none');
create policy companies_update on public.companies for update to authenticated
  using (public.crm_role() <> 'none') with check (public.crm_role() <> 'none');
create policy companies_delete on public.companies for delete to authenticated using (public.crm_is_manager_up());

create policy contacts_select on public.contacts for select to authenticated using (true);
create policy contacts_write  on public.contacts for insert to authenticated with check (public.crm_role() <> 'none');
create policy contacts_update on public.contacts for update to authenticated
  using (public.crm_role() <> 'none') with check (public.crm_role() <> 'none');
create policy contacts_delete on public.contacts for delete to authenticated using (public.crm_is_manager_up());

-- =========================================================================
-- 6. Leads — the scoped core.
-- =========================================================================
create policy leads_select on public.leads for select to authenticated
  using (public.crm_can_see_lead(owner_id, team_id));

-- a rep may only create leads they own; managers/admins may assign to anyone
create policy leads_insert on public.leads for insert to authenticated
  with check (
    public.crm_role() <> 'none'
    and (public.crm_is_manager_up() or coalesce(owner_id, auth.uid()) = auth.uid())
  );

create policy leads_update on public.leads for update to authenticated
  using (public.crm_can_see_lead(owner_id, team_id))
  with check (public.crm_can_see_lead(owner_id, team_id));

create policy leads_delete on public.leads for delete to authenticated
  using (public.crm_is_manager_up() and public.crm_can_see_lead(owner_id, team_id));

-- =========================================================================
-- 7. Lead children — inherit the lead's visibility.
--    Stage/score history is an append-only audit trail: no update, admin-only delete.
-- =========================================================================
create policy activities_select on public.activities for select to authenticated
  using (public.crm_can_see_lead_id(lead_id));
create policy activities_insert on public.activities for insert to authenticated
  with check (public.crm_can_see_lead_id(lead_id));
create policy activities_update on public.activities for update to authenticated
  using (public.crm_can_see_lead_id(lead_id))
  with check (public.crm_can_see_lead_id(lead_id));
create policy activities_delete on public.activities for delete to authenticated
  using (public.crm_is_manager_up() and public.crm_can_see_lead_id(lead_id));

create policy stage_history_select on public.stage_history for select to authenticated
  using (public.crm_can_see_lead_id(lead_id));
create policy stage_history_insert on public.stage_history for insert to authenticated
  with check (public.crm_can_see_lead_id(lead_id));
create policy stage_history_delete on public.stage_history for delete to authenticated
  using (public.crm_is_admin());

create policy lead_score_history_select on public.lead_score_history for select to authenticated
  using (public.crm_can_see_lead_id(lead_id));
create policy lead_score_history_insert on public.lead_score_history for insert to authenticated
  with check (public.crm_can_see_lead_id(lead_id));
create policy lead_score_history_delete on public.lead_score_history for delete to authenticated
  using (public.crm_is_admin());

-- =========================================================================
-- 8. Targets — readable by all (leaderboards need them), set by managers up.
-- =========================================================================
create policy monthly_targets_select on public.monthly_targets for select to authenticated using (true);
create policy monthly_targets_write  on public.monthly_targets for all to authenticated
  using (public.crm_is_manager_up()) with check (public.crm_is_manager_up());

-- =========================================================================
-- 9. Personal objects.
-- =========================================================================
create policy saved_views_rw on public.saved_views for all to authenticated
  using (owner_id = auth.uid() or owner_id is null or is_shared)
  with check (owner_id = auth.uid() or owner_id is null);

create policy notifications_rw on public.notifications for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
