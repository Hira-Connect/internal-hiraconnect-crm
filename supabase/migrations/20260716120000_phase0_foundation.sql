-- Phase 0.1 — CRM foundation (additive, reversible). Idempotent.
-- Already applied to remote via MCP as `crm_phase0_foundation`; committed here as source of truth.

-- leads: scoring + stage lifecycle + deal fields
alter table public.leads add column if not exists score_fit int not null default 0;
alter table public.leads add column if not exists score_engagement int not null default 0;
alter table public.leads add column if not exists grade text;
alter table public.leads add column if not exists stage_since date;
alter table public.leads add column if not exists lost_reason text;
alter table public.leads add column if not exists expected_value numeric;
alter table public.leads add column if not exists close_date date;
alter table public.leads add column if not exists last_activity_at timestamptz;

-- activities: richer conversation model
alter table public.activities add column if not exists direction text;   -- 'in' | 'out'
alter table public.activities add column if not exists due_date date;     -- for Task type
alter table public.activities add column if not exists done boolean not null default false;
alter table public.activities add column if not exists author text;       -- who logged it

-- stage_history: source of truth for velocity/funnel/time-in-stage
create table if not exists public.stage_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  note text,
  changed_by text,
  changed_at timestamptz not null default now()
);
create index if not exists stage_history_lead_idx on public.stage_history(lead_id, changed_at desc);

-- lost_reasons lookup
create table if not exists public.lost_reasons (
  reason text primary key,
  sort int not null default 0
);
insert into public.lost_reasons(reason, sort) values
  ('Price',10),('Timing',20),('No budget',30),('Went silent',40),
  ('Competitor',50),('Not a fit',60),('No response',70)
on conflict (reason) do nothing;

-- per-owner monthly targets
alter table public.monthly_targets add column if not exists owner text;

-- saved views (Phase 6)
create table if not exists public.saved_views (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  entity text not null default 'leads',
  filter jsonb not null default '{}'::jsonb,
  owner text,
  created_at timestamptz not null default now()
);

-- RLS parity with existing tables (authenticated full access)
alter table public.stage_history enable row level security;
alter table public.lost_reasons enable row level security;
alter table public.saved_views enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='stage_history' and policyname='auth full access stage_history') then
    create policy "auth full access stage_history" on public.stage_history for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='lost_reasons' and policyname='auth full access lost_reasons') then
    create policy "auth full access lost_reasons" on public.lost_reasons for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='saved_views' and policyname='auth full access saved_views') then
    create policy "auth full access saved_views" on public.saved_views for all to authenticated using (true) with check (true);
  end if;
end $$;
