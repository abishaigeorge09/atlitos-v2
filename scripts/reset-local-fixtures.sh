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
