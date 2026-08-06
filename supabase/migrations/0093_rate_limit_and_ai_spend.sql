-- ATLITOS v2 — 0093_rate_limit_and_ai_spend.sql
-- Domain: platform hardening (LAUNCH Phase 3). Items P1-5; contracts CT-2, CT-3.
-- Track A (Database).
--
-- Two pieces of scale infrastructure, both service_role only:
--
--   CT-2  public.take_rate_limit_token(bucket, key, max, window_seconds) -> bool
--         An atomic fixed-window token bucket backed by public.edge_rate_limits.
--         Edge isolates have no durable shared memory, so the counter lives in
--         Postgres (Settled decision 4: no Redis, no new infra). Returns false
--         when the window is exhausted. Buckets this phase: 'clip-playback-ip'
--         (CT-1) and 'ai-search-user' (CT-3).
--
--   CT-3  public.ai_spend_daily + public.record_ai_spend(...) + the
--         feature_flags key 'ai_search_daily_budget_usd' (default 10) and its
--         reader public.ai_search_daily_budget(). ai-search meters LLM spend and
--         degrades to keyword mode over budget (Settled decision 5: never a 500).
--
-- FAIL MODE (highest-risk item 4 in PHASE-3-STATUS.md): rate limiting is a scale
-- protection, NOT a security boundary. If take_rate_limit_token errors (a DB
-- hiccup), the CALLER (Track B) must fail OPEN for reads: serve, log, alert,
-- never 500 the feed. This function raises nothing on the hot path except a
-- genuine DB error, which the caller catches. The security boundaries elsewhere
-- fail CLOSED as always; this one does not, by design.

-- ============================================================================
-- CT-2: edge_rate_limits + take_rate_limit_token
-- ============================================================================

-- One row per (bucket, key, window_start). The fixed window is derived from
-- now() and p_window_seconds, so no scheduler is needed to roll windows.
create table if not exists public.edge_rate_limits (
  bucket text not null,
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket, key, window_start)
);

comment on table public.edge_rate_limits is
  'CT-2 token-bucket counter. One row per (bucket, key, window). service_role only; never client-readable or client-writable. Fail-open is the caller''s job, not this table''s.';

-- Nobody but service_role touches this table. RLS enabled with zero policies
-- (fail-closed, the stock_reservations/webhook_events house pattern), and the
-- grants are revoked from the client roles outright so a future careless policy
-- still cannot open a path.
alter table public.edge_rate_limits enable row level security;
revoke all on table public.edge_rate_limits from anon, authenticated;
grant select, insert, update, delete on table public.edge_rate_limits to service_role;

