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
-- IDEMPOTENCY DIFFERS PER JOB, deliberately. membership-sweep is unschedule
-- then schedule, keyed on jobname: it is this migration's own job end to
-- end, so dropping and recreating it on a re-run is safe and keeps the
-- command text in sync with whatever this file says today.
-- expire-stale-holds is create-if-absent only: see the long comment above
-- that block for why this migration must never unschedule a job it did not
-- create.
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
-- this name, schedule and command; declared here so a rebuild from
-- migrations comes up with it too.
--
-- DELIBERATELY NOT unschedule-then-schedule here, unlike membership-sweep
-- above. That pattern is safe for a job this migration itself owns end to
-- end, and unsafe for one that already exists on a live cluster it did not
-- create:
--
--   1. cron.unschedule deletes the row from cron.job and, on the versions
--      this product has run, its cron.job_run_details history goes with it.
--      Reapplying then creates a NEW jobid, so every prior run of
--      expire-stale-holds, going back to 0038, is gone and the job's
--      identity changes under any tooling or dashboard that pinned to
--      jobid 1.
--   2. cron.unschedule and cron.schedule both require the calling role to
--      own the job (or be superuser). The role that ran migration 0038
--      against production is not guaranteed to be the role that applies
--      this one; if it differs, cron.unschedule fails outright before this
--      migration's own membership-sweep job is even reached, since this
--      whole file runs in one transaction.
--
-- So this block only ever CREATES the job, and only when it is absent,
-- which is true exactly once: a fresh cluster rebuilt from migrations with
-- no jobs yet. On production, where the job already exists with this exact
-- name, schedule and command (verified above), this is a no op: no
-- unschedule, no new jobid, no history dropped, no ownership requirement.
-- If a future change needs to alter expire-stale-holds' schedule or
-- command, that migration must decide explicitly how to carry the
-- existing job's history and confirm the applying role owns it first,
-- not inherit this file's silence on the question.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'expire-stale-holds') then
    perform cron.schedule(
      'expire-stale-holds',
      '*/5 * * * *',
      $job$select public.expire_stale_holds();$job$
    );
  end if;
end
$$;
