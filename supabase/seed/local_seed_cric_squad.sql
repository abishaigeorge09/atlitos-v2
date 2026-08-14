-- Local-only fixture: mirrors production's "Cric Squad" group so
-- .maestro/groups-athlete.yaml and .maestro/groups-coach.yaml (which have
-- NEVER run before, production is read only) have data to run against.
-- Never applied to production. Idempotent: re-running is a no-op if the
-- group already exists. Written as direct inserts, not through the
-- create_training_group/create_group_session RPCs, because those require
-- an authenticated JWT context; the row shapes below are copied verbatim
-- from what those RPCs insert (supabase/migrations/0079_group_rpcs.sql,
-- 0112_training_group_capacity_ceiling.sql) and the 0078 chat sync
-- triggers fire on any INSERT, RPC or direct, so the result is identical.
--
-- Shape, matching what the two flows assert literally, including two
-- values .maestro/groups-athlete.yaml hardcodes rather than deriving from
-- capacity/date, so they are pinned here rather than left "reasonable":
--   coach1@atlitos.dev owns "Cric Squad", monthly_fee 2000, capacity 8 (the
--   flow asserts ".*of 8 spots left.*", the coach detail screen renders
--   "{capacity - activeMembers} of {capacity} spots left", 4 active members
--   makes 4 of 8, matching).
--   period_end 2026-09-25 on every membership (the flow asserts the literal
--   string "Active until 25 Sep 2026" on the Stats tab).
--   3 active members get session_participants seeded at scheduling time
--   (player@, partner@, fixture.engager1@), then a 4th active member
--   (fixture.engager2@) joins AFTER scheduling, exactly like production's
--   real history, so chat_thread_members ends at coach + 4 = 5 while the
--   one seeded session keeps its original 3 participants.
--   One group session, focus_area "Batting drills and fielding", status
--   accepted, unmarked attendance, so groups-coach.yaml can start it, mark
--   3 present, and end it for the first time ever.

do $$
declare
  v_coach uuid := '032cde8d-627a-4507-9afb-8df31871204e'; -- coach1@atlitos.dev
  v_player uuid := '382caa08-09b7-4f35-8286-7a0bb901bc86'; -- player@atlitos.dev
  v_partner uuid := 'f5c4e89b-e56f-42e3-8588-fdbd5c1fd74d'; -- partner@atlitos.dev
  v_engager1 uuid := 'b3ef4b07-fe3d-4385-93bd-363bdc414ba8'; -- fixture.engager1@atlitos.dev
  v_engager2 uuid := 'd186efd6-52d6-420e-92d9-dfd3a00fcc00'; -- fixture.engager2@atlitos.dev
  v_group_id uuid;
  v_session_id uuid;
  v_session_type_id uuid;