-- take_rate_limit_token: atomic fixed-window take.
--
-- The window boundary is floor(epoch / window_seconds) * window_seconds, so
-- every caller in the same wall-clock window lands on the same window_start and
-- shares one counter row. The INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING
-- is a single atomic statement: two concurrent isolates cannot both read a stale
-- count and both decide they are under the cap, because the row-level lock on
-- the conflicting upsert serialises them. Returns true while count <= p_max,
-- false once the window is exhausted.
--
-- Stale windows for the same (bucket, key) are deleted opportunistically so the
-- table never accumulates one row per historical window per key.
create or replace function public.take_rate_limit_token(
  p_bucket text,
  p_key text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_bucket is null or p_key is null or p_max is null or p_window_seconds is null then
    raise exception 'VALIDATION: bucket, key, max and window_seconds are all required';
  end if;
  if p_max < 0 or p_window_seconds <= 0 then
    raise exception 'VALIDATION: max must be >= 0 and window_seconds > 0';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  -- Drop any earlier window rows for this exact key so the table stays O(1) per
  -- active key rather than growing one row per elapsed window.
  delete from public.edge_rate_limits
  where bucket = p_bucket
    and key = p_key
    and window_start < v_window_start;

  insert into public.edge_rate_limits (bucket, key, window_start, count)
  values (p_bucket, p_key, v_window_start, 1)
  on conflict (bucket, key, window_start)
  do update set count = public.edge_rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

-- SECURITY DEFINER, EXECUTE granted to service_role ONLY (CT-2). Revoked from
-- public and both client roles explicitly: 'revoke ... from public' alone does
-- NOT remove the named anon/authenticated grants this project's default
-- privileges hand out (0089 lesson), so each is revoked by name.
revoke all on function public.take_rate_limit_token(text, text, integer, integer) from public;
revoke execute on function public.take_rate_limit_token(text, text, integer, integer) from anon, authenticated;
grant execute on function public.take_rate_limit_token(text, text, integer, integer) to service_role;

comment on function public.take_rate_limit_token(text, text, integer, integer) is
  'CT-2: atomic fixed-window token take. Returns false when the window is exhausted. service_role only. Caller must fail OPEN on error (scale guard, not a security boundary).';

-- ============================================================================
-- CT-3: ai_spend_daily + record_ai_spend
-- ============================================================================

create table if not exists public.ai_spend_daily (
  day date primary key,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  est_usd numeric not null default 0
);

comment on table public.ai_spend_daily is
  'CT-3 per-day AI (LLM) spend meter. service_role only. record_ai_spend upserts today''s row; ai-search reads the day total to decide keyword vs llm mode.';

alter table public.ai_spend_daily enable row level security;
revoke all on table public.ai_spend_daily from anon, authenticated;
grant select, insert, update, delete on table public.ai_spend_daily to service_role;

-- record_ai_spend: upsert today's row, return the running est_usd total for the
-- day (the value ai-search compares against the budget flag before its next
-- LLM call).
create or replace function public.record_ai_spend(
  p_input_tokens integer,
  p_output_tokens integer,
  p_est_usd numeric
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
begin
  if p_input_tokens is null or p_output_tokens is null or p_est_usd is null then
    raise exception 'VALIDATION: input_tokens, output_tokens and est_usd are all required';
  end if;
  if p_input_tokens < 0 or p_output_tokens < 0 or p_est_usd < 0 then
    raise exception 'VALIDATION: token counts and est_usd must be non-negative';
  end if;

  insert into public.ai_spend_daily (day, input_tokens, output_tokens, est_usd)
  values (current_date, p_input_tokens, p_output_tokens, p_est_usd)
  on conflict (day)
  do update set
    input_tokens = public.ai_spend_daily.input_tokens + excluded.input_tokens,
    output_tokens = public.ai_spend_daily.output_tokens + excluded.output_tokens,
    est_usd = public.ai_spend_daily.est_usd + excluded.est_usd
  returning est_usd into v_total;

  return v_total;
end;
$$;

revoke all on function public.record_ai_spend(integer, integer, numeric) from public;
revoke execute on function public.record_ai_spend(integer, integer, numeric) from anon, authenticated;
grant execute on function public.record_ai_spend(integer, integer, numeric) to service_role;

comment on function public.record_ai_spend(integer, integer, numeric) is
  'CT-3: upsert today''s AI spend row, return the day''s running est_usd total. service_role only.';

-- ============================================================================
-- CT-3: the budget flag and its reader
--
-- feature_flags carries only enabled/description today, so it has nowhere to
-- hold a numeric threshold. Add a nullable value_numeric column (additive, no
-- existing flag is affected) and seed the budget row at 10. The reader returns
-- 10 when the row is missing OR its value is null, so "a missing flag means the
-- default applies, not unlimited" (CT-3) is encoded in one place.
-- ============================================================================

alter table public.feature_flags
  add column if not exists value_numeric numeric;

comment on column public.feature_flags.value_numeric is
  'Optional numeric parameter for a flag whose semantics need a threshold (e.g. ai_search_daily_budget_usd). NULL for boolean-only flags.';

insert into public.feature_flags (key, description, enabled, value_numeric)
values (
  'ai_search_daily_budget_usd',
  'Daily USD ceiling for ai-search LLM spend. Over this, ai-search degrades to keyword mode (never errors). Founder ratifies the number; default 10 applies if this row is absent.',
  true,
  10
)
on conflict (key) do nothing;

-- ai_search_daily_budget(): the single source of the effective budget. Reads the
-- flag, falls back to 10 when the row is missing or value_numeric is null.
-- SECURITY DEFINER so the service-role caller (Track B) does not depend on the
-- admin/moderator-only read policy on feature_flags; granted to service_role
-- only, matching the rest of this file's spend infra.
create or replace function public.ai_search_daily_budget()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value_numeric from public.feature_flags where key = 'ai_search_daily_budget_usd'),
    10
  );
$$;

revoke all on function public.ai_search_daily_budget() from public;
revoke execute on function public.ai_search_daily_budget() from anon, authenticated;
grant execute on function public.ai_search_daily_budget() to service_role;

comment on function public.ai_search_daily_budget() is
  'CT-3: effective daily AI budget in USD. Reads feature_flags.value_numeric for ai_search_daily_budget_usd, defaults to 10 when absent/null. service_role only.';
