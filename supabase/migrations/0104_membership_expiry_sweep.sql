-- ATLITOS v2 — 0104_membership_expiry_sweep.sql
-- Domain: coaching groups, fares. Closes gap B2: an active membership never
-- becomes anything else, so time does not exist in the fares model.
--
-- THE GAP, precisely. membership_abandon_unpaid (0079) is the only writer of
-- 'lapsed' in the product, and it refuses any row that is not 'pending' with
-- no captured payment. Nothing else moves a membership by time. Three live
-- consequences:
--
--   1. the athlete reads "Active until <date>" forever, years past period_end;
--   2. the Renew button in MyGroupsCard.tsx is dead code, because it renders
--      only for 'lapsed', a state a paid membership can never reach;
--   3. the coach's roster computes lapsed CLIENT SIDE from the date
--      ((tabs)/trainings/group/[id].tsx memberChip), so the coach sees Lapsed
--      on a member whose own app still says Active until, and that member has
--      no way to pay.
--
-- ============================================================================
-- DECISION 1: a fourth status, 'expired', between active and lapsed.
-- ============================================================================
--
-- The obvious move, active -> 'lapsed' at period_end, is wrong here, and the
-- reason is in three places that already exist:
--
--   * the partial unique index group_memberships_one_live_per_player (0076)
--     and join_training_group's capacity count (0079) both treat "not lapsed"
--     as "holds a seat". Flipping to lapsed on the day the month ends RELEASES
--     the athlete's seat, so a full group can be taken by a stranger while the
--     member is still inside the renewal window.
--   * getGroup (packages/api/src/use-groups.ts) filters members with
--     .neq("status","lapsed"), so a lapsed member VANISHES from the coach's
--     roster. Today the coach at least sees them chipped Lapsed. Flipping
--     straight to lapsed would make the two views disagree more, not less.
--   * renew_group_membership (0079) refuses anything that is not 'active'
--     ("a lapsed member joins the group again instead"), so the Renew button
--     would light up and then fail with INVALID_TRANSITION. A button that
--     appears in order to error is worse than a button that never appears.
--
-- So 'expired' means: the paid month has ended, the seat is still yours, renew
-- and you keep it. 'lapsed' keeps its exact existing meaning: no seat, come
-- back through join_training_group and its capacity guard. The sweep moves
-- active -> expired at period_end and expired -> lapsed after the grace
-- window, which is the first time the seat is actually released.
--
-- User visible label: both 'expired' and 'lapsed' render as the existing
-- Lapsed pill (session-display.ts). The extra state is a fares mechanic, not
-- a new word for an athlete to learn, and rendering it as Lapsed is what makes
-- the athlete card and the coach chip say the same word on the same day.
--
-- ============================================================================
-- DECISION 2: pg_cron, and it is not a new dependency.
-- ============================================================================
--
-- Options were pg_cron, a scheduled Supabase edge function, and swept on read.
--
--   * SWEPT ON READ was rejected on the reminder, not on the flip. A reminder
--     three days before period_end has to fire whether or not anyone opens the
--     app, and the athlete who most needs it is exactly the one who has not
--     opened it. Sweep on read also turns a coach's roster read into writes on
--     other people's money bearing rows, on a permissive OR table, which is
--     the shape CLAUDE.md's scoping rule exists to prevent.
--   * A SCHEDULED EDGE FUNCTION would buy the device push leg, except that leg
--     is still the P9 stub (_shared/notify.ts deliverToDevice returns
--     "stubbed"), so today it buys nothing. On Supabase the scheduler under it
--     is pg_cron plus pg_net anyway, so it is pg_cron with an HTTP hop, a
--     stored service role key and a second failure mode added.
--   * PG_CRON is what this product already runs. Verified read only against
--     production (syzzfgaudpifwvbpycyi) on 2026-08-13: pg_cron 1.6.4 is
--     installed, and cron.job holds jobid 1, 'expire-stale-holds', every 5
--     minutes, running select public.expire_stale_holds(). That job was
--     created out of band and appears in no migration in this repo, which is
--     its own defect: a rebuild from migrations silently loses the courts and
--     sessions hold sweep. 0105 fixes that by declaring both jobs in SQL.
--
-- The sweep is written to expire_stale_holds's shape deliberately: one
-- SECURITY DEFINER function, service_role only, row by row with the failure of
-- one row swallowed and COUNTED rather than aborting the others, returning
-- jsonb counters so a silent no op sweep is distinguishable from a working
-- one.
--
-- IDEMPOTENCY. Each stage is guarded by the row's own state, so a double run
-- in one day is a no op: the reminder is gated on renewal_reminder_sent_at
-- being null, the expiry on status still being 'active', the lapse on status
-- still being 'expired'. activate_group_membership_paid clears both stamps, so
-- the next month gets its own reminder.

