-- Phase 0.2 — backfill lifecycle fields for existing leads (idempotent, data-only).
-- Already applied to remote; committed here for reproducibility on a fresh restore.

update public.leads set stage_since = created_at::date where stage_since is null;

update public.leads l set last_activity_at = sub.mx
from (select lead_id, max(created_at) mx from public.activities group by lead_id) sub
where sub.lead_id = l.id and l.last_activity_at is null;
update public.leads set last_activity_at = created_at where last_activity_at is null;

-- seed one stage_history row per lead at its current stage (only where none exist)
insert into public.stage_history(lead_id, from_stage, to_stage, note, changed_by, changed_at)
select l.id, null, l.status, 'Backfilled at plan start', 'system', l.created_at
from public.leads l
where not exists (select 1 from public.stage_history sh where sh.lead_id = l.id);
