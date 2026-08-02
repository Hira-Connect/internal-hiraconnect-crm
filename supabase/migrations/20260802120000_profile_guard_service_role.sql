-- The privilege guard on `profiles` reverts role / team_id / is_active unless the
-- caller is an admin *profile*. The service-role key has no profile, so
-- crm_is_admin() is false for it and the guard silently undid its writes —
-- no error, no change. That made `npm run setup:user -- --role admin` a no-op on
-- an account that already had a profile row, which is exactly when you reach for
-- it (locked-out admin, wrong role).
--
-- service_role already bypasses RLS entirely, so letting it through the guard
-- widens nothing; it only stops a privileged write failing silently.

create or replace function public.crm_guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.role() reads the JWT claim, so it still says 'service_role' inside a
  -- security-definer function (current_user would report the function owner).
  if auth.role() = 'service_role' or public.crm_is_admin() then
    return new;
  end if;

  new.role      := old.role;
  new.team_id   := old.team_id;
  new.is_active := old.is_active;
  new.id        := old.id;
  return new;
end $$;
