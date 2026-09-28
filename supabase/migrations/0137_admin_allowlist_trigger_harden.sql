-- ATLITOS v2 - 0137_admin_allowlist_trigger_harden.sql
--
-- Closes the admin takeover hole in 0128.
--
-- THE HOLE. 0128 granted admin to any auth user whose CONFIRMED email is on
-- admin_email_allowlist, on insert and on update of email or
-- email_confirmed_at. Production auto confirms email and password signups, so
-- "confirmed" proves nothing there: a stranger who registers an allowlisted
-- address that has no account yet, with a password of their choosing, is
-- confirmed on the spot and handed admin, with access to bank details and
-- payouts. The update path was a second door: an existing user whose email is
-- changed to an allowlisted one was granted too.
--
-- THE FIX. Admin is granted only when BOTH hold:
--
--   1. The account was created through Google sign in. The admin app signs
--      staff in with Google, and Google only returns an address whose mailbox
--      the person controls. The provider is read from raw_app_meta_data, which
--      GoTrue writes at signup and no client can change (unlike
--      raw_user_meta_data). An email and password signup has provider "email"
--      and is never granted, confirmed or not.
--
--   2. This is the account's FIRST confirmation: either the row is inserted
--      already confirmed, or email_confirmed_at goes from null to a value.
--      A later change of email never grants, so the email change path is
--      closed. The trigger no longer watches the email column at all.
--
-- WHY NOT STRICTLY "ON INSERT ONLY". The runbook asked for insert only. 0128's
-- header records that GoTrue inserts the row with email_confirmed_at null and
-- confirms it in a second statement, and an insert only trigger granted
-- nothing (proven by scripts/verify-admin-allowlist.mjs). So the trigger fires
-- on insert, and on update of email_confirmed_at only for the null to value
-- transition that belongs to that same signup. It no longer fires on update of
-- email, which was the part that made it dangerous.
--
-- KNOWN LIMIT. A staff member who first signed up with email and password and
-- later links Google keeps provider "email" and is not granted automatically.
-- Do NOT simply grant that account by hand: it has exactly the shape of the
-- pre claim attack (a stranger registers the address with a password, the real
-- staff member's Google login then links into that account, and the stranger
-- still knows the password). Before any manual grant, confirm the account has
-- no identity with provider 'email' in auth.identities, or delete the account
-- and have the staff member sign up again with Google.
--
-- Also fixes the comment on the function, which said "INSERT only" while the
-- trigger fired on update too.
--
-- Existing admin rows are not touched. Stage 1.1 and 1.2 of the launch
-- runbook (founder, SQL editor) remove or claim the unclaimed addresses, and
-- audit every current admin, because a grant made under 0128 before this
-- migration survives it:
--   select u.email, u.raw_app_meta_data->>'provider', u.created_at
--     from public.user_roles r join auth.users u on u.id = r.user_id
--    where r.role = 'admin';
-- Revoke any row that is not a known person, or whose provider is not google.

create or replace function public.grant_admin_if_allowlisted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Phone only signups have no email, and an unconfirmed address is not trusted.
  if new.email is null or new.email_confirmed_at is null then
    return new;
  end if;

  -- On update, only the first confirmation counts. Anything else (a later
  -- email change, a re-confirmation) is not a signup and never grants.
  if tg_op = 'UPDATE' and old.email_confirmed_at is not null then
    return new;
  end if;

  -- Only Google sign in proves control of the mailbox in this project,
  -- because production auto confirms email and password signups.
  if coalesce(new.raw_app_meta_data->>'provider', '') <> 'google' then
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
  'Grants admin to a new auth user whose email is on admin_email_allowlist, only when the account was created through Google sign in (raw_app_meta_data provider = google) and only on its first confirmation: on insert, or on the null to value update of email_confirmed_at. Never on an email change. 0137 hardened 0128.';

drop trigger if exists on_auth_user_created_grant_admin on auth.users;
create trigger on_auth_user_created_grant_admin
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.grant_admin_if_allowlisted();
