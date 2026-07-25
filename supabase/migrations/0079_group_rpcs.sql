-- ATLITOS v2 — 0079_group_rpcs.sql
-- Domain: coaching groups, fares. The write layer for 0076's tables.
-- Founder-ratified fares model: monthly subscription per group, manual
-- renewal v1 through the existing one-time payment rails, no autopay,
-- no-show has no money effect, no pro-rata refunds, capacity guarded in the
-- join RPC.
--
-- Every function here is SECURITY DEFINER; 0076 grants clients zero write
-- verbs on any group table, so these plus the join-group /
-- renew-group-membership / finalize edge functions are the only writers.
--
-- The money choreography, mirroring book-session -> finalize exactly:
--
--   join-group (edge fn) --> join_training_group (here, service_role only,
--     capacity guarded under the group row lock, inserts the membership as
--     'pending' with the fare snapshot) --> payment_intents (domain
--     'membership', entity_id = membership id) --> Razorpay order -->
--     client pays --> razorpay-webhook / verify-payment -->
--     finalizePaymentCaptured --> finalize-membership-payment.ts -->
--     activate_group_membership_paid (here) + the balanced carve-out ledger
--     group (debit platform total, credit coach total - fee, credit
--     platform fee), written by the edge function under service_role,
--     never here (CLAUDE.md: ledger writes only in edge functions).
--
--   Renewal is the same rails with the SAME membership row:
--   renew-group-membership (edge fn) --> renew_group_membership (here,
--   re-snapshots the fare at today's monthly_fee + fee_config) --> new
--   intent --> capture --> activate_group_membership_paid extends the
--   period. A lapsed member does not renew; they re-join (new row, capacity
--   re-checked, since their seat was already released).
--
-- Error vocabulary (extending the established set): GROUP_FULL,
-- ALREADY_MEMBER, GROUP_INACTIVE, NOT_A_MEMBER, plus the existing
-- UNAUTHENTICATED / NOT_FOUND / FORBIDDEN / INVALID_TRANSITION / VALIDATION
-- / SLOT_TAKEN.

-- ============================================================================
-- join_training_group. service_role only (called by the join-group edge
-- function with the GoTrue-verified actor, the 0027 p_actor_id pattern).
-- The FOR UPDATE lock on the group row is the capacity guard: two
-- concurrent joins serialize on it, the loser recounts and sees the full
-- group. The partial unique index (0076) independently kills duplicates.
-- ============================================================================

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
      raise exception 'ALREADY_MEMBER: player % already has a live membership in group %', p_actor_id, p_group_id;
  end;

  return v_membership;
end;
$$;

revoke all on function public.join_training_group(uuid, uuid) from public;
revoke execute on function public.join_training_group(uuid, uuid) from anon, authenticated;
grant execute on function public.join_training_group(uuid, uuid) to service_role;

-- ============================================================================
-- membership_abandon_unpaid: the session_abandon_unpaid analog. Releases a
-- 'pending' seat whose checkout failed, refusing if the money actually
-- moved. service_role only; called by the join-group edge function.
-- ============================================================================

create or replace function public.membership_abandon_unpaid(
  p_membership_id uuid
)
returns public.group_memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership public.group_memberships;
  v_captured int;
begin
  select * into v_membership from public.group_memberships
  where id = p_membership_id
  for update;

  if v_membership.id is null then
    raise exception 'NOT_FOUND: membership % does not exist', p_membership_id;
  end if;
  if v_membership.status <> 'pending' then
    raise exception 'INVALID_TRANSITION: membership % is not pending', p_membership_id;
  end if;

  select count(*) into v_captured
  from public.payment_intents pi
  where pi.entity_id = p_membership_id
    and pi.domain = 'membership'
    and pi.status = 'captured';

  if v_captured > 0 then
    raise exception 'INVALID_TRANSITION: membership % has a captured payment', p_membership_id;
  end if;

  update public.group_memberships
  set status = 'lapsed'
  where id = p_membership_id
  returning * into v_membership;

  return v_membership;
end;
$$;

revoke all on function public.membership_abandon_unpaid(uuid) from public;
revoke execute on function public.membership_abandon_unpaid(uuid) from anon, authenticated;
grant execute on function public.membership_abandon_unpaid(uuid) to service_role;

-- ============================================================================
-- activate_group_membership_paid: the one status writer on the capture
-- path. service_role only; called by finalize-membership-payment.ts exactly
-- once per captured charge (the finalize gate's status='created' UPDATE is
-- the idempotency).
--
--   pending -> active           first month: today .. today + 1 month
--   active  -> active           renewal: period_end extends by 1 month from
--                               max(period_end, today), so renewing early
--                               loses no days and renewing late does not
--                               backdate the new month
--   lapsed  -> active           captured money always buys the month
--                               (defensive; the normal lapsed path is a
--                               fresh join with a fresh row)
--
-- Dates are Asia/Kolkata, the codebase's single product timezone.
-- ============================================================================

create or replace function public.activate_group_membership_paid(
  p_membership_id uuid
)
returns public.group_memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership public.group_memberships;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_anchor date;
begin
  select * into v_membership from public.group_memberships
  where id = p_membership_id
  for update;

  if v_membership.id is null then
    raise exception 'NOT_FOUND: membership % does not exist', p_membership_id;
  end if;

  if v_membership.status = 'active' and v_membership.period_end is not null then
    v_anchor := greatest(v_membership.period_end, v_today);
    update public.group_memberships
    set period_end = (v_anchor + interval '1 month')::date
    where id = p_membership_id
    returning * into v_membership;
  else
    update public.group_memberships
    set status = 'active',
        period_start = v_today,
        period_end = (v_today + interval '1 month')::date
    where id = p_membership_id
    returning * into v_membership;
  end if;

  return v_membership;
end;
$$;

revoke all on function public.activate_group_membership_paid(uuid) from public;
revoke execute on function public.activate_group_membership_paid(uuid) from anon, authenticated;
grant execute on function public.activate_group_membership_paid(uuid) to service_role;

-- ============================================================================
-- renew_group_membership: validates a renewal and re-snapshots the fare at
-- today's monthly_fee + fee_config (an admin fee edit between months
-- applies to the next month, never retroactively). service_role only; the
-- renew-group-membership edge function compares the client's expected
-- total, creates the intent, and the capture path extends the period.
-- ============================================================================

