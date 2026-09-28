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
--    The column keeps a DEFAULT of 'test' only so that an old function build
--    still running during the deploy window cannot fail a booking; the safe
--    direction for a missed stamp is "not owed". Drop the default once every
--    payment function is redeployed (PAYMENTS.md, "Payment mode").
-- 2. _ledger_eligible_balance and admin_payouts_due count only ledger rows
--    whose intent is live. Rows with no intent at all (manual adjustments,
--    payout debits recorded by an admin) still count: they are real.
-- 3. razorpay-webhook ignores an event for an intent whose mode is not the
--    deployment's current mode (code, not SQL).

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
