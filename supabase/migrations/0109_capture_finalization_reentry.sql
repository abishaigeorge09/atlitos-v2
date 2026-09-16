-- 0109_capture_finalization_reentry
-- The capture gate flipped the intent to captured BEFORE dispatching the domain
-- handler, so if the handler died after the UPDATE committed no future delivery
-- could ever re-enter it. Three repair checks in the codebase were dead by
-- construction, each with a docblock claiming it handled the case it could not
-- reach. Adds the finalization columns, the reconciliation queue, and moves the
-- gate into Postgres per the financial invariant in CLAUDE.md.
--
-- DEPLOYMENT ORDER IS LOAD BEARING: this migration must precede the edge
-- functions from the same change. Applied first, deliberately. Every new
-- function is service_role only and nothing here attaches a trigger, so this is
-- inert until _shared/finalize-payment.ts ships.

alter table public.payment_intents
  add column if not exists finalized_at timestamptz,
  add column if not exists finalize_claimed_at timestamptz,
  add column if not exists finalize_attempts integer not null default 0,
  add column if not exists finalize_last_error text;

comment on column public.payment_intents.finalized_at is
  '0109: set when the domain handler completed. status=captured with this null is a charge that took money and delivered nothing, which is the reconciliation queue P0-1 said did not exist.';
comment on column public.payment_intents.finalize_claimed_at is
  '0109: when the current finalization attempt claimed this intent. Stops a redelivery dispatching a handler that is still running; see reentry_stale_after below.';
comment on column public.payment_intents.finalize_attempts is
  '0109: how many times a handler has been dispatched for this intent. 1 is the normal case; higher means a previous attempt died.';
comment on column public.payment_intents.finalize_last_error is
  '0109: verbatim failure from the last dispatch, or null. Previously this only ever reached a console.error.';

-- BACKFILL, deliberately conservative. The 17 known-broken rows (captured
-- against a cancelled or declined session) would otherwise be re-entered every
-- five minutes forever, failing the status guard each time. Re-entry repairs a
-- run that DIED; it cannot repair a delivery that arrived after the entity was
-- already gone. Those rows need a refund, which is a decision, not a retry.
update public.payment_intents
set finalized_at = updated_at,
    finalize_attempts = 1
where status in ('captured', 'refunded', 'partially_refunded')
  and finalized_at is null;

create index if not exists idx_payment_intents_unfinalized
  on public.payment_intents (status, finalize_claimed_at)
  where finalized_at is null;

create or replace function public.finalize_reentry_after()
returns interval
language sql
immutable
as $$ select interval '15 minutes' $$;

revoke all on function public.finalize_reentry_after() from public;
revoke execute on function public.finalize_reentry_after() from anon, authenticated;
grant execute on function public.finalize_reentry_after() to service_role;

comment on function public.finalize_reentry_after() is
  '0109: how long a claimed but unfinalized capture waits before another delivery may re-enter its domain handler. Read by claim_payment_intent_for_finalization().';

create or replace view public.unfinalized_captures
with (security_invoker = true) as
select
  pi.id,
  pi.user_id,
  pi.domain,
  pi.entity_id,
  pi.amount,
  pi.razorpay_order_id,
  pi.razorpay_payment_id,
  pi.created_at,
  pi.finalize_claimed_at,
  pi.finalize_attempts,
  pi.finalize_last_error,
  now() - pi.created_at as stuck_for
from public.payment_intents pi
where pi.status = 'captured'
  and pi.finalized_at is null;

revoke all on public.unfinalized_captures from anon, authenticated;
grant select on public.unfinalized_captures to service_role;

comment on view public.unfinalized_captures is
  '0109: charges that took money and delivered nothing. Empty is the correct steady state; a non-empty row is money owed to somebody. service_role only.';

create or replace function public.claim_payment_intent_for_finalization(
  p_razorpay_order_id text,
  p_razorpay_payment_id text
)
returns public.payment_intents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.payment_intents;
begin
  update public.payment_intents pi
  set status = 'captured',
      razorpay_payment_id = coalesce(p_razorpay_payment_id, pi.razorpay_payment_id),
      finalize_claimed_at = now(),
      finalize_attempts = pi.finalize_attempts + 1
  where pi.razorpay_order_id = p_razorpay_order_id
    and (
      pi.status = 'created'
      or (
        pi.status = 'captured'
        and pi.finalized_at is null
        and (
          pi.finalize_claimed_at is null
          or pi.finalize_claimed_at < now() - public.finalize_reentry_after()
        )
      )
    )
  returning pi.* into v_intent;

  return v_intent;
end;
$$;

revoke all on function public.claim_payment_intent_for_finalization(text, text) from public;
revoke execute on function public.claim_payment_intent_for_finalization(text, text) from anon, authenticated;
grant execute on function public.claim_payment_intent_for_finalization(text, text) to service_role;

comment on function public.claim_payment_intent_for_finalization(text, text) is
  '0109: the shared capture gate. One atomic UPDATE claiming an intent that is created, or captured-but-unfinalized with a stale claim. Returns the claimed row, or a null-id row when another delivery holds it. service_role only.';

create or replace function public.mark_payment_intent_finalized(p_intent_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.payment_intents
  set finalized_at = now(),
      finalize_last_error = null
  where id = p_intent_id;
$$;

revoke all on function public.mark_payment_intent_finalized(uuid) from public;
revoke execute on function public.mark_payment_intent_finalized(uuid) from anon, authenticated;
grant execute on function public.mark_payment_intent_finalized(uuid) to service_role;

comment on function public.mark_payment_intent_finalized(uuid) is
  '0109: called by the capture gate once a domain handler returns successfully. Until this runs, the intent is in unfinalized_captures.';

create or replace function public.record_payment_intent_finalize_failure(
  p_intent_id uuid,
  p_error text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.payment_intents
  set finalize_last_error = left(p_error, 2000)
  where id = p_intent_id;
$$;

revoke all on function public.record_payment_intent_finalize_failure(uuid, text) from public;
revoke execute on function public.record_payment_intent_finalize_failure(uuid, text) from anon, authenticated;
grant execute on function public.record_payment_intent_finalize_failure(uuid, text) to service_role;

comment on function public.record_payment_intent_finalize_failure(uuid, text) is
  '0109: records why a domain handler failed, on the intent itself, so the failure is queryable instead of living only in a console.error. Deliberately does NOT set finalized_at, so the intent stays in the queue.';
