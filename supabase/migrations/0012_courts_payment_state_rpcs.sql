-- ATLITOS v2 — 0012_courts_payment_state_rpcs.sql
-- Domain: courts + payments. Epic AT-4, AT-11.
--
-- Second half of the pair started in 0011_courts_payment_state.sql; read
-- that file's header first. This migration must be applied as its own
-- transaction, after 0011's `ALTER TYPE ... ADD VALUE` statements have
-- committed, since everything below references `pending_payment` and
-- `expired`.

-- ============================================================================
-- Widen the slot-release condition on the concurrency-guard unique index:
-- a cancelled booking already frees its slot (0009_courts.sql); an expired
-- one (payment never captured) must too, or an abandoned checkout would
-- permanently squat the slot. `pending_payment` deliberately still holds
-- the slot (unchanged) — that is what stops a second buyer from booking
-- the same slot while the first buyer's Razorpay checkout sheet is open.
-- ============================================================================

drop index public.court_bookings_court_date_slot_unique;

create unique index court_bookings_court_date_slot_unique
  on public.court_bookings (court_id, date, slot_start)
  where (status not in ('cancelled', 'expired'));

-- ============================================================================
-- court_booking_confirm_payment: pending_payment -> confirmed. Called only
-- by razorpay-webhook / verify-payment (service_role).
--
-- Not folded into the existing court_booking_transition RPC (granted to
-- `authenticated`, for the athlete/partner acting on their own booking): a
-- payment confirmation must only ever happen as a direct consequence of a
-- Razorpay-verified capture event, never as an action any authenticated
-- caller can trigger by calling an RPC with the right arguments. Revoked
-- from public/anon/authenticated, granted only to service_role, so this
-- keeps CLAUDE.md's "state machine transitions are enforced by a Postgres
-- RPC, never by client logic setting a status field" invariant intact even
-- for the service-role caller: the edge function still asks Postgres to
-- enforce pending_payment as the only valid starting state
-- (INVALID_TRANSITION otherwise) rather than issuing a raw
-- `update ... set status = 'confirmed'` itself.
--
-- Does not write ledger_entries (same rule 0009's court_booking_transition
-- already follows): ledger writes happen only in the edge function's own
-- TypeScript code, never inside a SQL function, matching CLAUDE.md's
-- financial invariant literally, not just in substance.
-- ============================================================================

create or replace function public.court_booking_confirm_payment(
  p_booking_id uuid,
  p_payment_intent_id uuid
)
returns public.court_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.court_bookings;
begin
  select * into v_booking from public.court_bookings where id = p_booking_id for update;

  if v_booking.id is null then
    raise exception 'NOT_FOUND: court_booking % does not exist', p_booking_id;
  end if;

  if v_booking.status <> 'pending_payment' then
    raise exception 'INVALID_TRANSITION: court_booking % is not pending_payment', p_booking_id;
  end if;

  update public.court_bookings
  set status = 'confirmed', payment_intent_id = p_payment_intent_id
  where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end;
$$;

revoke all on function public.court_booking_confirm_payment(uuid, uuid) from public;
revoke execute on function public.court_booking_confirm_payment(uuid, uuid) from anon, authenticated;
grant execute on function public.court_booking_confirm_payment(uuid, uuid) to service_role;

-- ============================================================================
-- court_booking_expire_payment: pending_payment -> expired. Not called by
-- any edge function in this task's scope; added because the task brief asks
-- for the transition to exist in the state machine now, so a future
-- scheduled cleanup job (PAYMENTS.md's "a scheduled cleanup ... can later
-- auto-cancel stale unpaid bookings", flagged there for P8 hardening) has
-- something to call rather than inventing this transition later. Same
-- service_role-only grant shape as the confirm path above.
-- ============================================================================

create or replace function public.court_booking_expire_payment(p_booking_id uuid)
returns public.court_bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.court_bookings;
begin
  select * into v_booking from public.court_bookings where id = p_booking_id for update;

  if v_booking.id is null then
    raise exception 'NOT_FOUND: court_booking % does not exist', p_booking_id;
  end if;

  if v_booking.status <> 'pending_payment' then
    raise exception 'INVALID_TRANSITION: court_booking % is not pending_payment', p_booking_id;
  end if;

  update public.court_bookings
  set status = 'expired'
  where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end;
$$;

revoke all on function public.court_booking_expire_payment(uuid) from public;
revoke execute on function public.court_booking_expire_payment(uuid) from anon, authenticated;
grant execute on function public.court_booking_expire_payment(uuid) to service_role;