-- ============================================================================
-- 1. Status vocabulary and the two idempotency stamps.
-- ============================================================================

alter table public.group_memberships
  drop constraint group_memberships_status_check;

alter table public.group_memberships
  add constraint group_memberships_status_check
  check (status in ('pending', 'active', 'expired', 'lapsed'));

alter table public.group_memberships
  add column if not exists renewal_reminder_sent_at timestamptz,
  add column if not exists expiry_notified_at timestamptz;

comment on column public.group_memberships.renewal_reminder_sent_at is
  'B2: when the pre expiry renewal reminder was sent for the CURRENT period. Cleared by activate_group_membership_paid so each paid month gets exactly one reminder.';
comment on column public.group_memberships.expiry_notified_at is
  'B2: when the athlete was told the membership had run past period_end. Cleared by activate_group_membership_paid.';

-- The seat holding index and the capacity count both key off "not lapsed",
-- so 'expired' keeps the seat with no change to either. Recorded here rather
-- than left to be rediscovered: group_memberships_one_live_per_player is
-- `where (status <> 'lapsed')` (0076) and join_training_group counts
-- `status <> 'lapsed'` (0079). Both are correct as written for 'expired'.

-- Members whose month has ended must not be swept into a live session roster
-- or marked present: create_group_session seeds participants from status
-- 'active' only and mark_attendance requires status 'active' (both 0079), so
-- both already exclude 'expired' with no change.

-- ============================================================================
-- 2. The two windows, as named functions, so "how long" has one answer.
--    unpaid_hold_ttl() (0038) is the precedent for this shape.
-- ============================================================================

create or replace function public.membership_reminder_lead()
returns interval
language sql
immutable
as $$
  select interval '3 days';
$$;

comment on function public.membership_reminder_lead() is
  'B2: how far before period_end the renewal reminder fires.';

create or replace function public.membership_grace_period()
returns interval
language sql
immutable
as $$
  select interval '7 days';
$$;

comment on function public.membership_grace_period() is
  'B2: how long an expired membership keeps its seat before the sweep lapses it and releases the seat to the group capacity count.';

-- ============================================================================
-- 3. renew_group_membership: 0079's body with ONE guard widened, from
--    status = 'active' to status in ('active','expired'). The fare re-snapshot
--    and every other check are byte identical.
--
--    This is what makes the Renew button real. An expired member still holds
--    their seat (decision 1), so there is nothing to re-check on capacity and
--    the renewal is the same one time payment on the same row. A LAPSED member
--    is still refused with the same message and still re-joins, because their
--    seat is gone and only join_training_group can safely contest capacity.
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
  if v_membership.status not in ('active', 'expired') then
    raise exception 'INVALID_TRANSITION: membership % is not active or expired; a lapsed member joins the group again instead', p_membership_id;
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
-- 4. activate_group_membership_paid: 0079's body with the period arithmetic
--    UNTOUCHED, plus clearing the two stamps from section 1.
--
--    The arithmetic is deliberately not changed: an 'active' row still extends
--    from greatest(period_end, today) so an early renewal loses no days, and
--    every other state (pending, expired, lapsed) still starts a fresh month
--    from today, which is exactly right for a membership that had already run
--    out. Clearing the stamps is what re-arms next month's reminder.
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
    set period_end = (v_anchor + interval '1 month')::date,
        renewal_reminder_sent_at = null,
        expiry_notified_at = null
    where id = p_membership_id
    returning * into v_membership;
  else
    update public.group_memberships
    set status = 'active',
        period_start = v_today,
        period_end = (v_today + interval '1 month')::date,
        renewal_reminder_sent_at = null,
        expiry_notified_at = null
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
-- 5. sweep_group_memberships: the daily job. Three stages, each idempotent,
--    each failing per row rather than per sweep (expire_stale_holds, 0038).
--
--      remind   active,  period_end within the lead window, not yet reminded
--      expire   active,  period_end already past            -> 'expired'
--      lapse    expired, period_end past by more than the grace window
--                                                           -> 'lapsed'
--
--    Dates are Asia/Kolkata, the single product timezone every other date
--    calculation in the coaching domain uses.
-- ============================================================================

create or replace function public.sweep_group_memberships()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_reminded int := 0;
  v_reminder_failures int := 0;
  v_expired int := 0;
  v_expiry_failures int := 0;
  v_lapsed int := 0;
  v_lapse_failures int := 0;
  v_grace_days int := (extract(day from public.membership_grace_period()))::int;
  v_row record;
