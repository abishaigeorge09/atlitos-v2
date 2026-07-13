-- 0008: handle_new_user must tolerate anonymous auth users (guest mode).
-- Bug found in P1 gate verification: anonymous users have no email, so
-- split_part(new.email, '@', 1) yielded NULL for users.name (NOT NULL), and
-- every new auth user was granted the player role, violating RLS.md's
-- "guest = anonymous session with ZERO user_roles rows".

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1),
      'Guest'
    )
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
