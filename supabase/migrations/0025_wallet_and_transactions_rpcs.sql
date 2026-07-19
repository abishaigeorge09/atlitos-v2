-- ATLITOS v2 — 0025_wallet_and_transactions_rpcs.sql
-- Domain: payments read path. Epic AT-11, story AT-44.
-- Requirements: PRD-02 FR-26 (coach earnings balance), PRD-01 FR-67 (player
-- payments ledger).
--
-- Two read-only RPCs. Neither introduces a stored balance anywhere: every
-- number either function returns is computed at call time by summing
-- `ledger_entries` or by reading `payment_intents`, so a client can never
-- drift from the ledger and there is no denormalized column to keep in sync.
-- This is SCHEMA.md's "the double-entry ledger, summarized" restated as an
-- API: a coach's balance is `sum(credits) - sum(debits)` where
-- `account_type='coach' and account_ref = <coach_id>`, full stop.
--
-- Both are `security definer` and both derive the caller from `auth.uid()`
-- only. No function here takes an owner id parameter, because a parameter is
-- something a client can lie about; `ledger_entries` also has RLS
-- (`ledger_entries_select_own`, 0010) but a definer function bypasses it, so
-- the scoping has to be re-established in the function body and it is, in the
-- WHERE clause of every query below.
--
-- Deviation from the AT-44 ticket text, recorded deliberately. The ticket
-- describes `get_my_transactions(kind?)` as "unions sessions, court_bookings,
-- orders, and donations into one reverse-chronological feed". Two of those
-- four tables do not exist yet (P4 commerce, P5/P6 donations), and unioning
-- domain tables would mean this function needs editing every time a domain
-- ships. `payment_intents` already carries exactly the columns the feed needs
-- (domain, entity_id, amount, status, created_at) for every domain including
-- the ones not yet built, and it is the row a charge actually creates. So the
-- player-facing feed is built from `payment_intents` (the caller's own
-- charges) and the coach/partner-facing feed from `ledger_entries` (their own
-- earnings and transfers), unioned. When commerce and donations ship they
-- appear in this feed with no change to this function. The brief's binding
-- constraint, "derived, never a stored balance column", is satisfied either
-- way; the ticket's specific table list is not.

-- ============================================================================
-- get_coach_wallet_balance()
-- ============================================================================
--
-- PRD-02 FR-26. NOT_COACH rather than an empty result when the caller holds
-- no coach role, per API-MAPPING.md's wallet row: an athlete hitting this
-- endpoint is a bug in the caller, not a coach with zero earnings, and the
-- two must be distinguishable.
--
-- `balance` is what the coach may transfer out today: credits (accruals from
-- completed sessions) minus debits (transfers already taken). `lifetime_earned`
-- and `lifetime_transferred` are the two halves separately, so the Earnings
-- screen can show them without a second round trip. `this_month` counts only
-- credits in the current calendar month in Asia/Kolkata, matching the
-- timezone session_transition already uses for its own date arithmetic.

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
  where le.account_type = 'coach'
    and le.account_ref = v_uid;
end;
$$;

revoke all on function public.get_coach_wallet_balance() from public;
revoke execute on function public.get_coach_wallet_balance() from anon;
grant execute on function public.get_coach_wallet_balance() to authenticated;

-- ============================================================================
-- get_my_transactions(p_kind, p_limit, p_offset)
-- ============================================================================
--
-- PRD-01 FR-67 (the player's Account > Payments ledger) and the coach's
-- earnings history in one function, because they are the same question asked
-- by two roles: "what money moved that involved me".
--
-- Rows come from two sources, both scoped to the caller:
--
--   `charge`   — a row in `payment_intents` where `user_id = auth.uid()`.
--                This is the player's side: a session booked, a court booked,
--                and later a gear order or a donation, with no change here.
--   `earning`  — a `credit` in `ledger_entries` for the caller's coach or
--     /`payout`  court_partner account, and `debit` respectively (a transfer
--                out). This is the coach's and partner's side.
--
-- `p_kind` filters on the returned `kind` column ('charge', 'earning',
-- 'payout') or, when it matches a `payment_domain` value ('session', 'court',
-- 'commerce', 'donation'), on the domain. Null returns everything.
--
-- `direction` is from the CALLER's point of view, not the ledger's: money
-- leaving them is 'out', money owed to or paid to them is 'in'. A player's
-- charge is always 'out'; the ledger's own debit/credit convention is an
-- accounting detail this feed deliberately does not leak into the UI.

create or replace function public.get_my_transactions(
  p_kind text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  kind text,
  domain public.payment_domain,
  entity_id uuid,
  amount numeric(12, 2),
  direction text,
  status text,
  description text,
  occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: no session';
  end if;

  return query
  with feed as (
    -- The caller's own charges (player side).
    select
      pi.id,
      'charge'::text as kind,
      pi.domain,
      pi.entity_id,
      pi.amount,
      'out'::text as direction,
      pi.status::text as status,
      initcap(pi.domain::text) || ' payment' as description,
      pi.created_at as occurred_at
    from public.payment_intents pi
    where pi.user_id = v_uid

    union all

    -- The caller's own ledger movements (coach side, and court partner side
    -- via the venues they own, which is the same scoping
    -- ledger_entries_select_own uses in 0010).
    select
      le.id,
      case when le.direction = 'credit' then 'earning' else 'payout' end as kind,
      le.domain,
      le.entity_id,
      le.amount,
      case when le.direction = 'credit' then 'in' else 'out' end as direction,
      'settled'::text as status,
      le.description,
      le.created_at as occurred_at
    from public.ledger_entries le
    where (le.account_type = 'coach' and le.account_ref = v_uid)
       or (
         le.account_type = 'court_partner'
         and exists (
           select 1 from public.venues v
           where v.id = le.account_ref and v.partner_user_id = v_uid
         )
       )
  )
  select f.id, f.kind, f.domain, f.entity_id, f.amount, f.direction,
         f.status, f.description, f.occurred_at
  from feed f
  where p_kind is null
     or f.kind = p_kind
     or f.domain::text = p_kind
  order by f.occurred_at desc, f.id desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.get_my_transactions(text, int, int) from public;
revoke execute on function public.get_my_transactions(text, int, int) from anon;
grant execute on function public.get_my_transactions(text, int, int) to authenticated;
