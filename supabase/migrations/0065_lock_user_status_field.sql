-- 0065_lock_user_status_field.sql
-- States pass (AT-143): close the one client-writable status leak.
--
-- users.status (user_status: 'active' / 'suspended') and its paired
-- suspended_reason are a moderation state, set only by an admin. The row is
-- self-editable through the users_update_own policy (WITH CHECK id = auth.uid())
-- so a member can legitimately update their own display_name, avatar,
-- show_donor_name, etc. But that policy places no guard on the status column,
-- and authenticated/anon hold a column UPDATE grant on it, so before this
-- migration an authenticated member could run
--   update public.users set status = 'active' where id = auth.uid();
-- and lift their own suspension (proven: active -> suspended succeeded, no raise).
--
-- Every OTHER state-bearing row already blocks this: the six machine tables
-- (sessions, orders, court_bookings, clips, upa_applications,
-- upa_wishlist_items) hold no status UPDATE grant at all (direct write => 42501),
-- and coach_profiles / venues carry a FIELD_LOCKED admin-lock trigger. users is
-- the lone exception. This adds the identical guard, mirroring
-- lock_venue_admin_fields (0009), so status/suspended_reason change only via an
-- admin (has_role('admin')). No existing flow writes users.status from a client
-- context, so nothing legitimate is broken.

create or replace function public.lock_user_admin_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    new.status is distinct from old.status
    or new.suspended_reason is distinct from old.suspended_reason
  ) and not public.has_role('admin') then
    raise exception 'FIELD_LOCKED: status and suspended_reason change only via admin moderation';
  end if;
  return new;
end;
$$;

create trigger users_lock_admin_fields
  before update on public.users
  for each row execute function public.lock_user_admin_fields();
