-- v2.0 — backfill. Data-only, idempotent, non-destructive.
-- Runs BEFORE the RLS tightening migration on purpose: every existing sign-in must
-- already have an admin profile by the time scoped policies go live, or the team
-- locks itself out of its own data.

-- =========================================================================
-- 1. Bootstrap: default team + a profile for every existing auth user.
--    Existing users become ADMIN (today's team is 1-3 trusted admins).
--    Demote to manager/rep from the Team screen afterwards.
--    New sign-ups created later default to 'rep' via handle_new_user().
-- =========================================================================
insert into public.teams (name, description)
values ('HIRA Sales', 'Default team — created by the v2 migration')
on conflict (name) do nothing;

insert into public.profiles (id, email, full_name, role, team_id)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', split_part(coalesce(u.email,''), '@', 1)),
  'admin',
  (select id from public.teams where name = 'HIRA Sales')
from auth.users u
on conflict (id) do nothing;

-- any profile that predates teams gets the default team
update public.profiles
set team_id = (select id from public.teams where name = 'HIRA Sales')
where team_id is null;

-- default team manager = the oldest admin
update public.teams t
set manager_id = (select p.id from public.profiles p where p.role = 'admin' order by p.created_at limit 1)
where t.name = 'HIRA Sales' and t.manager_id is null;

-- =========================================================================
-- 2. Map the legacy `owner` text column onto owner_id (match by email or name)
-- =========================================================================
update public.leads l
set owner_id = p.id
from public.profiles p
where l.owner_id is null
  and l.owner is not null
  and (lower(p.email) = lower(l.owner) or lower(p.full_name) = lower(l.owner));

-- keep team_id consistent with whoever owns the lead
update public.leads l
set team_id = p.team_id
from public.profiles p
where l.owner_id = p.id and l.team_id is distinct from p.team_id;

-- =========================================================================
-- 3. Derive contacts from the person fields already stored on each lead
-- =========================================================================
insert into public.contacts (company_id, full_name, title, email, phone, whatsapp, linkedin, is_primary, notes)
select l.company_id, l.name, l.title, l.email, l.phone, l.whatsapp, l.linkedin, true,
       'Backfilled from lead at v2 migration'
from public.leads l
where l.contact_id is null
  and coalesce(nullif(trim(l.name), ''), '') <> '';

-- link each lead to the contact just created for it
update public.leads l
set contact_id = c.id
from public.contacts c
where l.contact_id is null
  and c.notes = 'Backfilled from lead at v2 migration'
  and c.full_name = l.name
  and c.company_id is not distinct from l.company_id;

-- =========================================================================
-- 4. Attribute existing activity / stage history to profiles
-- =========================================================================
update public.activities a
set owner_id = p.id
from public.profiles p
where a.owner_id is null and a.author is not null and lower(p.email) = lower(a.author);

update public.stage_history s
set changed_by_id = p.id
from public.profiles p
where s.changed_by_id is null and s.changed_by is not null and lower(p.email) = lower(s.changed_by);

-- =========================================================================
-- 5. Lifecycle timestamps from the stage history we already recorded
-- =========================================================================
update public.leads l
set first_contacted_at = sub.t
from (
  select lead_id, min(changed_at) t
  from public.stage_history
  where to_stage in ('Contacted','Follow Up','Meeting Scheduled','Meeting Done','Demo Setup','Demo Done','Onboarding','Won')
  group by lead_id
) sub
where sub.lead_id = l.id and l.first_contacted_at is null;

update public.leads l
set qualified_at = sub.t
from (
  select lead_id, min(changed_at) t
  from public.stage_history
  where to_stage in ('Meeting Scheduled','Meeting Done','Demo Setup','Demo Done','Onboarding','Won')
  group by lead_id
) sub
where sub.lead_id = l.id and l.qualified_at is null;

update public.leads l
set won_at = sub.t
from (select lead_id, max(changed_at) t from public.stage_history where to_stage = 'Won' group by lead_id) sub
where sub.lead_id = l.id and l.won_at is null;

update public.leads l
set lost_at = sub.t
from (select lead_id, max(changed_at) t from public.stage_history where to_stage = 'Lost' group by lead_id) sub
where sub.lead_id = l.id and l.lost_at is null;

-- leads already sitting in a terminal stage but with no history row for it
update public.leads set won_at  = coalesce(won_at,  last_activity_at, created_at) where status = 'Won'  and won_at  is null;
update public.leads set lost_at = coalesce(lost_at, last_activity_at, created_at) where status = 'Lost' and lost_at is null;

-- =========================================================================
-- 6. Company firmographics we can infer without guessing
-- =========================================================================
update public.companies
set domain = lower(regexp_replace(regexp_replace(website, '^https?://', ''), '/.*$', ''))
where domain is null and website is not null and trim(website) <> '';

update public.companies
set size_band = case
  when employee_count is null      then null
  when employee_count < 50         then 'small'
  when employee_count < 250        then 'mid'
  when employee_count < 1000       then 'large'
  else 'enterprise'
end
where size_band is null and employee_count is not null;

-- =========================================================================
-- 7. Sanity: stage keys in leads.status must all exist in public.stages
-- =========================================================================
insert into public.stages (key, label, funnel, category, sort, sla_days, probability)
select distinct l.status, l.status, 'TOFU', 'open', 500, 7, 0
from public.leads l
where l.status is not null
  and not exists (select 1 from public.stages s where s.key = l.status)
on conflict (key) do nothing;
