-- Bulk lead upload — audit + resume state for Excel imports.
--
-- Two tables, both additive and idempotent:
--   lead_import_batches  one row per uploaded file: counters, status, first failure
--   lead_import_rows     one row per Excel data row: sanitized payload, outcome, error
--
-- The uploaded file itself is never stored. Every row's sanitized cell values live in
-- `payload`, which is what makes resume, retry and the error report work without any
-- file storage (and without an internal storage URL to leak).
--
-- `row_key` is the normalized business key for the row (lead id, else email, else
-- name+company+phone). It is what makes re-uploading the same file idempotent:
-- a key that already produced a lead is skipped instead of inserted again.

-- =========================================================================
-- 1. Batches
-- =========================================================================
create table if not exists public.lead_import_batches (
  id               uuid primary key default gen_random_uuid(),
  created_by       uuid references public.profiles(id) on delete set null,
  file_name        text not null,
  file_size        bigint not null default 0,
  -- sha-256 of the uploaded bytes; identifies an accidental re-upload
  file_hash        text not null default '',
  total_rows       int not null default 0,   -- data rows found in the sheet
  valid_rows       int not null default 0,   -- rows that passed validation
  processed_count  int not null default 0,   -- rows whose outcome is final
  created_count    int not null default 0,
  updated_count    int not null default 0,
  skipped_count    int not null default 0,   -- duplicates / already imported / no change
  invalid_count    int not null default 0,   -- rejected by validation, never attempted
  failed_count     int not null default 0,   -- attempted and errored
  -- pending | validating | processing | completed | partially_completed | failed | cancelled
  status           text not null default 'pending',
  error            text,
  first_failed_row int,
  last_success_row int,
  duration_ms      int,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  completed_at     timestamptz
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lead_import_batches_status_chk') then
    alter table public.lead_import_batches
      add constraint lead_import_batches_status_chk check (status in (
        'pending','validating','processing','completed','partially_completed','failed','cancelled'
      ));
  end if;
end $$;

create index if not exists lead_import_batches_creator_idx on public.lead_import_batches(created_by, created_at desc);
create index if not exists lead_import_batches_hash_idx    on public.lead_import_batches(file_hash);

-- =========================================================================
-- 2. Rows
-- =========================================================================
create table if not exists public.lead_import_rows (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references public.lead_import_batches(id) on delete cascade,
  -- denormalised so RLS and the idempotency lookup stay single-table
  created_by   uuid references public.profiles(id) on delete set null,
  row_number   int not null,              -- the row number as shown in Excel (header is row 1)
  row_key      text,                      -- normalized business key, null when the row is unusable
  payload      jsonb not null default '{}'::jsonb,
  identifier   text,                      -- email or name — what the error report shows
  -- pending | processing | created | updated | skipped | invalid | failed
  status       text not null default 'pending',
  action       text,                      -- planned outcome from validation: create | update | skip
  lead_id      uuid references public.leads(id) on delete set null,
  error        text,
  error_field  text,
  hint         text,
  -- when a chunk took ownership of the row; a claim older than a few minutes
  -- belongs to a request that died and is handed back to the next chunk
  claimed_at   timestamptz,
  processed_at timestamptz,
  created_at   timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lead_import_rows_status_chk') then
    alter table public.lead_import_rows
      add constraint lead_import_rows_status_chk check (status in (
        'pending','processing','created','updated','skipped','invalid','failed'
      ));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lead_import_rows_batch_row_uniq') then
    alter table public.lead_import_rows
      add constraint lead_import_rows_batch_row_uniq unique (batch_id, row_number);
  end if;
end $$;

create index if not exists lead_import_rows_batch_idx  on public.lead_import_rows(batch_id, row_number);
create index if not exists lead_import_rows_status_idx on public.lead_import_rows(batch_id, status);
-- the idempotency probe: "did this business key already produce a lead for me?"
create index if not exists lead_import_rows_key_idx
  on public.lead_import_rows(created_by, row_key)
  where lead_id is not null;

-- =========================================================================
-- 3. RLS — you see your own imports; managers and admins see the team's.
--    Only the uploader (or an admin) may drive a batch forward.
-- =========================================================================
alter table public.lead_import_batches enable row level security;
alter table public.lead_import_rows    enable row level security;

do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename in ('lead_import_batches','lead_import_rows')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy lead_import_batches_select on public.lead_import_batches for select to authenticated
  using (created_by = auth.uid() or public.crm_is_manager_up());
create policy lead_import_batches_insert on public.lead_import_batches for insert to authenticated
  with check (created_by = auth.uid() and public.crm_role() <> 'none');
create policy lead_import_batches_update on public.lead_import_batches for update to authenticated
  using (created_by = auth.uid() or public.crm_is_admin())
  with check (created_by = auth.uid() or public.crm_is_admin());
create policy lead_import_batches_delete on public.lead_import_batches for delete to authenticated
  using (created_by = auth.uid() or public.crm_is_admin());

create policy lead_import_rows_select on public.lead_import_rows for select to authenticated
  using (created_by = auth.uid() or public.crm_is_manager_up());
create policy lead_import_rows_insert on public.lead_import_rows for insert to authenticated
  with check (created_by = auth.uid() and public.crm_role() <> 'none');
create policy lead_import_rows_update on public.lead_import_rows for update to authenticated
  using (created_by = auth.uid() or public.crm_is_admin())
  with check (created_by = auth.uid() or public.crm_is_admin());
create policy lead_import_rows_delete on public.lead_import_rows for delete to authenticated
  using (created_by = auth.uid() or public.crm_is_admin());