begin
  -- Stage 1: remind, before the month ends, once per period.
  for v_row in
    select m.id, m.player_id, m.period_end, g.name as group_name
    from public.group_memberships m
    join public.training_groups g on g.id = m.group_id
    where m.status = 'active'
      and m.period_end is not null
      and m.period_end >= v_today
      and m.period_end <= v_today + public.membership_reminder_lead()
      and m.renewal_reminder_sent_at is null
  loop
    begin
      insert into public.notifications (user_id, type, title, body, deep_link)
      values (
        v_row.player_id,
        'membership',
        'Membership ends soon',
        'Your ' || v_row.group_name || ' membership ends on '
          || to_char(v_row.period_end, 'DD Mon YYYY')
          || '. Renew to keep your seat.',
        '/trainings'
      );

      update public.group_memberships
      set renewal_reminder_sent_at = now()
      where id = v_row.id;

      v_reminded := v_reminded + 1;
    exception when others then
      v_reminder_failures := v_reminder_failures + 1;
    end;
  end loop;

  -- Stage 2: the month has ended and the grace window is still open. Status
  -- moves, seat is KEPT (see decision 1).
  --
  -- The upper bound `period_end >= today - grace` is not decoration. Without
  -- it, a row that is already months overdue (every existing membership on the
  -- day this first runs, since nothing has ever swept) would be expired by
  -- stage 2 and then lapsed by stage 3 in the SAME sweep, sending the athlete
  -- "renew within 7 days to keep your seat" and "your seat was released" in
  -- the same minute. Caught by scripts/verify-session-notifications-and-sweep.sql
  -- on its first run, which is why the assertion counting membership
  -- notifications is in that harness.
  for v_row in
    select m.id, m.player_id, m.period_end, g.name as group_name
    from public.group_memberships m
    join public.training_groups g on g.id = m.group_id
    where m.status = 'active'
      and m.period_end is not null
      and m.period_end < v_today
      and m.period_end >= v_today - public.membership_grace_period()
  loop
    begin
      update public.group_memberships
      set status = 'expired',
          expiry_notified_at = now()
      where id = v_row.id
        and status = 'active';

      insert into public.notifications (user_id, type, title, body, deep_link)
      values (
        v_row.player_id,
        'membership',
        'Membership needs renewing',
        'Your ' || v_row.group_name || ' membership ended on '
          || to_char(v_row.period_end, 'DD Mon YYYY')
          || '. Renew within ' || v_grace_days::text || ' days to keep your seat.',
        '/trainings'
      );

      v_expired := v_expired + 1;
    exception when others then
      v_expiry_failures := v_expiry_failures + 1;
    end;
  end loop;

  -- Stage 3: grace is over. THIS is where the seat is released, which is why
  -- it is the only stage that changes what join_training_group counts.
  --
  -- Takes 'active' as well as 'expired' so a row that was never swept while
  -- the grace window was open (a backlog, a paused job) still lands in the
  -- right final state with ONE notification, rather than being walked through
  -- an expiry it already slept through. Stage 2's upper bound is what keeps
  -- these two sets disjoint.
  for v_row in
    select m.id, m.player_id, g.name as group_name
    from public.group_memberships m
    join public.training_groups g on g.id = m.group_id
    where m.status in ('active', 'expired')
      and m.period_end is not null
      and m.period_end < v_today - public.membership_grace_period()
  loop
    begin
      update public.group_memberships
      set status = 'lapsed'
      where id = v_row.id
        and status in ('active', 'expired');

      insert into public.notifications (user_id, type, title, body, deep_link)
      values (
        v_row.player_id,
        'membership',
        'Membership lapsed',
        'Your seat in ' || v_row.group_name || ' was released. Join the group again to train with them.',
        '/trainings'
      );

      v_lapsed := v_lapsed + 1;
    exception when others then
      v_lapse_failures := v_lapse_failures + 1;
    end;
  end loop;

  return jsonb_build_object(
    'swept_on', v_today,
    'reminded', v_reminded,
    'reminder_failures', v_reminder_failures,
    'expired', v_expired,
    'expiry_failures', v_expiry_failures,
    'lapsed', v_lapsed,
    'lapse_failures', v_lapse_failures
  );
end;
$$;

revoke all on function public.sweep_group_memberships() from public;
revoke execute on function public.sweep_group_memberships() from anon, authenticated;
grant execute on function public.sweep_group_memberships() to service_role;

comment on function public.sweep_group_memberships() is
  'B2: daily membership sweep. Reminds before period_end, expires an ended month keeping the seat, lapses after the grace window releasing the seat. Idempotent per stage, per row failure counted not raised. Scheduled in 0105.';