create or replace function public.renew_group_membership(
  p_actor_id uuid,
  p_membership_id uuid
)
returns public.group_memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership public.group_memberships;
  v_group public.training_groups;
  v_fee numeric(12, 2);
begin
  if p_actor_id is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  select * into v_membership from public.group_memberships
  where id = p_membership_id
  for update;

  if v_membership.id is null then
    raise exception 'NOT_FOUND: membership % does not exist', p_membership_id;
  end if;
  if v_membership.player_id <> p_actor_id then
    raise exception 'FORBIDDEN: not your membership';
  end if;
  if v_membership.status <> 'active' then
    raise exception 'INVALID_TRANSITION: membership % is not active; a lapsed member joins the group again instead', p_membership_id;
  end if;

  select * into v_group from public.training_groups
  where id = v_membership.group_id;

  if not v_group.active then
    raise exception 'GROUP_INACTIVE: training group % is not accepting renewals', v_group.id;
  end if;
  if v_group.monthly_fee <= 0 then
    raise exception 'VALIDATION: this group has no monthly fee configured';
  end if;

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

  update public.group_memberships
  set price = v_group.monthly_fee,
      platform_fee = v_fee,
      total = v_group.monthly_fee
  where id = p_membership_id
  returning * into v_membership;

  return v_membership;
end;
$$;

revoke all on function public.renew_group_membership(uuid, uuid) from public;
revoke execute on function public.renew_group_membership(uuid, uuid) from anon, authenticated;
grant execute on function public.renew_group_membership(uuid, uuid) to service_role;

-- ============================================================================
-- create_group_session: the coach schedules a group session. Client
-- callable: it moves no money (group session rows are price 0, 0076 header
-- note 5), so it needs no edge-function half. Inserted directly as
-- 'accepted' (there is no requesting athlete to wait for) with participants
-- seeded from the group's ACTIVE members at scheduling time. A member who
-- joins after scheduling is not backfilled in v1; the coach reschedules or
-- the next session picks them up.
-- ============================================================================

create or replace function public.create_group_session(
  p_group_id uuid,
  p_date date,
  p_slot_start time,
  p_slot_end time,
  p_focus_area text default null,
  p_location text default null
)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.training_groups;
  v_session public.sessions;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;
  if p_date is null or p_slot_start is null or p_slot_end is null then
    raise exception 'VALIDATION: date, slot_start, and slot_end are required';
  end if;
  if p_slot_end <= p_slot_start then
    raise exception 'VALIDATION: slot_end must be after slot_start';
  end if;

  select * into v_group from public.training_groups where id = p_group_id;

  if v_group.id is null then
    raise exception 'NOT_FOUND: training group % does not exist', p_group_id;
  end if;
  if v_group.coach_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the group coach can schedule a group session';
  end if;
  if not v_group.active then
    raise exception 'GROUP_INACTIVE: training group % is not active', p_group_id;
  end if;

  begin
    insert into public.sessions (
      coach_id, player_id, session_type_id, frequency,
      date, slot_start, slot_end, focus_area, location, status,
      price, platform_fee, total, group_id
    )
    values (
      v_group.coach_id, null, null, 'one_time',
      p_date, p_slot_start, p_slot_end,
      nullif(btrim(coalesce(p_focus_area, '')), ''),
      nullif(btrim(coalesce(p_location, '')), ''),
      'accepted',
      0, 0, 0, p_group_id
    )
    returning * into v_session;
  exception
    when unique_violation then
      raise exception 'SLOT_TAKEN: coach % is already booked for % %',
        v_group.coach_id, p_date, p_slot_start;
  end;

  insert into public.session_participants (session_id, player_id)
  select v_session.id, m.player_id
  from public.group_memberships m
  where m.group_id = p_group_id
    and m.status = 'active';

  return v_session;
