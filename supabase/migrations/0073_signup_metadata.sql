-- 0073: handle_new_user copies phone and dob from signup metadata.
--
-- Track D defect 1: `register()` (packages/api/src/hooks.ts) passes name,
-- phone and dob in `signUp` options.data (raw_user_meta_data), but when the
-- project requires email confirmation, signUp returns NO session, so the
-- client-side follow-up `update users set phone/dob` could never run and the
-- two fields were silently lost. The trigger is the only code that always
-- runs at signup time, so it now copies both fields itself; the client
-- post-session update stays as a best-effort fallback for environments where
-- this migration has not been applied yet.
--
-- Carries forward 0008's anonymous-user handling (guests get a name fallback
-- and zero user_roles rows) and 0064's pinned search_path. `create or
-- replace` preserves 0005's revoked execute grants.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_dob date;
begin
  v_phone := nullif(trim(new.raw_user_meta_data ->> 'phone'), '');

  -- Malformed metadata must never abort account creation; a bad date string
  -- simply leaves dob null (the client fallback or profile edit repairs it).
  begin
    v_dob := nullif(trim(new.raw_user_meta_data ->> 'dob'), '')::date;
  exception when others then
    v_dob := null;
  end;

  -- users.phone is unique. A duplicate phone must not abort signup either
  -- (the account is keyed by email); drop the phone and let the client
  -- surface PHONE_TAKEN through its own validation instead.
  if v_phone is not null and exists (select 1 from public.users u where u.phone = v_phone) then
    v_phone := null;
  end if;

  insert into public.users (id, name, phone, dob)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1),
      'Guest'
    ),
    v_phone,
    v_dob
  );

  -- Guests (anonymous auth users) carry no roles; roles arrive at role-select
  -- (player) or coach onboarding (coach) via the setup RPCs.
  if not coalesce(new.is_anonymous, false) then
    insert into public.user_roles (user_id, role)
    values (new.id, 'player');
  end if;

  return new;
end;
$$;
