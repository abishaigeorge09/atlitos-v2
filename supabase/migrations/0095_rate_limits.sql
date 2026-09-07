-- 0095_rate_limits.sql
--
-- SEC-F9. `ai-search` calls Anthropic twice per request (llmParseIntent,
-- llmRerank) once ANTHROPIC_API_KEY is set, behind `verify_jwt` only. Since
-- 0008 anyone can mint an anonymous session, so "authenticated" is not a cost
-- boundary: a script can hold a guest token and spend the key in a loop.
--
-- The exposure is latent only while the key is unset. It becomes real the day
-- the key is added, which is exactly the wrong day to be writing this.
--
-- FIXED WINDOW, not a sliding window or token bucket. A fixed window admits up
-- to 2x the limit across a boundary, which for a spend ceiling is a rounding
-- error, and it costs one upsert against a primary key instead of a row per
-- request plus a sweep. The upgrade path if that stops being true is a sliding
-- window over the same table.
-- ponytail: fixed window, swap for sliding if boundary bursts ever matter.

create table public.rate_limit_counters (
  bucket_key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket_key, window_start)
);

-- RLS on with NO policy: this table is service-role only. Every read and write
-- goes through the SECURITY DEFINER function below, so no client ever touches
-- it directly and there is nothing for a policy to permit.
alter table public.rate_limit_counters enable row level security;
revoke all on public.rate_limit_counters from anon, authenticated;

create index idx_rate_limit_counters_window on public.rate_limit_counters (window_start);

/**
 * Returns true when the caller may proceed, false when they are over the limit.
 *
 * The increment and the test are ONE statement, so two concurrent requests
 * cannot both read "count = limit - 1" and both proceed. That race is the
 * entire reason this is a database function and not two round trips.
 */
create or replace function public.rate_limit_hit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );
  v_count integer;
begin
  insert into public.rate_limit_counters (bucket_key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (bucket_key, window_start)
    do update set count = public.rate_limit_counters.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

comment on function public.rate_limit_hit(text, integer, integer) is
  'SEC-F9 fixed-window rate limiter. Increments and tests in one statement so concurrent callers cannot both pass the last slot. service_role only: enforcement belongs in edge functions, before the expensive work.';

/**
 * Old windows are dead weight. Called from the existing cron sweep rather than
 * given its own schedule, so there is one sweep to reason about.
 */
create or replace function public.prune_rate_limit_counters()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limit_counters
    where window_start < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_rate_limit_counters() from public, anon, authenticated;
grant execute on function public.prune_rate_limit_counters() to service_role;

-- ============================================================================
-- Wire the prune into the EXISTING sweep rather than adding a second cron job.
--
-- Replays 0088's version of expire_stale_holds() verbatim with one arm added,
-- because `create or replace` needs the whole body and this table would
-- otherwise grow one row per key per window forever. Nothing else changes:
-- same declarations, same order, same return keys plus one.
-- ============================================================================

create or replace function public.expire_stale_holds()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - public.unpaid_hold_ttl();
  v_courts int := 0;
  v_court_failures int := 0;
  v_sessions int := 0;
  v_session_failures int := 0;
  v_reservations int := 0;
  v_clips jsonb;
  v_unfinalized int := 0;
  v_unfinalized_no_ledger int := 0;
  v_rate_limit_rows int := 0;
  v_id uuid;
begin
  -- Courts.
  for v_id in
    select b.id
    from public.court_bookings b
    where b.status = 'pending_payment'
      and b.created_at <= v_cutoff
  loop
    begin
      perform public.court_booking_expire_payment(v_id);
      v_courts := v_courts + 1;
    exception when others then
      v_court_failures := v_court_failures + 1;
    end;
  end loop;

  -- Sessions. The payment intent, not the age of the session row, is what makes
  -- one stale (a paid session sits in `requested` legitimately for days).
  for v_id in
    select s.id
    from public.sessions s
    where s.status = 'requested'
      and exists (
        select 1 from public.payment_intents pi
        where pi.entity_id = s.id
          and pi.domain = 'session'
          and pi.status = 'created'
          and pi.created_at <= v_cutoff
      )
      and not exists (
        select 1 from public.payment_intents pi
        where pi.entity_id = s.id
          and pi.domain = 'session'
          and pi.status = 'captured'
      )
  loop
    begin
      perform public.session_abandon_unpaid(v_id);
      v_sessions := v_sessions + 1;
    exception when others then
      v_session_failures := v_session_failures + 1;
    end;
  end loop;

  -- Commerce. Set-based.
  v_reservations := public.release_expired_stock_reservations();

  -- Clutch. The fourth arm (AT-93): reclaim stranded clips. Its own 30 minute
  -- TTL is independent of the unpaid-hold TTL, so it is computed inside
  -- reconcile_stranded_clips rather than sharing v_cutoff.
  v_clips := public.reconcile_stranded_clips();

  -- Payments. The fifth arm (SEC-F2): captured money whose downstream work is
  -- still owed. Report-only, see payment_finalization_backlog.
  select count(*), count(*) filter (where not b.has_ledger_group)
    into v_unfinalized, v_unfinalized_no_ledger
  from public.payment_finalization_backlog() b;

  -- 0095: drop rate limit windows older than a day. Same sweep, one more arm.
  v_rate_limit_rows := public.prune_rate_limit_counters();

  return jsonb_build_object(
    'ran_at', now(),
    'cutoff', v_cutoff,
    'court_bookings_expired', v_courts,
    'court_bookings_failed', v_court_failures,
    'sessions_abandoned', v_sessions,
    'sessions_failed', v_session_failures,
    'stock_reservations_released', v_reservations,
    'clips_readied', v_clips -> 'clips_readied',
    'clips_rejected', v_clips -> 'clips_rejected',
    'clips_failed', v_clips -> 'clips_failed',
    'payments_unfinalized', v_unfinalized,
    'payments_unfinalized_without_ledger', v_unfinalized_no_ledger,
    'rate_limit_rows_pruned', v_rate_limit_rows
  );
end;
$$;
