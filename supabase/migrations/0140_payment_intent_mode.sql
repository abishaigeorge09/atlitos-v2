-- ATLITOS v2 - 0140_payment_intent_mode.sql
--
-- Launch runbook stage 4. Production has run Razorpay in TEST mode, and test
-- payments sit in the same tables as real ones (328 payment intents and 532
-- ledger rows on 2026-09-29) with no way to tell them apart. Switching the keys
-- to live without this would turn every test booking into money the app
-- thinks it owes coaches and venues.
--
-- 1. payment_intents.razorpay_mode ('test' | 'live', not null). Every existing
--    row is backfilled as 'test'. Every edge function that creates an intent
--    writes the mode it is running in (razorpayMode() in _shared/razorpay.ts).
--    The column keeps a DEFAULT of 'test' only for the deploy window, so an
--    old function build still running cannot fail a booking while the mode is
--    still test. The default is DROPPED by 0141 at go live, after every intent
--    creating function is redeployed and BEFORE RAZORPAY_MODE=live: a real
--    payment stamped 'test' by a stale build would be ignored by the webhook
--    and the coach never paid (PAYMENTS.md, "Payment mode").
-- 2. Every read that turns ledger rows into a coach or venue BALANCE counts
--    only rows whose intent is live. Rows with no intent at all (manual
--    adjustments, payout debits, payout reversals) still count: they are
--    real. Filtered here, all with the same predicate
--      (le.payment_intent_id is null or pi.razorpay_mode = 'live'):
--      _ledger_eligible_balance      manual payout gate, admin payouts list
--      admin_payouts_due             admin payouts list
--      get_payout_account_balance    razorpay-route-transfer, record_transfer
--      get_coach_wallet_balance      coach Earnings screen (all four figures)
--      get_my_payout_method.balance  coach and venue payout details
--    admin_kpi_money counts live captures only. The reads deliberately left
--    unfiltered (UPA fund totals, transaction history) are listed with their
--    reasons in PAYMENTS.md, "Payment mode".
-- 3. razorpay-webhook ignores an event for an intent whose mode is not the
--    deployment's current mode (code, not SQL).
--
-- Every function below is create or replace with the signature, language,
-- volatility, security and search_path of its latest definition, and its
-- grants are restated exactly, so re-running this file before 0141 is a
-- no-op. Do not re-run it after 0141: it would put the 'test' default back.

alter table public.payment_intents
  add column if not exists razorpay_mode text;

update public.payment_intents set razorpay_mode = 'test' where razorpay_mode is null;

alter table public.payment_intents
  alter column razorpay_mode set default 'test',
  alter column razorpay_mode set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payment_intents_razorpay_mode_check'
  ) then
    alter table public.payment_intents
      add constraint payment_intents_razorpay_mode_check check (razorpay_mode in ('test', 'live'));
  end if;
end;
$$;

comment on column public.payment_intents.razorpay_mode is
  'Which Razorpay account the intent belongs to: test or live (0140). Only live intents count toward coach and venue payouts. Every row before 0140 is test.';


