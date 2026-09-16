-- 0093_rate_limit_and_ai_spend: CT-2 token bucket + CT-3 AI spend meter + budget flag. All service_role only.
create table if not exists public.edge_rate_limits (
  bucket text not null, key text not null, window_start timestamptz not null,
  count integer not null default 0, primary key (bucket, key, window_start));
comment on table public.edge_rate_limits is 'CT-2 token-bucket counter. One row per (bucket, key, window). service_role only. Fail-open is the caller''s job.';
alter table public.edge_rate_limits enable row level security;
revoke all on table public.edge_rate_limits from anon, authenticated;
grant select, insert, update, delete on table public.edge_rate_limits to service_role;

create or replace function public.take_rate_limit_token(p_bucket text, p_key text, p_max integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_window_start timestamptz; v_count integer;
begin
  if p_bucket is null or p_key is null or p_max is null or p_window_seconds is null then
    raise exception 'VALIDATION: bucket, key, max and window_seconds are all required'; end if;
  if p_max < 0 or p_window_seconds <= 0 then raise exception 'VALIDATION: max must be >= 0 and window_seconds > 0'; end if;
  v_window_start := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  delete from public.edge_rate_limits where bucket = p_bucket and key = p_key and window_start < v_window_start;
  insert into public.edge_rate_limits (bucket, key, window_start, count) values (p_bucket, p_key, v_window_start, 1)
  on conflict (bucket, key, window_start) do update set count = public.edge_rate_limits.count + 1
  returning count into v_count;
  return v_count <= p_max;
end; $$;
revoke all on function public.take_rate_limit_token(text, text, integer, integer) from public;
revoke execute on function public.take_rate_limit_token(text, text, integer, integer) from anon, authenticated;
grant execute on function public.take_rate_limit_token(text, text, integer, integer) to service_role;
comment on function public.take_rate_limit_token(text, text, integer, integer) is 'CT-2: atomic fixed-window token take. Returns false when the window is exhausted. service_role only. Caller must fail OPEN on error.';

create table if not exists public.ai_spend_daily (
  day date primary key, input_tokens bigint not null default 0,
  output_tokens bigint not null default 0, est_usd numeric not null default 0);
comment on table public.ai_spend_daily is 'CT-3 per-day AI (LLM) spend meter. service_role only.';
alter table public.ai_spend_daily enable row level security;
revoke all on table public.ai_spend_daily from anon, authenticated;
grant select, insert, update, delete on table public.ai_spend_daily to service_role;

create or replace function public.record_ai_spend(p_input_tokens integer, p_output_tokens integer, p_est_usd numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_total numeric;
begin
  if p_input_tokens is null or p_output_tokens is null or p_est_usd is null then
    raise exception 'VALIDATION: input_tokens, output_tokens and est_usd are all required'; end if;
  if p_input_tokens < 0 or p_output_tokens < 0 or p_est_usd < 0 then
    raise exception 'VALIDATION: token counts and est_usd must be non-negative'; end if;
  insert into public.ai_spend_daily (day, input_tokens, output_tokens, est_usd)
  values (current_date, p_input_tokens, p_output_tokens, p_est_usd)
  on conflict (day) do update set
    input_tokens = public.ai_spend_daily.input_tokens + excluded.input_tokens,
    output_tokens = public.ai_spend_daily.output_tokens + excluded.output_tokens,
    est_usd = public.ai_spend_daily.est_usd + excluded.est_usd
  returning est_usd into v_total;
  return v_total;
end; $$;
revoke all on function public.record_ai_spend(integer, integer, numeric) from public;
revoke execute on function public.record_ai_spend(integer, integer, numeric) from anon, authenticated;
grant execute on function public.record_ai_spend(integer, integer, numeric) to service_role;
comment on function public.record_ai_spend(integer, integer, numeric) is 'CT-3: upsert today''s AI spend row, return the day''s running est_usd total. service_role only.';

alter table public.feature_flags add column if not exists value_numeric numeric;
comment on column public.feature_flags.value_numeric is 'Optional numeric parameter for a flag whose semantics need a threshold (e.g. ai_search_daily_budget_usd). NULL for boolean-only flags.';
insert into public.feature_flags (key, description, enabled, value_numeric)
values ('ai_search_daily_budget_usd', 'Daily USD ceiling for ai-search LLM spend. Over this, ai-search degrades to keyword mode (never errors). Founder ratifies the number; default 10 applies if this row is absent.', true, 10)
on conflict (key) do nothing;

create or replace function public.ai_search_daily_budget()
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select value_numeric from public.feature_flags where key = 'ai_search_daily_budget_usd'), 10);
$$;
revoke all on function public.ai_search_daily_budget() from public;
revoke execute on function public.ai_search_daily_budget() from anon, authenticated;
grant execute on function public.ai_search_daily_budget() to service_role;
comment on function public.ai_search_daily_budget() is 'CT-3: effective daily AI budget in USD. Defaults to 10 when absent/null. service_role only.';
