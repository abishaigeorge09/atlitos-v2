-- ATLITOS v2 — 0024_session_abandon_unpaid.sql
-- Domain: coaching payments. Epic AT-11, story AT-40.
-- Requirements: PRD-01 FR-24, PRD-02 FR-24.
--
-- One RPC: release a `requested` session whose payment could never be
-- started, so the slot it holds becomes bookable again.
--
-- Why this exists at all. book-session inserts the sessions row BEFORE it
-- calls Razorpay, deliberately: the partial unique index
-- `sessions_coach_date_slot_unique` is the only real guard against two
-- athletes buying the same slot, and it can only fire on an actual INSERT.
-- That ordering means a Razorpay failure (network, order rejected, key
-- misconfigured) leaves a `requested` session that no one can ever pay for,
-- squatting the slot. book-court hit the identical problem and solved it with
-- `court_booking_expire_payment` (0012); this is the same shape for sessions.
--
-- Why an RPC and not an UPDATE in the edge function. CLAUDE.md's financial
-- invariant: "state machine transitions on money-bearing entities are
-- enforced by Postgres RPCs, never by client logic setting a status field."
-- The edge function runs as service_role and could physically write the
-- column, which is exactly why the rule needs a function to route through:
-- the guard below (only `requested`, only when no payment has been captured)
-- is enforced by the database, not by whichever caller remembered to check.
--
-- Why `cancelled` and not a new enum value. 0018_coaching.sql header note 3
-- is explicit that session_status carries no pending_payment/expired value
-- and that adding one is a schema change to be raised rather than worked
-- around. `cancelled` already exists, is already excluded from the partial
-- unique index (so the slot frees immediately), and is already rendered by
-- every surface that lists sessions. The cancellation_reason text is what
-- distinguishes an abandoned checkout from a real cancellation in the UI and
-- in any later audit.
--
-- Grants: service_role only. This is not a user-facing action; an athlete
-- abandoning a checkout sheet does not call this, the edge function does when
-- its own Razorpay call failed. `authenticated` and `anon` get nothing, so
-- the function cannot be used to cancel someone else's pending session.

create or replace function public.session_abandon_unpaid(
  p_session_id uuid
)
returns public.sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.sessions;
  v_intent_status public.payment_intent_status;
begin
  select * into v_session
  from public.sessions
  where id = p_session_id
  for update;

  if v_session.id is null then
    raise exception 'NOT_FOUND: session % does not exist', p_session_id;
  end if;

  if v_session.status <> 'requested' then
    raise exception 'INVALID_TRANSITION: session % is not requested', p_session_id;
  end if;

  -- Never release a session whose money actually moved. The capture gate in
  -- _shared/finalize-payment.ts and this function can in principle race (a
  -- Razorpay call that timed out on our side but succeeded on theirs, then a
  -- webhook arriving); if the payment is captured, the athlete owns that slot
  -- and this call must fail loudly rather than silently free a paid booking.
  select pi.status into v_intent_status
  from public.payment_intents pi
  where pi.entity_id = p_session_id
    and pi.domain = 'session'
    and pi.status = 'captured'
  limit 1;

  if v_intent_status is not null then
    raise exception 'INVALID_TRANSITION: session % has a captured payment', p_session_id;
  end if;

  update public.sessions
  set status = 'cancelled',
      cancellation_reason = 'Payment was not started. This booking was released.'
  where id = p_session_id
  returning * into v_session;

  return v_session;
end;
$$;

revoke all on function public.session_abandon_unpaid(uuid) from public;
revoke execute on function public.session_abandon_unpaid(uuid) from anon, authenticated;
grant execute on function public.session_abandon_unpaid(uuid) to service_role;
