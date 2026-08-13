-- ATLITOS v2 — scripts/verify-session-notifications-and-sweep.sql
--
-- Proof harness for B1 (session notifications) and B2 (membership expiry and
-- reminders). Runs against a THROWAWAY local Postgres, never production:
-- writes to syzzfgaudpifwvbpycyi are forbidden (CLAUDE.md DB write gate), so
-- the flip is proven on a scratch cluster instead of asserted.
--
--   /opt/homebrew/opt/postgresql@17/bin/initdb -D /tmp/atlitos-sweep-pg -U postgres
--   /opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /tmp/atlitos-sweep-pg \
--     -o "-p 55432 -k /tmp" -l /tmp/atlitos-sweep-pg.log start
--   /opt/homebrew/opt/postgresql@17/bin/psql -h /tmp -p 55432 -U postgres \
--     -v ON_ERROR_STOP=1 -f scripts/verify-session-notifications-and-sweep.sql
--
-- WHAT IS REAL HERE AND WHAT IS A STAND IN, stated plainly so nobody reads
-- more into a green run than it earned:
--
--   REAL: migrations 0102, 0103 and 0104 are executed VERBATIM from
--   supabase/migrations. Every function under test is the shipped text.
--   Renumbered from the original 0088/0089/0090 to clear a collision with
--   phase-11/launch-p4, which already holds those numbers for unrelated
--   migrations; see 0102_notification_types_coaching.sql's header.
--
--   STAND IN: the ~87 migrations before them are not replayed (they need the
--   Supabase auth/storage schemas, the supabase roles, and extensions this
--   scratch cluster has none of). Section 0 below creates only the tables and
--   helpers the three migrations touch, with the column definitions copied
--   from 0002_notifications.sql and 0076_training_groups.sql. FKs to
--   auth.users, RLS, policies and grants are omitted: this harness proves
--   BEHAVIOUR of the new functions, not the security posture, which RLS.md and
--   the existing verify-rls-matrix.mjs cover.
--
-- Every assertion below fails the whole run (ON_ERROR_STOP plus explicit
-- raise) rather than printing a warning, so a passing run means every listed
-- claim held.

\set ON_ERROR_STOP on

-- ============================================================================
-- 0. Minimal prerequisites. Column definitions copied from the real
--    migrations; nothing here is under test.
-- ============================================================================

drop schema if exists public cascade;
create schema public;

-- Idempotent so the harness can be re-run against the same scratch cluster.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;

create extension if not exists pgcrypto;

create function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  name text
);

-- 0002_notifications.sql
create type public.notification_type as enum (
  'booking','order','chat','clip_moderation','donation','verification','transfer','support'
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type public.notification_type not null,
  title text not null,
  body text not null,
  deep_link text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- 0018/0076: only the columns session_transition_internal reads or writes.
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.users (id),
  player_id uuid references public.users (id),
  session_type_id uuid,
  frequency text,
  date date not null,
  slot_start time not null,
  slot_end time not null,
  focus_area text,
  location text,
  status text not null,
  decline_reason text,
  cancellation_reason text,
  price numeric(12,2) not null default 0,
  platform_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  payment_intent_id uuid,
  group_id uuid
);

create table public.session_participants (
  session_id uuid not null references public.sessions (id) on delete cascade,
  player_id uuid not null references public.users (id) on delete cascade,
  attendance_status text,
  marked_at timestamptz,
  primary key (session_id, player_id)
);

