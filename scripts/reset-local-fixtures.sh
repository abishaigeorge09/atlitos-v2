#!/usr/bin/env bash
# ATLITOS v2 - scripts/reset-local-fixtures.sh
#
# WHY THIS EXISTS.
#
# Write-path Maestro flows mutate the very state they assert on, so they pass
# ONCE and fail forever afterwards. Observed 2026-08-14: groups-coach asserts
# its seeded group session is "Accepted", then starts it, marks attendance and
# ENDS it. The next run finds a `completed` session and fails on an assertion
# that was correct both times. Nothing was broken; the flow ate its own
# fixture.
#
# That is a property of every write-path flow, not a quirk of this one, and it
# is the difference between a suite that can run twice and one that cannot. Run
# this before a suite run.
#
# LOCAL ONLY. It refuses any target that is not loopback, for the same reason
# scripts/lib/guard-target.mjs exists: the seed generator defaulted to
# production and put fixture rows in five production tables.

set -euo pipefail

DB_URL="${ATLITOS_LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

case "$DB_URL" in
  *127.0.0.1*|*localhost*) ;;
  *)
    echo "REFUSED: reset-local-fixtures.sh only runs against a loopback database." >&2
    echo "  target: $DB_URL" >&2
    echo "  This truncates and rewrites fixture state. It must never touch production." >&2
    exit 1
    ;;
esac

command -v psql >/dev/null 2>&1 || { echo "psql not on PATH. Try: export PATH=/opt/homebrew/bin:\$PATH" >&2; exit 1; }

echo "Resetting local fixtures against $DB_URL"

psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
-- Group sessions: back to `accepted`, which is what groups-coach expects to
-- find. It then starts, marks attendance on, and completes them.
update public.sessions
set status = 'accepted'
where group_id is not null
  and status in ('in_progress', 'completed');

-- Attendance marks from a previous run. groups-coach asserts "3 of 3 present"
-- AFTER it marks them, so leaving last run's marks in place would make that
-- assertion pass before the flow did anything.
update public.session_participants sp
set attendance_status = null
from public.sessions s
where s.id = sp.session_id
  and s.group_id is not null;

-- Groups created by coach-group-create. Without this they ACCUMULATE: the flow
-- has no assertion that could notice, so a second run silently leaves two
-- "Evening Cricket Squad" rows and a third leaves three. Observed 2026-08-14.
--
-- Order matters now. 0107 retargeted group_memberships.group_id to ON DELETE
-- RESTRICT precisely so a paid-into group cannot vanish under its memberships,
-- so the memberships must go first and only for THIS fixture group. That the
-- delete below would fail without this step is 0107 working as intended.
delete from public.group_memberships
where group_id in (select id from public.training_groups where name = 'Evening Cricket Squad');

delete from public.training_groups
where name = 'Evening Cricket Squad';

-- Session types created by coach-session-type-create. It asserts the name it
-- just typed, so a leftover row from last run makes the assertion pass
-- vacuously, which is worse than failing.
delete from public.session_types
where name = 'Powerplay batting';

-- Comments added by any flow that exercises the composer, so the header count
-- and the seeded 36 stay in agreement.
delete from public.clip_comments
where text like 'maestro %';

-- Availability must exist or no coach is bookable and the whole booking funnel
-- is untestable. Idempotent.
insert into public.coach_availability_windows (coach_id, day_of_week, start_time, end_time, effective_from)
select cp.user_id, d.dow, time '17:00', time '20:00', current_date - 1
from public.coach_profiles cp
cross join generate_series(0, 6) as d(dow)
where cp.status = 'verified'
  and not exists (
    select 1 from public.coach_availability_windows w
    where w.coach_id = cp.user_id and w.day_of_week = d.dow
  );

-- The 1:1 coaching chat thread. trainings-shell asserts the coach's name in the
-- Chat tab, and it FAILED locally on 2026-08-14 for a data reason, not a
-- product one: a completed 1:1 session between this athlete and coach1 exists,
-- but no thread does, because the session was seeded straight into SQL and so
-- bypassed whatever opens a thread in the app. Production has the thread from
-- real usage, which is why the flow passes there and failed here.
--
-- The check constraint requires context_type <> 'group' to carry BOTH
-- participants, ordered participant_a < participant_b. coach1
-- (032cde8d...) sorts before the athlete (382caa08...), so the coach is a.
insert into public.chat_threads (participant_a, participant_b, context_type, context_id, last_message_at)
select s.coach_id, s.player_id, 'coaching', s.id, now()
from public.sessions s
where s.group_id is null
  and s.coach_id < s.player_id
  and not exists (
    select 1 from public.chat_threads t
    where t.context_type = 'coaching'
      and t.participant_a = s.coach_id and t.participant_b = s.player_id
  )
limit 1;

-- ANALYTICS NEEDS THREE COMPLETED SESSIONS. trainings-shell asserts the
-- "Sessions held" stat tile, and the Analytics tab renders an honest empty
-- state instead ("Not enough sessions yet. Complete at least 3 sessions to see
-- your trends here.") until the athlete has THREE. The local seed creates one,
-- so the flow could never reach that assertion here. Production has more from
-- real usage, which is why it passes there.
--
-- This is seed data, not a product finding: the empty state is correct
-- behaviour and good copy. Top up to three, priced to match the existing row so
-- any earnings maths stays coherent. No payment_intents and no ledger rows are
-- created, exactly as the other seeded sessions do it.
insert into public.sessions (coach_id, player_id, session_type_id, frequency, date, slot_start, slot_end, price, platform_fee, total, status)
select s.coach_id, s.player_id, s.session_type_id, 'one_time',
       (current_date - (g.n * 7)), time '09:00', time '10:00',
       s.price, s.platform_fee, s.total, 'completed'
from public.sessions s
cross join generate_series(1, 2) as g(n)
where s.group_id is null
  and s.status = 'completed'
  and (select count(*) from public.sessions x
       where x.group_id is null and x.status = 'completed'
         and x.player_id = s.player_id) < 3
limit 2;

-- The denormalised comment counter is owned by clip_comments_maintain_count on
-- INSERT and DELETE. Reconcile anyway, because the clips seed used to write a
-- literal on top of it and any stale row makes the rail disagree with the sheet.
update public.clips c
set comment_count = (select count(*) from public.clip_comments cc where cc.clip_id = c.id)
where c.comment_count <> (select count(*) from public.clip_comments cc where cc.clip_id = c.id);
SQL

echo "State after reset:"
psql "$DB_URL" -At -F'  ' -c "
select 'group sessions accepted: '||count(*) from public.sessions where group_id is not null and status='accepted'
union all select 'attendance marks left: '||count(*) from public.session_participants sp join public.sessions s on s.id=sp.session_id where s.group_id is not null and sp.attendance_status is not null
union all select 'verified coaches bookable: '||count(*) from public.coach_profiles cp where cp.status='verified' and exists (select 1 from public.session_types st where st.coach_id=cp.user_id and st.active) and exists (select 1 from public.coach_availability_windows w where w.coach_id=cp.user_id)
union all select 'clips with counter drift: '||count(*) from public.clips c where c.comment_count <> (select count(*) from public.clip_comments cc where cc.clip_id=c.id);
"
