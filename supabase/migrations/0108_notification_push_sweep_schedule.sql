-- ATLITOS v2 — 0108_notification_push_sweep_schedule.sql
-- Domain: scheduling. Runs the R-7 push relay.
--
-- NOT APPLIED. Written, not run. And note the hard precondition below: this
-- migration REFUSES to install a job it cannot authenticate, rather than
-- installing one that would 403 silently every 30 seconds.
--
-- ============================================================================
-- WHAT RUNS, AND WHY IT IS pg_net.
-- ============================================================================
--
-- 0107 leaves unpushed notifications on the table. Something has to hand them
-- to notify-push-sweep, and pg_cron cannot make an HTTP call by itself. On
-- Supabase the only in-database HTTP transport is pg_net, which is also what
-- Database Webhooks are built on (supabase_functions.http_request wraps it).
-- So the sweeper and the webhook alternative both need pg_net; that dependency
-- was never a reason to choose one over the other.
--
-- VERIFIED AGAINST PRODUCTION 2026-08-14, read only:
--
--   select extname, extversion from pg_extension
--    where extname in ('pg_net','pg_cron','supabase_vault');
--     -> pg_cron 1.6.4, supabase_vault 0.3.1. pg_net IS NOT INSTALLED.
--
--   select name from vault.secrets;   -> zero rows.
--
-- Both of those are the reason for the guards below rather than a silent
-- `create extension if not exists`.
--
-- ============================================================================
-- SECRETS. Two rows a human must add BEFORE this migration can be applied.
-- ============================================================================
--
-- The job posts to an edge function as the service role, so the schedule needs
-- the project URL and the service-role key. Neither belongs in a migration
-- file in git. They go in Supabase Vault, and this migration only reads them:
--
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url',
--     'Base URL for in-database calls to edge functions');
--   select vault.create_secret('<service-role key>', 'service_role_key',
--     'Service role key used by pg_cron jobs that call edge functions');
--
-- Run those two statements once, as a human, against the project. They are
-- writes, so this track did not run them.
--
-- Why fail rather than skip: a job installed without a usable key would run
-- every 30 seconds, receive 403 from assertServiceRoleRequest, and record that
-- only in net._http_response, which nobody reads. Every notification would
-- keep pushing nothing while cron.job showed a healthy active job. A check
-- that should apply but cannot run is a failure, not a skip.

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception
      'pg_cron is not installed; the notification push sweep cannot be scheduled';
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception
      'pg_net is not installed; enable it (Database, Extensions, pg_net) before applying 0108. Without it nothing can call notify-push-sweep from the database.';
  end if;

  if not exists (select 1 from vault.secrets where name = 'project_url') then
    raise exception
      'vault secret project_url is missing; see the header of 0108 for the two vault.create_secret calls this job needs';
  end if;

  if not exists (select 1 from vault.secrets where name = 'service_role_key') then
    raise exception
      'vault secret service_role_key is missing; see the header of 0108 for the two vault.create_secret calls this job needs';
  end if;
end;
$$;

-- ============================================================================
-- THE JOB.
-- ============================================================================
--
-- Every 30 seconds. pg_cron 1.5 and later accept a seconds interval as the
-- schedule string, and 1.6.4 is installed. The interval is the notification's
-- worst-case delivery latency, so it is a product number, not an arbitrary
-- one: half a minute is invisible for "your coach started your session" and
-- for a 03:30 membership reminder, and it keeps the claim batches small.
--
-- The job body is one net.http_post. pg_net is asynchronous: it enqueues the
-- request and returns immediately, so the cron worker is never blocked on
-- Expo, and no session transaction is ever involved. The function claims,
-- pushes and checkpoints on its own; if this POST is lost entirely, the rows
-- keep `pushed_at is null` and the next tick 30 seconds later takes them.
-- That is the resumability the sweeper was chosen for, and it holds even when
-- the transport itself fails.

do $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key';

  if exists (select 1 from cron.job where jobname = 'notification-push-sweep') then
    perform cron.unschedule('notification-push-sweep');
  end if;

  perform cron.schedule(
    'notification-push-sweep',
    '30 seconds',
    format(
      $job$select net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := '{}'::jsonb,
        timeout_milliseconds := 25000
      );$job$,
      rtrim(v_url, '/') || '/functions/v1/notify-push-sweep',
      jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      )::text
    )
  );
end;
$$;

-- ============================================================================
-- HOW TO SEE IT WORKING, and how to see it failing.
-- ============================================================================
--
--   select jobid, jobname, schedule, active from cron.job;
--
--   select status, return_message, start_time
--     from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'notification-push-sweep')
--    order by start_time desc limit 10;
--
-- cron.job_run_details only proves the POST was ENQUEUED. The POST's own
-- outcome is in pg_net's response table, and this is the query to reach for
-- when pushes are missing but the job looks healthy:
--
--   select id, status_code, content, created
--     from net._http_response
--    order by created desc limit 10;
--
-- And the backlog itself, which is the number that actually matters:
--
--   select count(*) as owed, min(created_at) as oldest
--     from public.notifications where pushed_at is null;
--
-- A steadily growing `owed` with a healthy job means the function is failing,
-- not the schedule. At the derived steady state of 6,700 notifications a day
-- this number should sit near zero and never exceed one claim batch.