-- 0076_training_groups.sql
create table public.training_groups (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.users (id),
  name text not null,
  capacity int not null check (capacity > 0),
  monthly_fee numeric(12,2) not null check (monthly_fee >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.group_memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.training_groups (id) on delete cascade,
  player_id uuid not null references public.users (id) on delete cascade,
  period_start date,
  period_end date,
  status text not null default 'pending' check (status in ('pending', 'active', 'lapsed')),
  price numeric(12,2) not null,
  platform_fee numeric(12,2) not null,
  total numeric(12,2) not null,
  payment_intent_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index group_memberships_one_live_per_player
  on public.group_memberships (group_id, player_id)
  where (status <> 'lapsed');

create table public.fee_config (
  domain text not null,
  key text not null,
  value numeric(12,2) not null,
  effective_from timestamptz not null default now()
);
insert into public.fee_config (domain, key, value) values ('sessions', 'platform_fee_flat', 100);

-- ============================================================================
-- 1. The migrations under test, verbatim.
-- ============================================================================

\echo '--- applying supabase/migrations/0102_notification_types_coaching.sql'
\i supabase/migrations/0102_notification_types_coaching.sql
\echo '--- applying supabase/migrations/0103_session_transition_notifications.sql'
\i supabase/migrations/0103_session_transition_notifications.sql
\echo '--- applying supabase/migrations/0104_membership_expiry_sweep.sql'
\i supabase/migrations/0104_membership_expiry_sweep.sql

-- ============================================================================
-- 2. Fixtures. Two athletes and one coach, so every assertion can check that
--    the two parties' ids actually differ before it is trusted (CLAUDE.md:
--    an isolation assertion written against one identity passes for the wrong
--    reason).
-- ============================================================================

insert into public.users (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Coach Rao'),
  ('22222222-2222-2222-2222-222222222222', 'Athlete One'),
  ('33333333-3333-3333-3333-333333333333', 'Athlete Two');

do $$
begin
  if '11111111-1111-1111-1111-111111111111'::uuid = '22222222-2222-2222-2222-222222222222'::uuid then
    raise exception 'FIXTURE BROKEN: coach and athlete are the same id';
  end if;
end $$;

insert into public.training_groups (id, coach_id, name, capacity, monthly_fee) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Sunrise Sprint Squad', 10, 2000);

-- ============================================================================
-- 3. B1: a session transition notifies the athlete, and only the athlete.
-- ============================================================================

insert into public.sessions (id, coach_id, player_id, date, slot_start, slot_end, status, price, platform_fee, total)
values ('bbbbbbbb-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        current_date + 1, '06:30', '07:30', 'requested', 1000, 100, 1000);

\echo ''
\echo '=== B1 BEFORE: notifications for any coaching session transition ==='
select count(*) as session_notifications_before from public.notifications where type = 'session';

select public.session_transition_internal(
  '11111111-1111-1111-1111-111111111111',
  'bbbbbbbb-0000-0000-0000-000000000001',
  'accept'
) is not null as accepted;

select public.session_transition_internal(
  '11111111-1111-1111-1111-111111111111',
  'bbbbbbbb-0000-0000-0000-000000000001',
  'start'
) is not null as started;

select public.session_transition_internal(
  '11111111-1111-1111-1111-111111111111',
  'bbbbbbbb-0000-0000-0000-000000000001',
  'complete'
) is not null as completed;

-- A second session, to prove decline carries its reason.
insert into public.sessions (id, coach_id, player_id, date, slot_start, slot_end, status, price, platform_fee, total)
values ('bbbbbbbb-0000-0000-0000-000000000002',
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
        current_date + 2, '18:00', '19:00', 'requested', 1000, 100, 1000);

select public.session_transition_internal(
  '11111111-1111-1111-1111-111111111111',
  'bbbbbbbb-0000-0000-0000-000000000002',
  'decline',
  'Away at a tournament'
) is not null as declined;

\echo ''
\echo '=== B1 AFTER: one notification per transition, all to the athlete ==='
select u.name as recipient, n.type, n.title, n.body, n.deep_link
  from public.notifications n
  join public.users u on u.id = n.user_id
 where n.type = 'session'
 order by n.created_at, n.title;

do $$
declare v_total int; v_to_coach int;
begin
  select count(*) into v_total from public.notifications where type = 'session';
  select count(*) into v_to_coach from public.notifications
   where type = 'session' and user_id = '11111111-1111-1111-1111-111111111111';

  if v_total <> 4 then
    raise exception 'B1 FAILED: expected 4 session notifications (accept, start, complete, decline), got %', v_total;
  end if;
  if v_to_coach <> 0 then
    raise exception 'B1 FAILED: the acting coach was notified % times; the athlete side only is the rule', v_to_coach;
  end if;
  raise notice 'B1 PASS: 4 session notifications, 0 to the acting coach.';
end $$;

-- Group session: player_id is null, so the roster is the audience.
insert into public.sessions (id, coach_id, player_id, group_id, date, slot_start, slot_end, status)
values ('bbbbbbbb-0000-0000-0000-000000000003',
        '11111111-1111-1111-1111-111111111111', null,
        'aaaaaaaa-0000-0000-0000-000000000001',
        current_date + 3, '07:00', '08:00', 'accepted');
insert into public.session_participants (session_id, player_id) values
  ('bbbbbbbb-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222'),
  ('bbbbbbbb-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333');

select public.session_transition_internal(
  '11111111-1111-1111-1111-111111111111',
  'bbbbbbbb-0000-0000-0000-000000000003',
  'start'
) is not null as group_session_started;

do $$
declare v_recipients int; v_link text;
begin
  select count(distinct user_id), min(deep_link) into v_recipients, v_link
    from public.notifications
   where type = 'session' and deep_link like '/trainings/group-session/%';
  if v_recipients <> 2 then
    raise exception 'B1 FAILED: a group session start notified % athletes, expected 2 participants', v_recipients;
  end if;
  raise notice 'B1 PASS: group session start notified both participants at %', v_link;
end $$;

-- ============================================================================
-- 4. B2: the three memberships that make the sweep's three stages observable.
--
--   ONE   period_end 30 days ago      -> already past grace, should LAPSE
--   TWO   period_end yesterday        -> month over, should EXPIRE, seat kept
--   (TWO doubles as the Renew button proof)
--   THREE period_end in 2 days        -> should be REMINDED, still active
-- ============================================================================

insert into public.users (id, name) values
  ('44444444-4444-4444-4444-444444444444', 'Athlete Three');

insert into public.group_memberships (id, group_id, player_id, period_start, period_end, status, price, platform_fee, total)
values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222', current_date - 60, current_date - 30, 'active', 2000, 100, 2000),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   '33333333-3333-3333-3333-333333333333', current_date - 31, current_date - 1, 'active', 2000, 100, 2000),
  ('cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   '44444444-4444-4444-4444-444444444444', current_date - 28, current_date + 2, 'active', 2000, 100, 2000);

\echo ''
\echo '=== B2 BEFORE: every membership is active, whatever the date says ==='
select substr(id::text, 1, 8) as membership, status, period_end,
       (period_end < current_date) as month_is_over,
       renewal_reminder_sent_at is not null as reminded
  from public.group_memberships order by period_end;

\echo ''
\echo '=== B2 SWEEP RUN 1 ==='
select public.sweep_group_memberships() as sweep_result;

\echo ''
\echo '=== B2 AFTER: status now follows the calendar ==='
select substr(id::text, 1, 8) as membership, status, period_end,
       renewal_reminder_sent_at is not null as reminded,
       expiry_notified_at is not null as expiry_told
  from public.group_memberships order by period_end;

\echo ''
\echo '=== B2 the athlete was actually told, three different things ==='
select u.name as recipient, n.title, n.body, n.deep_link
  from public.notifications n join public.users u on u.id = n.user_id
 where n.type = 'membership' order by n.title;

do $$
declare v_one text; v_two text; v_three text; v_notes int;
begin
  select status into v_one   from public.group_memberships where id = 'cccccccc-0000-0000-0000-000000000001';
  select status into v_two   from public.group_memberships where id = 'cccccccc-0000-0000-0000-000000000002';
  select status into v_three from public.group_memberships where id = 'cccccccc-0000-0000-0000-000000000003';
  select count(*) into v_notes from public.notifications where type = 'membership';

  if v_two <> 'expired' then
    raise exception 'B2 FAILED: a membership one day past period_end is still %, expected expired', v_two;
  end if;
  if v_one <> 'lapsed' then
    raise exception 'B2 FAILED: a membership 30 days past period_end is %, expected lapsed', v_one;
  end if;
  if v_three <> 'active' then
    raise exception 'B2 FAILED: a membership with 2 days left is %, expected active', v_three;
  end if;
  if v_notes <> 3 then
    raise exception 'B2 FAILED: expected 3 membership notifications (remind, expire, lapse), got %', v_notes;
  end if;
  raise notice 'B2 PASS: active past period_end -> expired, past grace -> lapsed, ending soon -> reminded and still active.';
end $$;

-- ============================================================================
-- 5. B2: the sweep is idempotent. A second run the same day must change
--    nothing, or the athlete gets the same reminder every morning.
-- ============================================================================

\echo ''
\echo '=== B2 SWEEP RUN 2 (same day): must be all zeros ==='
select public.sweep_group_memberships() as second_sweep_result;

do $$
declare v_notes int; v_result jsonb;
begin
  select count(*) into v_notes from public.notifications where type = 'membership';
  if v_notes <> 3 then
    raise exception 'B2 FAILED: a second sweep on the same day produced % membership notifications, expected the original 3', v_notes;
  end if;
  raise notice 'B2 PASS: second sweep is a no op, no duplicate notifications.';
end $$;

-- ============================================================================
-- 6. B2: the Renew button. It renders when the membership is renewable, which
--    is the mirror of what renew_group_membership accepts. Both halves are
--    asserted here, because a button that appears in order to error is worse
--    than no button.
-- ============================================================================

\echo ''
\echo '=== B2 Renew: the expired member renews on the SAME row ==='
select public.renew_group_membership(
  '33333333-3333-3333-3333-333333333333',
  'cccccccc-0000-0000-0000-000000000002'
) is not null as renew_accepted_for_expired;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.renew_group_membership(
      '22222222-2222-2222-2222-222222222222',
      'cccccccc-0000-0000-0000-000000000001');
  exception when others then
    if sqlerrm like 'INVALID_TRANSITION%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then
    raise exception 'B2 FAILED: a LAPSED membership was allowed to renew; its seat was already released, it must re join';
  end if;
  raise notice 'B2 PASS: expired renews, lapsed is refused with INVALID_TRANSITION.';
end $$;

-- Capture then extends the period and re arms next month's reminder.
select public.activate_group_membership_paid('cccccccc-0000-0000-0000-000000000002') is not null as activated;

do $$
declare v_status text; v_end date; v_reminded timestamptz;
begin
  select status, period_end, renewal_reminder_sent_at into v_status, v_end, v_reminded
    from public.group_memberships where id = 'cccccccc-0000-0000-0000-000000000002';
  if v_status <> 'active' then
    raise exception 'B2 FAILED: a captured renewal left the membership %, expected active', v_status;
  end if;
  if v_end <= current_date then
    raise exception 'B2 FAILED: a captured renewal left period_end at %, which is not in the future', v_end;
  end if;
  if v_reminded is not null then
    raise exception 'B2 FAILED: the reminder stamp survived activation, so next month gets no reminder';
  end if;
  raise notice 'B2 PASS: renewal activated, period_end now %, reminder re armed.', v_end;
end $$;

-- ============================================================================
-- 7. B2: the seat. Expired keeps it, lapsed released it. This is the whole
--    reason 'expired' exists rather than flipping straight to lapsed.
-- ============================================================================

do $$
declare v_seats int;
begin
  -- join_training_group counts "not lapsed" as holding a seat (0079).
  select count(*) into v_seats from public.group_memberships
   where group_id = 'aaaaaaaa-0000-0000-0000-000000000001' and status <> 'lapsed';
  if v_seats <> 2 then
    raise exception 'B2 FAILED: % seats held, expected 2 (the renewed member and the still active one)', v_seats;
  end if;
  raise notice 'B2 PASS: the lapsed member released their seat, the others kept theirs.';
end $$;

\echo ''
\echo '=== ALL ASSERTIONS PASSED ==='