end;
$$;

revoke all on function public.create_group_session(uuid, date, time, time, text, text) from public;
revoke execute on function public.create_group_session(uuid, date, time, time, text, text) from anon;
grant execute on function public.create_group_session(uuid, date, time, time, text, text) to authenticated;

-- ============================================================================
-- mark_attendance: coach-only, session must be in_progress, marks must
-- target participants who are still ACTIVE members of the group. No money
-- effect whatsoever (founder: no-show has no money effect), which is why
-- this is client callable.
--
-- p_marks: jsonb object of player uuid -> 'present' | 'absent', e.g.
--   {"58756043-...": "present", "dc6b14da-...": "absent"}
-- ============================================================================

create or replace function public.mark_attendance(
  p_session_id uuid,
  p_marks jsonb
)
returns setof public.session_participants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions;
  v_player uuid;
  v_status text;
  v_pair record;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;
  if p_marks is null or jsonb_typeof(p_marks) <> 'object' or p_marks = '{}'::jsonb then
    raise exception 'VALIDATION: p_marks must be a non empty object of player id to status';
  end if;

  select * into v_session from public.sessions
  where id = p_session_id
  for update;

  if v_session.id is null then
    raise exception 'NOT_FOUND: session % does not exist', p_session_id;
  end if;
  if v_session.coach_id <> auth.uid() then
    raise exception 'FORBIDDEN: only the session coach can mark attendance';
  end if;
  if v_session.group_id is null then
    raise exception 'VALIDATION: attendance is marked on group sessions only';
  end if;
  if v_session.status <> 'in_progress' then
    raise exception 'INVALID_TRANSITION: session % is not in progress', p_session_id;
  end if;

  for v_pair in select key, value from jsonb_each_text(p_marks) loop
    begin
      v_player := v_pair.key::uuid;
    exception when invalid_text_representation then
      raise exception 'VALIDATION: % is not a player id', v_pair.key;
    end;
    v_status := v_pair.value;

    if v_status not in ('present', 'absent') then
      raise exception 'VALIDATION: attendance for % must be present or absent', v_player;
    end if;
    if not exists (
      select 1 from public.session_participants sp
      where sp.session_id = p_session_id and sp.player_id = v_player
    ) then
      raise exception 'NOT_A_MEMBER: player % is not a participant of session %', v_player, p_session_id;
    end if;
    if not exists (
      select 1 from public.group_memberships m
      where m.group_id = v_session.group_id
        and m.player_id = v_player
        and m.status = 'active'
    ) then
      raise exception 'NOT_A_MEMBER: player % is not an active member of this group', v_player;
    end if;

    update public.session_participants
    set attendance_status = v_status,
        marked_at = now()
    where session_id = p_session_id and player_id = v_player;
  end loop;

  return query
    select * from public.session_participants sp
    where sp.session_id = p_session_id
    order by sp.player_id;
end;
$$;

revoke all on function public.mark_attendance(uuid, jsonb) from public;
revoke execute on function public.mark_attendance(uuid, jsonb) from anon;
grant execute on function public.mark_attendance(uuid, jsonb) to authenticated;

-- ============================================================================
-- get_group_member_counts: discovery needs "seats taken" without exposing
-- who the members are (group_memberships has no cross-member SELECT). Counts
-- only, active groups of verified coaches only, so anon discovery can price
-- fullness without any identity leak.
-- ============================================================================

create or replace function public.get_group_member_counts(
  p_group_ids uuid[]
)
returns table (group_id uuid, active_members int)
language sql
stable
security definer
set search_path = public
as $$
  select g.id as group_id,
         count(m.id) filter (where m.status = 'active')::int as active_members
  from public.training_groups g
  left join public.group_memberships m on m.group_id = g.id
  where g.id = any (p_group_ids)
    and g.active = true
    and exists (
      select 1 from public.coach_profiles cp
      where cp.user_id = g.coach_id and cp.status = 'verified'
    )
  group by g.id;
$$;

revoke all on function public.get_group_member_counts(uuid[]) from public;
grant execute on function public.get_group_member_counts(uuid[]) to anon, authenticated;
