-- ATLITOS v2 — 0112_training_group_capacity_ceiling.sql
-- Domain: coaching groups. Closes SCALE-REALTIME R-8's root cause: four
-- separate fan-outs are bounded only by a number a coach types into a form.
--
-- NOT APPLIED. Written, not run.
--
-- ============================================================================
-- WHAT IS UNBOUNDED, verified from the live catalog 2026-08-14.
-- ============================================================================
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.training_groups'::regclass;
--     -> training_groups_capacity_check  CHECK ((capacity > 0))
--
-- No upper bound. Live maximum capacity today is 8 across one group, so
-- nothing has exercised it, and four things scale directly with it:
--
--   1. create_group_session seeds one session_participants row per active
--      member;
--   2. notify_session_parties (0103) writes one notifications row per
--      participant;
--   3. the push relay (0110) sends one Expo message per device;
--   4. broadcast_chat_message (0092) is an after insert PER ROW trigger that
--      calls realtime.send once per thread member, so ONE chat message is M
--      inserts into realtime.messages, M WAL records and M websocket events,
--      inside the sender's own transaction.
--
-- The fourth is the dangerous one, because crossing the project's
-- messages-per-second ceiling does not shed the excess. Supabase's Realtime
-- limits documentation is explicit: `tenant_events` DISCONNECTS SOCKETS, and
-- it does so project wide. One coach with an oversized group can take live
-- chat and the notification stream away from every other user on the
-- platform. At the Pro ceiling of 500 messages per second, a 100-member group
-- sustaining 5 messages a second reaches it alone, and a 500-member group
-- needs only 1 message a second.
--
-- ============================================================================
-- THE NUMBER: 100. Where it comes from.
-- ============================================================================
--
-- Not arbitrary, and deliberately not generous:
--
--   * Expo's request limit is 100 messages. A group at the ceiling with one
--     device each is exactly ONE Expo request, so the whole roster is
--     notified in a single round trip.
--   * 100 members x 1 message per second is 100 realtime events per second,
--     20% of the 500/s Pro ceiling, so a single group cannot take the project
--     down on its own even at implausible chat volume.
--   * The synchronous cost inside the sender's transaction is roughly 0.15 ms
--     per member on this instance, so a send at the ceiling pays about 15 ms,
--     which is not felt.
--   * Product: the largest real coaching group in this product is a squad,
--     and the live maximum is 8. A coach who genuinely needs more than 100 is
--     running something this product does not model yet, and should hear that
--     rather than silently take the platform's realtime budget.
--
-- If the product later wants a larger number, raise it here, in one place,
-- having re-derived the arithmetic above. The point of this migration is that
-- there IS a place.
--
-- ============================================================================
-- 1. The constraint.
-- ============================================================================
--
-- `not valid` then `validate` so the ALTER does not take a full-table lock
-- while it scans: existing rows (one group, capacity 8) are checked in a
-- second pass under a weaker lock. All new and updated rows are enforced
-- immediately either way.

alter table public.training_groups
  drop constraint if exists training_groups_capacity_max;

alter table public.training_groups
  add constraint training_groups_capacity_max check (capacity <= 100) not valid;

alter table public.training_groups
  validate constraint training_groups_capacity_max;

comment on constraint training_groups_capacity_max on public.training_groups is
  'R-8. Upper bound on group size. Chat broadcast, session notification and push fan-out are all linear in this number, and crossing the project realtime message ceiling disconnects sockets project wide rather than dropping the excess.';

-- ============================================================================
-- 2. The RPCs, so a coach gets a sentence instead of a constraint violation.
-- ============================================================================
--
-- 0080's bodies VERBATIM, plus one guard each. Diff this against 0080 and the
-- only additions are the two `p_capacity > 100` branches and this header. The
-- constraint above is the real enforcement; these exist so the error the user
-- sees is a product message, not `new row for relation "training_groups"
-- violates check constraint "training_groups_capacity_max"`.

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
  if p_capacity > 100 then
    raise exception 'VALIDATION: capacity cannot be above 100';
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
    if p_capacity > 100 then
      raise exception 'VALIDATION: capacity cannot be above 100';
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