-- ---------------------------------------------------------------------------
-- 2. Payouts count live money only. Bodies are 0132 with the mode filter added.
-- ---------------------------------------------------------------------------
create or replace function public._ledger_eligible_balance(
  p_account_type public.ledger_account_type,
  p_account_ref uuid,
  p_hold interval default interval '24 hours'
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with credits as (
    select coalesce(sum(le.amount), 0) as amt
    from public.ledger_entries le
    left join public.court_bookings b
      on le.domain = 'court' and b.id = le.entity_id
    left join public.payment_intents pi on pi.id = le.payment_intent_id
    where le.account_type = p_account_type
      and (le.payment_intent_id is null or pi.razorpay_mode = 'live')
      and le.account_ref = p_account_ref
      and le.direction = 'credit'
      and case
        when le.domain = 'court' then
          b.id is not null
          and ((b.date + b.slot_end) at time zone 'Asia/Kolkata') <= now() - p_hold
        else le.created_at <= now() - p_hold
      end
  ),
  debits as (
    select coalesce(sum(le.amount), 0) as amt
    from public.ledger_entries le
    left join public.payment_intents pi on pi.id = le.payment_intent_id
    where le.account_type = p_account_type
      and le.account_ref = p_account_ref
      and le.direction = 'debit'
      and (le.payment_intent_id is null or pi.razorpay_mode = 'live')
  )
  select greatest(0, credits.amt - debits.amt)::numeric(12, 2)
  from credits, debits;
$$;

create or replace function public.admin_payouts_due(p_min_amount numeric default 1)
returns table (
  payout_account_id uuid,
  owner_type text,
  owner_id uuid,
  owner_name text,
  owner_phone text,
  payout_status text,
  method_type text,
  verification_status text,
  account_number_last4 text,
  ifsc text,
  vpa text,
  has_pan boolean,
  balance numeric,
  eligible_balance numeric,
  in_flight numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  return query
  with owed as (
    select le.account_type, le.account_ref,
           sum(case when le.direction = 'credit' then le.amount else -le.amount end) as bal
    from public.ledger_entries le
    left join public.payment_intents pi on pi.id = le.payment_intent_id
    where le.account_type in ('coach', 'court_partner') and le.account_ref is not null
      and (le.payment_intent_id is null or pi.razorpay_mode = 'live')
    group by le.account_type, le.account_ref
  )
  select
    pa.id,
    o.account_type::text,
    o.account_ref,
    case when o.account_type = 'coach' then u.name else v.name end,
    case when o.account_type = 'coach' then u.phone else pu.phone end,
    coalesce(pa.status::text, 'not_started'),
    pm.method_type,
    coalesce(pm.verification_status, 'missing'),
    right(pm.account_number, 4),
    pm.ifsc,
    pm.vpa,
    pm.pan is not null,
    o.bal::numeric(12, 2),
    public._ledger_eligible_balance(o.account_type, o.account_ref),
    coalesce((
      select sum(t.amount) from public.transfers t
      where t.payout_account_id = pa.id and t.status = 'processing'
    ), 0)::numeric(12, 2)
  from owed o
  left join public.payout_accounts pa
    on pa.owner_type = o.account_type::text and pa.owner_id = o.account_ref
  left join public.payout_methods pm on pm.payout_account_id = pa.id
  left join public.users u on o.account_type = 'coach' and u.id = o.account_ref
  left join public.venues v on o.account_type = 'court_partner' and v.id = o.account_ref
  left join public.users pu on pu.id = v.partner_user_id
  where o.bal >= p_min_amount
  order by public._ledger_eligible_balance(o.account_type, o.account_ref) desc, o.bal desc;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. The remaining balance reads. Same predicate as section 2. Without these,
--    test era credits would still be withdrawable through the Route transfer
--    path and would still show on the coach Earnings screen after go live.
-- ---------------------------------------------------------------------------

-- 0028 body with the mode filter. Used by razorpay-route-transfer (the amount
-- check before Razorpay is called) and by _record_payout_core when the hold is
-- not enforced (record_transfer, the Route path).
create or replace function public.get_payout_account_balance(
  p_payout_account_id uuid
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account public.payout_accounts;
  v_ledger_account public.ledger_account_type;
begin
  select * into v_account
  from public.payout_accounts
  where id = p_payout_account_id;

  if v_account.id is null then
    raise exception 'NOT_FOUND: payout account % does not exist', p_payout_account_id;
  end if;

  v_ledger_account := case v_account.owner_type
    when 'coach' then 'coach'::public.ledger_account_type
    when 'court_partner' then 'court_partner'::public.ledger_account_type
    else null
  end;

  if v_ledger_account is null then
    raise exception 'INTERNAL: payout account % has unmappable owner_type %',
      p_payout_account_id, v_account.owner_type;
  end if;

  return coalesce((
    select sum(case when le.direction = 'credit' then le.amount else -le.amount end)
    from public.ledger_entries le
    left join public.payment_intents pi on pi.id = le.payment_intent_id
    where le.account_type = v_ledger_account
      and le.account_ref = v_account.owner_id
      and (le.payment_intent_id is null or pi.razorpay_mode = 'live')
  ), 0)::numeric(12, 2);
end;
$$;

revoke all on function public.get_payout_account_balance(uuid) from public;
revoke execute on function public.get_payout_account_balance(uuid) from anon, authenticated;
grant execute on function public.get_payout_account_balance(uuid) to service_role;

-- 0025 body with the mode filter, applied to all four figures so balance,
-- lifetime earned, lifetime transferred and this month always agree.
create or replace function public.get_coach_wallet_balance()
returns table (
  balance numeric(12, 2),
  lifetime_earned numeric(12, 2),
  lifetime_transferred numeric(12, 2),
  this_month numeric(12, 2)
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_month_start timestamptz;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  if not exists (select 1 from public.coach_profiles cp where cp.user_id = v_uid) then
    raise exception 'NOT_COACH: caller holds no coach profile';
  end if;

  v_month_start := date_trunc('month', (now() at time zone 'Asia/Kolkata'))
                     at time zone 'Asia/Kolkata';

  return query
  select
    coalesce(sum(case when le.direction = 'credit' then le.amount else -le.amount end), 0)::numeric(12,2),
    coalesce(sum(le.amount) filter (where le.direction = 'credit'), 0)::numeric(12,2),
    coalesce(sum(le.amount) filter (where le.direction = 'debit'), 0)::numeric(12,2),
    coalesce(sum(le.amount) filter (
      where le.direction = 'credit' and le.created_at >= v_month_start
    ), 0)::numeric(12,2)
  from public.ledger_entries le
  left join public.payment_intents pi on pi.id = le.payment_intent_id
  where le.account_type = 'coach'
    and le.account_ref = v_uid
    and (le.payment_intent_id is null or pi.razorpay_mode = 'live');
end;
$$;

revoke all on function public.get_coach_wallet_balance() from public;
revoke execute on function public.get_coach_wallet_balance() from anon;
grant execute on function public.get_coach_wallet_balance() to authenticated;

-- 0132 body with the mode filter on 'balance'. 'eligible_balance' already
-- goes through _ledger_eligible_balance (section 2). portal-court's Earnings
-- page reads its pending balance from here rather than summing ledger rows
-- in the browser, so the filter lives in one place.
create or replace function public.get_my_payout_method(p_owner_type text, p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner_id uuid := public._resolve_my_payout_owner(p_owner_type, p_venue_id);
  v_account public.payout_accounts;
  v_method public.payout_methods;
  v_ledger public.ledger_account_type := p_owner_type::public.ledger_account_type;
begin
  select * into v_account from public.payout_accounts
  where owner_type = p_owner_type and owner_id = v_owner_id;

  if v_account.id is not null then
    select * into v_method from public.payout_methods where payout_account_id = v_account.id;
  end if;

  return jsonb_build_object(
    'payout_account_id', v_account.id,
    'payout_status', coalesce(v_account.status::text, 'not_started'),
    'method', public._payout_method_masked(v_method),
    'balance', coalesce((
      select sum(case when le.direction = 'credit' then le.amount else -le.amount end)
      from public.ledger_entries le
      left join public.payment_intents pi on pi.id = le.payment_intent_id
      where le.account_type = v_ledger
        and le.account_ref = v_owner_id
        and (le.payment_intent_id is null or pi.razorpay_mode = 'live')
    ), 0)::numeric(12, 2),
    'eligible_balance', public._ledger_eligible_balance(v_ledger, v_owner_id)
  );
end;
$$;

revoke all on function public.get_my_payout_method(text, uuid) from public, anon;
grant execute on function public.get_my_payout_method(text, uuid) to authenticated;

-- 0096 body with the mode filter. "Gross captured" means real money captured;
-- a test capture in the first week after go live must not inflate it.
create or replace function public.admin_kpi_money()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gmv numeric;
begin
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;

  select coalesce(sum(amount), 0)
  into v_gmv
  from public.payment_intents
  where status = 'captured'
    and razorpay_mode = 'live'
    and created_at >= now() - interval '7 days';

  return jsonb_build_object(
    'gmv_captured_7d', v_gmv,
    'window', '7d',
    'as_of', now()
  );
end;
$$;

revoke all on function public.admin_kpi_money() from public;
revoke execute on function public.admin_kpi_money() from anon;
grant execute on function public.admin_kpi_money() to authenticated;

-- Section 2's functions keep 0132's grants exactly (restated so this file is
-- self contained).
revoke all on function public._ledger_eligible_balance(public.ledger_account_type, uuid, interval) from public, anon, authenticated;
grant execute on function public._ledger_eligible_balance(public.ledger_account_type, uuid, interval) to service_role;
revoke all on function public.admin_payouts_due(numeric) from public, anon;
grant execute on function public.admin_payouts_due(numeric) to authenticated;
