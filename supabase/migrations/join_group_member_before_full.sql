-- BUG-015 (Phase 10): already-a-member check must precede the capacity
-- (GROUP_FULL) check in join_training_group. Additive, ordering-only fix; no
-- money/fare/ledger/capacity logic changed. See 0088_join_group_member_before_full.sql.
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
  -- ALREADY_MEMBER regardless of whether the group is full. Mirrors the
  -- group_memberships_one_live_per_player unique index predicate.
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

  -- Capacity, counted under the lock.
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
      raise exception 'ALREADY_MEMBER: player % already has a live membership in group %', p_actor_id, p_group_id;
  end;

  return v_membership;
end;
$$;

revoke all on function public.join_training_group(uuid, uuid) from public;
revoke execute on function public.join_training_group(uuid, uuid) from anon, authenticated;
grant execute on function public.join_training_group(uuid, uuid) to service_role;
