-- v2.0 — bootstrap guard for the very first account.
--
-- 20260729120100_v2_backfill.sql makes every user that ALREADY existed an admin.
-- It cannot help an account created afterwards: handle_new_user() assigns 'rep',
-- and a rep has no route to the Team screen to promote themselves. On a project
-- where the migrations run before anyone signs up, that is a locked door.
--
-- Fix: the first account created while no active admin exists becomes the admin.
-- Once one exists, everyone else is a rep as before — this opens no ongoing hole.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  active_admins int;
begin
  select count(*) into active_admins
  from public.profiles
  where role = 'admin' and is_active;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email,''), '@', 1)),
    case when active_admins = 0 then 'admin' else 'rep' end
  )
  on conflict (id) do nothing;

  return new;
end $$;

-- Safety net for a database that already has users but somehow no admin
-- (e.g. the only admin was deactivated). Promotes the oldest active account.
do $$
begin
  if not exists (select 1 from public.profiles where role = 'admin' and is_active) then
    update public.profiles
    set role = 'admin'
    where id = (select id from public.profiles where is_active order by created_at limit 1);
  end if;
end $$;
