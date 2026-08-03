-- ATLITOS v2 — 0088_join_group_member_before_full.sql
-- BUG-015 (Phase 10): join_training_group checked capacity (GROUP_FULL)
-- BEFORE the already-a-member case. An existing live member of a FULL group
-- who re-triggered join was wrongly told GROUP_FULL, because the only
-- already-member signal was the group_memberships_one_live_per_player unique
-- index (0076) which is hit at INSERT time, AFTER the capacity guard raised.
--
-- Fix (additive, ordering only): add an explicit non-lapsed membership check
-- that runs BEFORE the capacity count, so a re-joining member always gets
-- ALREADY_MEMBER (a well-formed 409, mapped in _shared/app-error.ts) rather
-- than GROUP_FULL. A genuine new joiner of a full group is unaffected: they
-- have no live membership row, fall through the new guard, and still hit the
-- GROUP_FULL capacity check exactly as before.
--
-- Nothing else changes. This is a state-machine error-precedence fix, not a
-- money write: no fare, fee, ledger, capacity rule, or subscription logic is
-- touched (CLAUDE.md financial invariant untouched). The unique index is
-- kept as the structural backstop for the concurrent-duplicate race.

create or replace function public.join_training_group(
  p_actor_id uuid,
  p_group_id uuid
)
returns public.group_memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.training_groups;
  v_membership public.group_memberships;
  v_live_count int;
  v_fee numeric(12, 2);
begin
  if p_actor_id is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  select * into v_group from public.training_groups
  where id = p_group_id
  for update;

  if v_group.id is null then
    raise exception 'NOT_FOUND: training group % does not exist', p_group_id;
  end if;
  if not v_group.active then
    raise exception 'GROUP_INACTIVE: training group % is not accepting members', p_group_id;
  end if;
  if v_group.coach_id = p_actor_id then
    raise exception 'VALIDATION: a coach cannot join their own group';
  end if;
  if not exists (
    select 1 from public.coach_profiles cp
    where cp.user_id = v_group.coach_id and cp.status = 'verified'
  ) then
    raise exception 'NOT_FOUND: training group % is not open for joining', p_group_id;
  end if;
  if v_group.monthly_fee <= 0 then
    raise exception 'VALIDATION: this group has no monthly fee configured';
  end if;

  -- BUG-015: already-a-member takes precedence over capacity. A player who
  -- already holds a live (non-lapsed) membership in this group is told
  -- ALREADY_MEMBER regardless of whether the group is full. This mirrors the
  -- unique index predicate (status <> 'lapsed') so the guard and the index
  -- agree on what "live" means. Runs under the same group row lock taken
  -- above, so it is consistent with the capacity count below.
  if exists (
    select 1 from public.group_memberships m
    where m.group_id = p_group_id
      and m.player_id = p_actor_id
      and m.status <> 'lapsed'
  ) then
    raise exception 'ALREADY_MEMBER: player % already has a live membership in group %', p_actor_id, p_group_id;
  end if;

  -- Fare snapshot: carve-out model, same fee key sessions use (PAYMENTS.md).
  select fc.value into v_fee
  from public.fee_config fc
  where fc.domain = 'sessions'
    and fc.key = 'platform_fee_flat'
    and fc.effective_from <= now()
  order by fc.effective_from desc
  limit 1;

  if v_fee is null or v_fee >= v_group.monthly_fee then
    raise exception 'VALIDATION: platform fee is not configured below the monthly fee';
  end if;

  -- Capacity, counted under the lock. 'pending' holds a seat while its
  -- checkout lives, exactly as a requested unpaid session holds its slot;
  -- membership_abandon_unpaid releases it on a failed checkout.
  select count(*) into v_live_count
  from public.group_memberships m
  where m.group_id = p_group_id
    and m.status <> 'lapsed';

  if v_live_count >= v_group.capacity then
    raise exception 'GROUP_FULL: training group % is at capacity', p_group_id;
  end if;

  begin
    insert into public.group_memberships (
      group_id, player_id, status, price, platform_fee, total
    )
    values (
      p_group_id, p_actor_id, 'pending',
      v_group.monthly_fee, v_fee, v_group.monthly_fee
    )
    returning * into v_membership;
  exception
    when unique_violation then
      -- Structural backstop for the concurrent-duplicate race: two joins by
      -- the same player serialising on the group lock. Same error the
      -- explicit guard above raises.
      raise exception 'ALREADY_MEMBER: player % already has a live membership in group %', p_actor_id, p_group_id;
  end;

  return v_membership;
end;
$$;

revoke all on function public.join_training_group(uuid, uuid) from public;
revoke execute on function public.join_training_group(uuid, uuid) from anon, authenticated;
grant execute on function public.join_training_group(uuid, uuid) to service_role;
