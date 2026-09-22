-- ATLITOS v2 - 0128_admin_email_allowlist.sql
--
-- Staff sign in with Google, and the ones on this list get the admin role the
-- moment their account is created.
--
-- WHY A LIST AND NOT A DOMAIN RULE. `docs/phases/OAUTH-GOOGLE-APPLE-SPEC.md`
-- deliberately kept admin on email and password, because a third party
-- identity provider in the staff login path is a wider door than a password
-- this project controls. The founder reversed that on 2026-09-22 so the team
-- can sign in with their work Google accounts. The door is narrowed back by
-- naming every address that may hold the role: anyone at all may sign in to
-- the project with Google, as they already could through the mobile app, but
-- only an address on this list is ever granted `admin`, and everyone else
-- lands on the admin portal's existing "This account does not have admin
-- access." refusal.
--
-- A domain rule (`anything @atlitos.com`) was considered and rejected: it
-- silently promotes every future mailbox on the domain, including an intern's
-- and a shared alias, and nothing in the database would record who intended
-- it.
--
-- WHEN IT FIRES. On insert AND on update, granting only once the address is
-- CONFIRMED. Insert alone does not work: GoTrue writes the row first and
-- confirms the address in a second statement, so at insert time
-- `email_confirmed_at` is still null and an insert only trigger granted
-- nothing at all. Proven by `scripts/verify-admin-allowlist.mjs`, which
-- failed exactly that way before this was corrected.
--
-- Requiring confirmation is the part that matters. Without it, anyone could
-- sign up with `amaeya@atlitos.com` and a password of their choosing and be
-- handed the admin role without ever proving they hold the mailbox. With it,
-- the grant needs control of the address, which is the same thing the
-- allowlist is asserting. The update path inherits the same rule: changing an
-- account's email to an allowlisted one only grants after Supabase has
-- confirmed the new address.

create table if not exists public.admin_email_allowlist (
  email text primary key,
  note text,
  added_at timestamptz not null default now(),
  constraint admin_email_allowlist_email_lowercase check (email = lower(email)),
  constraint admin_email_allowlist_email_shape check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

comment on table public.admin_email_allowlist is
  'Email addresses that receive the admin role automatically when their auth account is first created (0128). Service role write only: no client, admin JWT included, has any grant on this table, because a table that can promote its own writer is not a control.';

alter table public.admin_email_allowlist enable row level security;

-- No policy is created on purpose. RLS with zero policies denies every
-- authenticated and anon request, and the grants below deny it a second time.
-- The service role bypasses RLS, which is the only way a row gets in.
revoke all on public.admin_email_allowlist from anon, authenticated;

-- And the one role that may write it, explicitly. RLS without a grant is
-- inert (CLAUDE.md), and so is the reverse: the revoke above left the service
-- role holding only TRUNCATE/REFERENCES/TRIGGER, so the seeder and the verify
-- script were both denied until this line existed. The trigger function does
-- not depend on it, being security definer.
grant select, insert, update, delete on public.admin_email_allowlist to service_role;

-- ---------------------------------------------------------------------------
-- The grant itself
-- ---------------------------------------------------------------------------
create or replace function public.grant_admin_if_allowlisted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- `new.email` is null for a phone only signup, and lower() of null is null,
  -- which matches nothing. An unconfirmed email is not trusted: Google always
  -- returns a confirmed address, so requiring it costs nothing here and
  -- closes the email-and-password signup path to the same list.
  if new.email is null or new.email_confirmed_at is null then
    return new;
  end if;

  if exists (select 1 from public.admin_email_allowlist a where a.email = lower(new.email)) then
    insert into public.user_roles (user_id, role)
    values (new.id, 'admin')
    on conflict (user_id, role) do nothing;
  end if;

  return new;
end;
$$;

comment on function public.grant_admin_if_allowlisted() is
  'Grants admin to a newly created auth user whose confirmed email is on admin_email_allowlist (0128). INSERT only, deliberately: see the migration header.';

-- Runs after handle_new_user, which creates the public.users row and the
-- default player role. Trigger order within the same timing is alphabetical
-- by name in Postgres, and "on_auth_user_created" sorts before
-- "on_auth_user_created_grant_admin", so the users row always exists first.
-- On the update pass that confirms the address, handle_new_user has long
-- since run.
drop trigger if exists on_auth_user_created_grant_admin on auth.users;
create trigger on_auth_user_created_grant_admin
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function public.grant_admin_if_allowlisted();

-- ---------------------------------------------------------------------------
-- The people, and the backfill for anyone who already has an account
-- ---------------------------------------------------------------------------
insert into public.admin_email_allowlist (email, note) values
  ('amaeya@atlitos.com',  'Team, added 2026-09-22 at the founder''s request'),
  ('prasanth@atlitos.com','Team, added 2026-09-22 at the founder''s request'),
  ('debora@atlitos.com',  'Team, added 2026-09-22 at the founder''s request')
on conflict (email) do nothing;

-- An allowlisted address that already signed up before this migration would
-- otherwise never be granted, because the trigger only fires on insert.
insert into public.user_roles (user_id, role)
select u.id, 'admin'
from auth.users u
join public.admin_email_allowlist a on a.email = lower(u.email)
where u.email_confirmed_at is not null
on conflict (user_id, role) do nothing;
