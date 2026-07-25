-- ATLITOS v2 — 0080_group_management_rpcs.sql
-- Domain: coaching groups. Companion to 0076/0079.
--
-- 0076 grants clients ZERO write verbs on training_groups (RPC-only writes,
-- the brief's rule), and 0079 shipped the fare/attendance RPCs, which left
-- no path for a coach to CREATE or edit a group at all. These two RPCs are
-- that path. They are client callable because a group row itself moves no
-- money: monthly_fee here is a list price, and every charge derived from it
-- is re-validated server side at join/renew time (join-group edge fn +
-- join_training_group RPC), so a coach editing their own fee is the same
-- trust level as a coach editing session_types.price, which is a plain
-- client write today.
--
-- Deliberately NOT provided: delete. A group is deactivated (active =
-- false), never deleted, so membership and ledger history stay intact.
-- Deactivation does not touch existing memberships: the founder model has
-- no pro-rata refunds, so paid periods run out naturally; the group simply
-- stops accepting joins and renewals (0079 gates both on active).

create or replace function public.create_training_group(
  p_name text,
  p_sport public.sport,
  p_capacity int,
  p_monthly_fee numeric,
  p_skill_level text default null,
  p_attendance_policy text default null
)
returns public.training_groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.training_groups;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;
  if not public.has_role('coach') then
    raise exception 'FORBIDDEN: only a coach can create a training group';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'VALIDATION: a group name is required';
  end if;
  if p_capacity is null or p_capacity <= 0 then
    raise exception 'VALIDATION: capacity must be greater than zero';
  end if;
  if p_monthly_fee is null or p_monthly_fee < 0 then
    raise exception 'VALIDATION: monthly fee cannot be negative';
  end if;

  insert into public.training_groups (
    coach_id, name, sport, skill_level, capacity, monthly_fee, attendance_policy
  )
  values (
    auth.uid(), btrim(p_name), p_sport,
    nullif(btrim(coalesce(p_skill_level, '')), ''),
    p_capacity, round(p_monthly_fee, 2),
    nullif(btrim(coalesce(p_attendance_policy, '')), '')
  )
  returning * into v_group;

  return v_group;
end;
$$;

revoke all on function public.create_training_group(text, public.sport, int, numeric, text, text) from public;
revoke execute on function public.create_training_group(text, public.sport, int, numeric, text, text) from anon;
grant execute on function public.create_training_group(text, public.sport, int, numeric, text, text) to authenticated;

-- Edit own group. Null arguments mean "leave unchanged". Capacity may not
-- drop below the current live (non-lapsed) membership count: seats already
-- sold stay sold (no pro-rata refunds), so shrinking under them would make
-- the capacity guard's arithmetic lie.
create or replace function public.update_training_group(
  p_group_id uuid,
  p_name text default null,
  p_skill_level text default null,
  p_capacity int default null,
  p_monthly_fee numeric default null,
  p_attendance_policy text default null,
  p_active boolean default null
)
returns public.training_groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.training_groups;
  v_live_count int;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  select * into v_group from public.training_groups
  where id = p_group_id
  for update;

  if v_group.id is null then
    raise exception 'NOT_FOUND: training group % does not exist', p_group_id;
  end if;
  if v_group.coach_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the group coach can edit this group';
  end if;

  if p_capacity is not null then
    if p_capacity <= 0 then
      raise exception 'VALIDATION: capacity must be greater than zero';
    end if;
    select count(*) into v_live_count
    from public.group_memberships m
    where m.group_id = p_group_id and m.status <> 'lapsed';
    if p_capacity < v_live_count then
      raise exception 'VALIDATION: capacity cannot drop below the current member count of %', v_live_count;
    end if;
  end if;

  if p_monthly_fee is not null and p_monthly_fee < 0 then
    raise exception 'VALIDATION: monthly fee cannot be negative';
  end if;
  if p_name is not null and btrim(p_name) = '' then
    raise exception 'VALIDATION: a group name is required';
  end if;

  update public.training_groups
  set name = coalesce(btrim(p_name), name),
      skill_level = coalesce(nullif(btrim(coalesce(p_skill_level, '')), ''), skill_level),
      capacity = coalesce(p_capacity, capacity),
      monthly_fee = coalesce(round(p_monthly_fee, 2), monthly_fee),
      attendance_policy = coalesce(nullif(btrim(coalesce(p_attendance_policy, '')), ''), attendance_policy),
      active = coalesce(p_active, active)
  where id = p_group_id
  returning * into v_group;

  return v_group;
end;
$$;

revoke all on function public.update_training_group(uuid, text, text, int, numeric, text, boolean) from public;
revoke execute on function public.update_training_group(uuid, text, text, int, numeric, text, boolean) from anon;
grant execute on function public.update_training_group(uuid, text, text, int, numeric, text, boolean) to authenticated;