begin
  -- coach1@atlitos.dev has no coach_profiles row locally (documented gap,
  -- docs/qa/CURRENT-STATE.md "The coach has NO creation layer" and
  -- docs/qa/LOCAL-DEV.md's seed_identity.sql email mismatch note): the demo
  -- account exists in auth.users/public.users but never completed coach
  -- onboarding on this fresh stack. training_groups.coach_id references
  -- coach_profiles(user_id), not users(id) directly, so without this row
  -- Cric Squad, and every other coach-side fixture, cannot exist at all.
  insert into public.coach_profiles (user_id, sport, experience_years, city, state, status)
  values (v_coach, 'cricket', 8, 'Hyderabad', 'Telangana', 'verified')
  on conflict (user_id) do nothing;

  select id into v_group_id from public.training_groups where coach_id = v_coach and name = 'Cric Squad';

  if v_group_id is null then
    insert into public.training_groups (coach_id, name, sport, capacity, monthly_fee, attendance_policy)
    values (
      v_coach, 'Cric Squad', 'cricket', 8, 2000,
      'Be on the ground 10 minutes before the session starts. Latecomers may miss warm ups.'
    )
    returning id into v_group_id;
  end if;

  -- 3 active memberships before scheduling, so the session picks up exactly
  -- 3 participants. price/platform_fee/total are 0: same "no money moves for
  -- v1 group session pricing" shape create_group_session relies on, and this
  -- seed script is standing in for the join-group edge function's real
  -- Razorpay flow, not replaying it.
  insert into public.group_memberships (group_id, player_id, status, period_start, period_end, price, platform_fee, total)
  select v_group_id, p, 'active', current_date, '2026-09-25'::date, 2000, 0, 2000
  from unnest(array[v_player, v_partner, v_engager1]) as p
  where not exists (
    select 1 from public.group_memberships gm where gm.group_id = v_group_id and gm.player_id = p
  );

  select id into v_session_id
  from public.sessions
  where group_id = v_group_id and focus_area = 'Batting drills and fielding';

  if v_session_id is null then
    insert into public.sessions (
      coach_id, player_id, session_type_id, frequency,
      date, slot_start, slot_end, focus_area, location, status,
      price, platform_fee, total, group_id
    )
    values (
      v_coach, null, null, 'one_time',
      current_date + 1, '17:00', '18:00',
      'Batting drills and fielding', null, 'accepted',
      0, 0, 0, v_group_id
    )
    returning id into v_session_id;

    insert into public.session_participants (session_id, player_id)
    select v_session_id, m.player_id
    from public.group_memberships m
    where m.group_id = v_group_id and m.status = 'active';
  end if;

  -- 4th member joins AFTER scheduling, matching production: chat ends at
  -- coach + 4 = 5 members, session_participants stays at the original 3.
  insert into public.group_memberships (group_id, player_id, status, period_start, period_end, price, platform_fee, total)
  select v_group_id, v_engager2, 'active', current_date, '2026-09-25'::date, 2000, 0, 2000
  where not exists (
    select 1 from public.group_memberships gm where gm.group_id = v_group_id and gm.player_id = v_engager2
  );

  -- One 1:1 session type and one completed session this month, so the coach
  -- Trainings > Stats tab clears its "No sessions yet" empty state
  -- (apps/mobile/src/app/(tabs)/trainings/(shell)/index.tsx: that state
  -- shows whenever requests, upcoming AND sessionsThisMonth are all empty;
  -- listUpcoming deliberately excludes group sessions, so Cric Squad's one
  -- group session above does not clear it on its own). Without this,
  -- .maestro/groups-coach.yaml's very first assertion on the coach
  -- dashboard ("Players coached") never renders, which is a real local
  -- fixture gap, not a product bug: use-coach.ts's own header note says
  -- sessionsThisMonth only counts status IN (completed, rated) this month.
  insert into public.session_types (coach_id, name, duration_minutes, price)
  select v_coach, 'Batting Basics', 60, 500
  where not exists (select 1 from public.session_types where coach_id = v_coach)
  returning id into v_session_type_id;

  if v_session_type_id is null then
    select id into v_session_type_id from public.session_types where coach_id = v_coach limit 1;
  end if;

  insert into public.sessions (
    coach_id, player_id, session_type_id, frequency,
    date, slot_start, slot_end, focus_area, status,
    price, platform_fee, total
  )
  select
    v_coach, v_player, v_session_type_id, 'one_time',
    current_date, '09:00', '10:00', 'Batting Basics', 'completed',
    500, 25, 525
  where not exists (
    select 1 from public.sessions
    where coach_id = v_coach and player_id = v_player and status = 'completed'
  );
end $$;

-- ---------------------------------------------------------------------------
-- COACH AVAILABILITY. Without this, no coach is BOOKABLE and the entire
-- athlete booking funnel is untestable: the coach profile's CTA stays on
-- "Choose a type, date, and time" because there are no slots to choose.
--
-- Measured 2026-08-14. Local had coach1 verified with 1 active session type
-- and ZERO windows. Production, read only, was healthier but not clean:
-- 3 verified coaches, 2 with a session type, 2 with availability, so 2 of 3
-- actually bookable. The third is verified, appears in browse, and cannot be
-- booked by anyone.
--
-- Seven days, 17:00 to 20:00, which is when after-work coaching actually
-- happens in Hyderabad and keeps the slot picker non-empty on any test day.
-- ---------------------------------------------------------------------------
insert into public.coach_availability_windows (coach_id, day_of_week, start_time, end_time, effective_from)
select cp.user_id, d.dow, time '17:00', time '20:00', current_date - 1
from public.coach_profiles cp
cross join generate_series(0, 6) as d(dow)
where cp.status = 'verified'
  and not exists (
    select 1 from public.coach_availability_windows w
    where w.coach_id = cp.user_id and w.day_of_week = d.dow
  );
