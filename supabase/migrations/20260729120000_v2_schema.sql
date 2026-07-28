-- v2.0 — CRM rebuild schema: teams, profiles, contacts, stage config, scoring, notifications.
-- Strictly ADDITIVE: new tables + nullable/defaulted columns only. No drops, no renames, no type changes.
-- Safe to re-run (every statement is guarded).

-- =========================================================================
-- 1. RBAC backbone: teams + profiles (profiles mirror auth.users 1:1)
-- =========================================================================
create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'rep',
  team_id    uuid references public.teams(id) on delete set null,
  is_active  boolean not null default true,
  phone      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_chk') then
    alter table public.profiles
      add constraint profiles_role_chk check (role in ('admin','manager','rep'));
  end if;
end $$;

-- teams.manager_id added after profiles exists (circular reference)
alter table public.teams add column if not exists manager_id uuid references public.profiles(id) on delete set null;

create index if not exists profiles_team_idx  on public.profiles(team_id);
create index if not exists profiles_role_idx  on public.profiles(role);
create index if not exists profiles_email_idx on public.profiles(lower(email));

-- keep updated_at honest
create or replace function public.crm_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.crm_touch_updated_at();

-- every new auth user automatically gets a profile (default role: rep)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email,''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- 2. Stage configuration (TOFU / MOFU / BOFU + SLA + probability)
--    Keys match the 11 stage strings already stored in leads.status.
-- =========================================================================
create table if not exists public.stages (
  key         text primary key,
  label       text not null,
  funnel      text not null default 'TOFU',   -- TOFU | MOFU | BOFU
  category    text not null default 'open',   -- open | won | lost
  sort        int  not null default 0,
  sla_days    int  not null default 7,        -- rotting threshold
  probability numeric not null default 0,     -- weighted-pipeline %
  is_active   boolean not null default true
);

insert into public.stages(key, label, funnel, category, sort, sla_days, probability) values
  ('New',               'New',               'TOFU', 'open',  10,  2,   5),
  ('Contacted',         'Contacted',         'TOFU', 'open',  20,  3,  10),
  ('Follow Up',         'Follow Up',         'TOFU', 'open',  30,  5,  20),
  ('Meeting Scheduled', 'Meeting Scheduled', 'MOFU', 'open',  40,  7,  35),
  ('Meeting Done',      'Meeting Done',      'MOFU', 'open',  50,  7,  45),
  ('Demo Setup',        'Demo Setup',        'MOFU', 'open',  60,  5,  55),
  ('Demo Done',         'Demo Done',         'MOFU', 'open',  70,  7,  65),
  ('Onboarding',        'Onboarding',        'BOFU', 'open',  80, 14,  85),
  ('Won',               'Won',               'BOFU', 'won',   90,  0, 100),
  ('Delayed',           'Delayed',           'BOFU', 'open',  95, 30,  15),
  ('Lost',              'Lost',              'BOFU', 'lost', 100,  0,   0)
on conflict (key) do nothing;

-- =========================================================================
-- 3. Contacts (people), separated from leads (opportunities)
-- =========================================================================
create table if not exists public.contacts (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  full_name  text not null,
  title      text,
  seniority  text,                       -- exec | head | manager | ic | unknown
  email      text,
  phone      text,
  whatsapp   text,
  linkedin   text,
  is_primary boolean not null default false,
  notes      text,
  created_at timestamptz not null default now()
);
create index if not exists contacts_company_idx on public.contacts(company_id);
create index if not exists contacts_email_idx   on public.contacts(lower(email));

-- =========================================================================
-- 4. Companies — firmographics used by the fit score
-- =========================================================================
alter table public.companies add column if not exists employee_count int;
alter table public.companies add column if not exists size_band      text;  -- small | mid | large | enterprise
alter table public.companies add column if not exists domain         text;
alter table public.companies add column if not exists hiring_need    text;  -- niche | general | unknown
alter table public.companies add column if not exists is_icp         boolean;

