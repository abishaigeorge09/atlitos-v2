-- ATLITOS v2 — 0109_capture_finalization_reentry.sql
-- Domain: payments, the shared capture gate.
--
-- WRITTEN, NOT APPLIED. The DB write gate forbids applying it.
--
-- DEPLOYMENT ORDER IS LOAD BEARING. This migration must be applied BEFORE the
-- edge functions from the same change are deployed. _shared/finalize-payment.ts
-- filters and writes the four columns added here; deploying it against a
-- database without them makes every capture fail at the gate. Migration first,
-- then `supabase functions deploy`. There is no version of this that is safe in
-- the other order.
--
-- ============================================================================
-- THE DEFECT: the repair comments are unreachable dead code
-- ============================================================================
--
-- _shared/finalize-payment.ts flips the intent to `captured` and only then
-- dispatches to the domain handler:
--
--   .update({ status: "captured", ... }).eq("status", "created")
--
-- That gives at-most-once, which is correct and must be kept. It also means
-- that if the handler dies after the UPDATE commits, no future delivery can
-- ever re-enter it, because the intent is no longer `created`. Both entry
-- points, razorpay-webhook and verify-payment, go through this one gate.
--
-- So three repair checks in the codebase are dead by construction, each with a
-- docblock claiming it handles the case it cannot reach:
--
--   finalize-membership-payment.ts:32  "covers a previous run that died between"
--   finalize-order-payment.ts:46       "a redelivered webhook repairs the books"
--   finalize-donation-payment.ts:94    "a redelivery cannot double-credit"
--
-- A false comment is worse than no comment: it is the reason nobody built the
-- reconciliation, because the code appeared to already have it.
--
-- ============================================================================
-- THE FIX, and why it is not "just reorder the two statements"
-- ============================================================================
--
-- Dispatching first and flipping afterwards would make the comments true and
-- break at-most-once: two concurrent deliveries (the webhook and
-- verify-payment fire for the same order by design) would both see `created`
-- and both run the handler, and only the ledger existence checks would stand
-- between that and a double credit. Trading a recoverable failure for an
-- unrecoverable one is not a fix.
--
-- Instead the gate keeps its single atomic claim and gains a second axis:
--
--   status         did the money move          (unchanged semantics)
--   finalized_at   did the domain handler finish successfully   (new)
--
-- The claim becomes: match an intent that is `created`, OR one that is
-- `captured` with finalized_at still null whose last claim is older than the
-- retry window. Still one atomic UPDATE, so the row lock still serialises
-- concurrent deliveries and exactly one can win at any instant. A run that
-- dies leaves finalized_at null, and the next delivery or sweep re-enters it,
-- at which point the three repair checks above are reached and do their job
-- for the first time.
--
-- The retry window exists so that a delivery arriving while another is still
-- mid-handler does not double-dispatch. It is deliberately longer than any
-- handler's worst case.
--
-- ============================================================================
-- AND THE THING THAT DID NOT EXIST AT ALL: a queue
-- ============================================================================
--
-- VERIFICATION-WAVE-1 P0-1: "nothing scans for the damage", and webhook_events
-- has no status or error column to poll. finalized_at is that scan surface.
-- `status = 'captured' and finalized_at is null` is the list of charges that
-- took money and delivered nothing, which no query could previously produce.
-- finalize_last_error says why, finalize_attempts says how many times it has
-- been tried.
--
-- This migration provides the surface and the index. It does NOT schedule a
-- reconciliation job, because a sweep that re-enters handlers is a behaviour
-- change that needs its own design (what it does with an intent that can never
-- succeed, such as a capture against a cancelled session, is the refund
-- question in PAYMENTS.md, not a scheduling question).

alter table public.payment_intents
  -- Set by the gate once the domain handler returns successfully. Null on a
  -- captured row means: the money moved and the product has not delivered.
  add column if not exists finalized_at timestamptz,
  -- When the current attempt claimed the intent. Used only to stop two
  -- deliveries dispatching at once; it is not a lock and does not need to be.
  add column if not exists finalize_claimed_at timestamptz,
  add column if not exists finalize_attempts integer not null default 0,
  -- The last handler failure, verbatim. The one place that previously existed
  -- for this was a console.error inside razorpay-webhook's catch.
  add column if not exists finalize_last_error text;

comment on column public.payment_intents.finalized_at is
  '0109: set when the domain handler completed. status=captured with this null is a charge that took money and delivered nothing, which is the reconciliation queue P0-1 said did not exist.';
