-- ATLITOS v2 — 0088_backfill_coach_setup_from_verification_payload.sql
-- Domain: coaching onboarding.
--
-- This is the backfill 0004_player_and_coach_setup_rpc.sql promised in its
-- header and never delivered:
--
--   "A future coaching migration should backfill
--    session_types/coach_availability_windows rows from existing
--    verification_requests.payload for coaches approved before that point."
--
-- The coach setup wizard collects session types at step 4 and availability
-- windows at step 5, and `submit_coach_verification` writes both into
-- `verification_requests.payload` as jsonb because 0018_coaching.sql, which
-- creates the two tables, had not landed when 0004 was written. 0018 landed.
-- Nothing ever read the payload back. The result is a coach who completed
-- every step of onboarding, was approved by an admin, and has ZERO
-- session_types rows. `sessions.session_type_id` is NOT NULL, and the
-- athlete booking screen lists only `active` types, so that coach is not
-- merely missing a feature, they are unbookable. This migration recovers
-- what the wizard already collected.
--
-- Payload shape, from apps/mobile (coach-setup/[step].tsx) and
-- packages/api/src/hooks.ts SubmitCoachVerificationInput:
--
--   payload -> 'sessionTypes'        [{ name, durationMinutes, price }]
--   payload -> 'availabilityWindows' [{ dayOfWeek, from, to }]
--
-- Decisions:
--
--   1. Approved applicants only. A pending or rejected request must not
--      publish prices or open bookable windows: an approved
--      verification_request is the only evidence an admin agreed to make
--      this coach visible. `coach_profiles.status = 'verified'` is checked
--      as well, since that is what the athlete facing reads gate on.
--
--   2. Latest approved request per coach only. A resubmission after a
--      rejection (FR-10) leaves several rows; taking all of them would
--      restore prices the coach already replaced.
--
--   3. Additive, never destructive. Coaches who already have rows are
--      skipped wholesale rather than merged: a coach who has since edited
--      their pricing must not have a stale wizard draft reinserted
--      underneath them. This is the whole reason there is no delete
--      anywhere in this file.
--
--   4. Idempotent. Safe to run twice: the not-exists guards mean the second
--      run inserts nothing.
--
--   5. Rows that fail the tables' own checks are skipped, not forced
--      through. `session_types` requires duration_minutes > 0 and price > 0;
--      `coach_availability_windows` requires end_time > start_time and
--      day_of_week between 0 and 6, plus a no-overlap exclusion constraint.
--      A wizard draft that violates any of those is bad data, and the
--      correct outcome is that the coach fixes it on the session types or
--      availability screen, not that this migration crashes or writes a row
--      the table would have refused.
--
--   6. Availability windows are deduplicated against each other within a
--      payload before insert, because the exclusion constraint
--      (`coach_availability_windows_no_overlap`) will abort the whole
--      statement on an overlapping pair, and a draft can legitimately hold
--      two overlapping rows the wizard never validated against each other.
--      Earliest start wins per day; later overlapping rows are dropped.
--
-- Scope note: this does not, and cannot, invent a session type for a coach
-- whose payload had none. Those coaches stay unbookable until they use the
-- session types screen added alongside this migration, which is the durable
-- fix. This migration only recovers what was actually collected.
--
-- No schema change, no RLS change, no API contract change: data only.

-- ============================================================================
-- The latest approved coach verification request per verified coach.
-- ============================================================================

with latest_request as (
  select distinct on (vr.applicant_id)
    vr.applicant_id as coach_id,
    vr.payload
  from public.verification_requests vr
  join public.coach_profiles cp on cp.user_id = vr.applicant_id
  where vr.applicant_type = 'coach'
    and vr.status = 'approved'
    and cp.status = 'verified'
  order by vr.applicant_id, vr.created_at desc
),

-- Coaches with NO session types at all. Partial restore is deliberately not
-- attempted (decision 3).
eligible_types as (
  select lr.coach_id, lr.payload
  from latest_request lr
  where not exists (
    select 1 from public.session_types st where st.coach_id = lr.coach_id
  )
),

candidate_types as (
  select
    et.coach_id,
    btrim(item ->> 'name') as name,
    (item ->> 'durationMinutes')::int as duration_minutes,
    (item ->> 'price')::numeric as price
  from eligible_types et
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(et.payload -> 'sessionTypes') = 'array'
        then et.payload -> 'sessionTypes'
      else '[]'::jsonb
    end
  ) as item
)

insert into public.session_types (coach_id, name, duration_minutes, price, active)
select ct.coach_id, ct.name, ct.duration_minutes, ct.price, true
from candidate_types ct
where ct.name is not null
  and ct.name <> ''
  -- Decision 5: mirror the table's own checks rather than letting a bad
  -- draft row abort the migration.
  and ct.duration_minutes is not null
  and ct.duration_minutes > 0
  and ct.price is not null
  and ct.price > 0;

-- ============================================================================
-- Availability windows, same rules.
-- ============================================================================

with latest_request as (
  select distinct on (vr.applicant_id)
    vr.applicant_id as coach_id,
    vr.payload
  from public.verification_requests vr
  join public.coach_profiles cp on cp.user_id = vr.applicant_id
  where vr.applicant_type = 'coach'
    and vr.status = 'approved'
    and cp.status = 'verified'
  order by vr.applicant_id, vr.created_at desc
),

eligible_windows as (
  select lr.coach_id, lr.payload
  from latest_request lr
  where not exists (
    select 1 from public.coach_availability_windows w where w.coach_id = lr.coach_id
  )
),

candidate_windows as (
  select
    ew.coach_id,
    (item ->> 'dayOfWeek')::smallint as day_of_week,
    (item ->> 'from')::time as start_time,
    (item ->> 'to')::time as end_time
  from eligible_windows ew
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(ew.payload -> 'availabilityWindows') = 'array'
        then ew.payload -> 'availabilityWindows'
      else '[]'::jsonb
    end
  ) as item
),

valid_windows as (
  select *
  from candidate_windows cw
  where cw.day_of_week is not null
    and cw.day_of_week between 0 and 6
    and cw.start_time is not null
    and cw.end_time is not null
    and cw.end_time > cw.start_time
),

-- Decision 6: drop any window that overlaps one already kept for the same
-- coach and day. Earliest start wins, deterministically.
ranked_windows as (
  select
    vw.*,
    row_number() over (
      partition by vw.coach_id, vw.day_of_week
      order by vw.start_time, vw.end_time
    ) as position
  from valid_windows vw
),

non_overlapping as (
  select rw.*
  from ranked_windows rw
  where not exists (
    select 1
    from ranked_windows earlier
    where earlier.coach_id = rw.coach_id
      and earlier.day_of_week = rw.day_of_week
      and earlier.position < rw.position
      and earlier.start_time < rw.end_time
      and rw.start_time < earlier.end_time
  )
)

insert into public.coach_availability_windows (coach_id, day_of_week, start_time, end_time)
select nw.coach_id, nw.day_of_week, nw.start_time, nw.end_time
from non_overlapping nw;
