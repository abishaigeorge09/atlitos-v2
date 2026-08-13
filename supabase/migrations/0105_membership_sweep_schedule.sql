-- ATLITOS v2 — 0105_membership_sweep_schedule.sql
-- Domain: scheduling. Declares the product's cron jobs in SQL.
--
-- STATE OF PLAY, verified read only against production (syzzfgaudpifwvbpycyi)
-- on 2026-08-13, not assumed:
--
--   select extname, extversion from pg_extension where extname = 'pg_cron';
--     -> pg_cron 1.6.4, installed
--   select jobid, jobname, schedule, command, active from cron.job;
--     -> 1 | expire-stale-holds | */5 * * * * | select public.expire_stale_holds(); | t
--
-- So pg_cron is not a new dependency, it is the mechanism this product already
-- runs on. But that job exists ONLY in the live database and in SCHEMA.md's
-- prose: no migration in this repo has ever touched cron, so a rebuild from
-- migrations comes up with the courts, sessions, commerce and clutch hold
-- sweep silently not running. That is the same class of defect as 0029's dead
-- publication, a capability that looks present and is not, so both jobs are
-- declared here.
--
-- IDEMPOTENT BY UNSCHEDULE THEN SCHEDULE, keyed on jobname. cron.schedule with
-- an existing name updates in place on pg_cron 1.4+, but unscheduling first
-- makes the migration correct on any version and makes a re-run a no op rather
-- than a duplicate.
--
-- TIMEZONE. pg_cron schedules in UTC. 22:00 UTC is 03:30 Asia/Kolkata, the
-- product timezone every date calculation in the coaching domain uses, so the
-- sweep runs at the quietest local hour and, critically, AFTER the local date
-- has already rolled over. A membership whose period_end was yesterday IST is
-- therefore expired on the first sweep of the new IST day, not a day late.
--
-- WHY DAILY AND NOT MORE OFTEN. Every stage of sweep_group_memberships keys
-- off a date, not a timestamp, so a second run inside the same IST day finds
-- nothing left to do. Running it more often would only add load and more
-- chances to double notify.
--
-- FAILURE VISIBILITY. cron.job_run_details records the return value of each
-- run, and sweep_group_memberships returns jsonb counters including per stage
-- failure counts, so a sweep that ran but silently did nothing is
-- distinguishable from one that worked:
--
--   select start_time, status, return_message
--     from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'membership-sweep')
--    order by start_time desc limit 10;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Deliberately hard failure rather than a silent skip. A scheduling
    -- migration that quietly no ops leaves an unswept fares model that looks
    -- scheduled: CLAUDE.md, a check that should apply but cannot run is a
    -- failure, not a skip. On Supabase, enable pg_cron in Database ->
    -- Extensions (or create extension pg_cron;) and re-run this migration.
    raise exception 'pg_cron is not installed; the membership sweep cannot be scheduled';
  end if;
end
$$;

-- The membership expiry and reminder sweep (0104).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'membership-sweep') then
    perform cron.unschedule('membership-sweep');
  end if;
  perform cron.schedule(
    'membership-sweep',
    '0 22 * * *',
    $job$select public.sweep_group_memberships();$job$
  );
end
$$;

-- The unpaid hold sweep (0038). Already running in production under exactly
-- this name, schedule and command; declared here so it survives a rebuild.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'expire-stale-holds') then
    perform cron.unschedule('expire-stale-holds');
  end if;
  perform cron.schedule(
    'expire-stale-holds',
    '*/5 * * * *',
    $job$select public.expire_stale_holds();$job$
  );
end
$$;