comment on column public.payment_intents.finalize_claimed_at is
  '0109: when the current finalization attempt claimed this intent. Stops a redelivery dispatching a handler that is still running; see reentry_stale_after below.';
comment on column public.payment_intents.finalize_attempts is
  '0109: how many times a handler has been dispatched for this intent. 1 is the normal case; higher means a previous attempt died.';
comment on column public.payment_intents.finalize_last_error is
  '0109: verbatim failure from the last dispatch, or null. Previously this only ever reached a console.error.';

-- ============================================================================
-- BACKFILL. Every intent that is already past `created` is marked finalized.
--
-- This is deliberately conservative and it is the opposite of what a naive
-- reading would want. The 17 known-broken production rows (captured against a
-- cancelled or declined session) would be re-entered by the new gate if left
-- unfinalized, and re-entry would run finalizeSessionCaptured against a
-- session that is still cancelled, fail the 0109 status guard, and log a fresh
-- error every five minutes forever. Re-entry repairs a run that DIED; it
-- cannot repair a delivery that arrived after the entity was already gone.
-- Those rows need a refund, which is a decision, not a retry.
--
-- So history is closed out here and the new machinery applies from this point
-- forward. The existing damage stays exactly as visible as it is today, in
-- docs/qa/verify/MONEY-INVARIANTS.md, and does not get quietly relabelled as
-- an automated retry that will never succeed.
-- ============================================================================

update public.payment_intents
set finalized_at = updated_at,
    finalize_attempts = 1
where status in ('captured', 'refunded', 'partially_refunded')
  and finalized_at is null;

-- The reconciliation queue's index. Partial, so it stays the size of the
-- backlog rather than the size of the table: at 10,000 users the captured set
-- grows without bound and the unfinalized set should stay near zero.
create index if not exists idx_payment_intents_unfinalized
  on public.payment_intents (status, finalize_claimed_at)
  where finalized_at is null;

-- ============================================================================
-- The retry window, as a function rather than a literal, so the gate in
-- TypeScript and any future sweep read the same number from one place. Same
-- pattern as unpaid_hold_ttl() (0038).
--
-- 15 minutes: comfortably longer than the slowest handler (commerce, which
-- does place_order_from_draft plus a ledger group) and short enough that a
-- died run is picked up by the next webhook redelivery rather than a day
-- later. Razorpay redelivers a failed webhook on its own schedule, so this
-- number only bounds how long a stuck intent stays invisible to a retry, not
-- how long the athlete waits: verify-payment is the client's own path and it
-- returns already_processed either way.
-- ============================================================================

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

-- ============================================================================
-- The queue itself, as a view, so a reconciliation job or an admin surface
-- does not have to re-derive the predicate and get it subtly different.
--
-- security_invoker is ON deliberately, unlike public_profiles: this view must
-- NOT project money rows past RLS. Combined with the revokes below it is
-- service_role only, which is the same posture as sweep_failures (0094).
-- ============================================================================

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

-- ============================================================================
-- The gate itself, moved into the database.
--
-- It was a supabase-js .update() chain in _shared/finalize-payment.ts. The
-- re-entry predicate is an OR of two shapes with a time comparison inside one
-- of them, and expressing that as nested PostgREST filters would put a money
-- invariant into a query string. CLAUDE.md's financial invariant says state
-- transitions on money-bearing rows are enforced by Postgres functions, so the
-- claim goes here, where the interval is read from finalize_reentry_after()
-- rather than duplicated as a TypeScript constant that can drift.
--
-- STILL ONE ATOMIC STATEMENT. The UPDATE below is a single statement guarded
-- by its own WHERE, so Postgres' row lock serialises concurrent deliveries and
-- exactly one can match at any instant. The loser matches zero rows and its
-- caller returns already_processed, exactly as before. What changed is only
-- WHICH rows are matchable: previously `created` alone, now `created` or a
-- captured-but-unfinalized row whose claim has gone stale.
-- ============================================================================

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
      -- First delivery.
      pi.status = 'created'
      or (
        -- A previous attempt claimed this intent and never finished. The three
        -- repair checks in the domain handlers exist for exactly this and have
        -- never once been reached.
        pi.status = 'captured'
        and pi.finalized_at is null
        and (
          pi.finalize_claimed_at is null
          or pi.finalize_claimed_at < now() - public.finalize_reentry_after()
        )
      )
    )
  returning pi.* into v_intent;

  -- No row is not an error: it is either an intent that does not exist, or one
  -- another delivery already finalized, or one another delivery is finalizing
  -- right now. The caller distinguishes those with a read.
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
