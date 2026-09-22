-- ATLITOS v2 - 0129_admin_allowlist_current_addresses.sql
--
-- The addresses the team actually signs in with today, added to the allowlist
-- 0128 created. The @atlitos.com addresses seeded there stay: they are where
-- the team is going, and an address on the list with no account is inert
-- until someone signs up with it.
--
-- Founder's request, 2026-09-22: "Add their current emails with my email
-- abishaigosula@gmail.com as admins."
--
-- WHO, AND HOW EACH WAS IDENTIFIED. Guessing an address here grants a real
-- person real access, so each row is the one whose profile name matches the
-- person, not merely a similar looking address:
--
--   abishaigosula@gmail.com  the founder, named in the request itself.
--   deboradandu@gmail.com    profile name "Debora". A second account,
--                            deboradandu1@gmail.com, was created the same day
--                            with the profile name "deboradandu1" and is left
--                            off deliberately: it reads as a throwaway, and
--                            the cost of being wrong is an admin grant.
--   prashanthuu24@gmail.com  profile name "Mulinti prasanth reddy", and
--                            already holds admin from before this list
--                            existed. Listed anyway so the list is the whole
--                            truth about who may hold the role rather than a
--                            partial record. Two other prasanth shaped
--                            addresses exist (prasanth@gmail.com,
--                            prasanthhh@gmail.com, the latter with the
--                            profile name "Abishai"); both look like test
--                            accounts and neither is listed.
--
-- Amaeya has no account under any spelling checked (amaeya, ameya), so there
-- is nothing to grant. amaeya@atlitos.com from 0128 covers her the moment she
-- signs in with it.

insert into public.admin_email_allowlist (email, note) values
  ('abishaigosula@gmail.com',  'Founder, current address, added 2026-09-22'),
  ('deboradandu@gmail.com',    'Debora, current address, added 2026-09-22'),
  ('prashanthuu24@gmail.com',  'Prasanth, current address, already held admin before the allowlist existed')
on conflict (email) do nothing;

-- 0128's backfill ran against 0128's rows only, so these three need their own.
-- The trigger covers anyone who signs up later.
insert into public.user_roles (user_id, role)
select u.id, 'admin'
from auth.users u
join public.admin_email_allowlist a on a.email = lower(u.email)
where u.email_confirmed_at is not null
on conflict (user_id, role) do nothing;