-- =========================================================================
-- 5. Leads — ownership, lifecycle timestamps, deal fields
--    NOTE: the existing `status` column remains the stage key (joins public.stages.key).
--    The legacy `owner` text column is kept; owner_id is the new source of truth.
-- =========================================================================
alter table public.leads add column if not exists owner_id           uuid references public.profiles(id) on delete set null;
alter table public.leads add column if not exists team_id            uuid references public.teams(id)    on delete set null;
alter table public.leads add column if not exists contact_id         uuid references public.contacts(id) on delete set null;
alter table public.leads add column if not exists score_total        int not null default 0;
alter table public.leads add column if not exists score_updated_at   timestamptz;
alter table public.leads add column if not exists first_contacted_at timestamptz;
alter table public.leads add column if not exists qualified_at       timestamptz;
alter table public.leads add column if not exists won_at             timestamptz;
alter table public.leads add column if not exists lost_at            timestamptz;
alter table public.leads add column if not exists currency           text not null default 'INR';
alter table public.leads add column if not exists priority           text;

create index if not exists leads_owner_idx    on public.leads(owner_id);
create index if not exists leads_team_idx     on public.leads(team_id);
create index if not exists leads_status_idx   on public.leads(status);
create index if not exists leads_nextdate_idx on public.leads(next_action_date);
create index if not exists leads_score_idx    on public.leads(score_total desc);
create index if not exists leads_company_idx  on public.leads(company_id);

-- =========================================================================
-- 6. Score history — "why did this lead's score change"
-- =========================================================================
create table if not exists public.lead_score_history (
  id               uuid primary key default gen_random_uuid(),
  lead_id          uuid not null references public.leads(id) on delete cascade,
  score_fit        int not null default 0,
  score_engagement int not null default 0,
  score_total      int not null default 0,
  grade            text,
  reason           text,
  created_at       timestamptz not null default now()
);
create index if not exists lead_score_history_lead_idx on public.lead_score_history(lead_id, created_at desc);

-- =========================================================================
-- 7. Activities & stage history — link to profiles, index hot paths
-- =========================================================================
alter table public.activities add column if not exists owner_id     uuid references public.profiles(id) on delete set null;
alter table public.activities add column if not exists contact_id   uuid references public.contacts(id) on delete set null;
alter table public.activities add column if not exists completed_at timestamptz;

create index if not exists activities_lead_idx  on public.activities(lead_id, created_at desc);
create index if not exists activities_owner_idx on public.activities(owner_id, created_at desc);
create index if not exists activities_due_idx   on public.activities(due_date) where done = false;

alter table public.stage_history add column if not exists changed_by_id     uuid references public.profiles(id) on delete set null;
alter table public.stage_history add column if not exists days_in_from_stage int;

-- =========================================================================
-- 8. Targets — per-owner / per-team quotas with auto-computed actuals
-- =========================================================================
alter table public.monthly_targets add column if not exists owner_id    uuid references public.profiles(id) on delete cascade;
alter table public.monthly_targets add column if not exists team_id     uuid references public.teams(id)    on delete set null;
alter table public.monthly_targets add column if not exists auto_actual boolean not null default true;
alter table public.monthly_targets add column if not exists notes       text;

-- one row per (month, metric, owner). Guarded: if legacy rows already collide,
-- the index is skipped rather than failing the migration.
do $$ begin
  begin
    create unique index if not exists monthly_targets_uniq
      on public.monthly_targets (month, metric, (coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid)));
  exception when others then
    raise notice 'monthly_targets_uniq skipped (duplicate legacy rows): %', sqlerrm;
  end;
end $$;

-- =========================================================================
-- 9. Saved views — owner as uuid (legacy `owner` text kept)
-- =========================================================================
alter table public.saved_views add column if not exists owner_id  uuid references public.profiles(id) on delete cascade;
alter table public.saved_views add column if not exists is_shared boolean not null default false;

-- =========================================================================
-- 10. Notifications — in-app reminders (overdue follow-ups, reassignment)
-- =========================================================================
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  lead_id    uuid references public.leads(id) on delete cascade,
  type       text not null default 'reminder',   -- reminder | assignment | stage | system
  title      text not null,
  body       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);
