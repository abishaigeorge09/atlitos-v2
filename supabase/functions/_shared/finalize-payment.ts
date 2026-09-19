// ATLITOS v2 — supabase/functions/_shared/finalize-payment.ts
//
// THE single entry point for "a Razorpay payment was captured". Both
// razorpay-webhook (server push) and verify-payment (client callback,
// PAYMENTS.md's reliable path in a demo with no public webhook URL) call
// `finalizePaymentCaptured` and nothing else, so the two paths cannot drift
// into different capture semantics, different idempotency behaviour, or
// different ledger-writing logic.
//
// Structure (AT-40 refactor, extracted from the single-domain
// finalize-court-booking-payment.ts that preceded it):
//
//   finalizePaymentCaptured        <- the shared gate, owns the idempotency
//                                     UPDATE and the payment_domain dispatch
//     |- finalizeCourtBookingCaptured   (finalize-court-booking-payment.ts)
//     |- finalizeSessionCaptured        (finalize-session-payment.ts)
//     |- finalizeOrderCaptured          (finalize-order-payment.ts, AT-72)
//
// Adding a domain (donation) means adding one branch here plus one
// finalize-<domain>-payment.ts, never a second copy of the gate. The gate is
// deliberately domain-agnostic: it claims the intent, and only then hands a
// captured intent to the domain handler, so no domain handler can ever be
// reached twice CONCURRENTLY for the same charge.
//
// 0109: THE GATE IS NOW RE-ENTERABLE, AND THAT IS THE POINT.
//
// It used to flip the intent to `captured` and dispatch. At-most-once, and
// also once-only: a handler that died after the UPDATE committed left an
// intent that no future delivery could ever match, because it was no longer
// `created`. Money taken, nothing delivered, no way back in. Three repair
// checks in the domain handlers carried docblocks claiming they covered
// exactly that case; none of them could ever be reached.
//
// The claim now lives in claim_payment_intent_for_finalization() (0109) and
// matches an intent that is `created`, OR one that is `captured` with
// `finalized_at` still null whose claim has gone stale. Still one atomic
// UPDATE, so concurrent deliveries still serialise and the loser still gets
// `already_processed`. What changed is that a DIED run can be picked up again,
// which is what makes those three repair checks live code for the first time.
//
// `finalized_at` is set here, after the handler returns, and only then. A
// captured intent with `finalized_at` null is a charge that took money and
// delivered nothing, which is the reconciliation queue that P0-1 correctly
// said did not exist anywhere in this system. It is exposed as the
// `unfinalized_captures` view.
//
// WHAT THIS DOES NOT FIX. Re-entry repairs a run that DIED. It cannot repair a
// delivery that arrived after its entity was already gone, such as a capture
// landing on a session the athlete cancelled during the 15 minute hold. That
// case is a refund, and there is no refund path for it. See PAYMENTS.md,
// "Captured against a dead entity".

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./app-error.ts";
import {
  describeCourtBooking,
  finalizeCourtBookingCaptured,
} from "./finalize-court-booking-payment.ts";
import {
  describeSession,
  finalizeSessionCaptured,
} from "./finalize-session-payment.ts";
import {
  describeOrder,
  finalizeOrderCaptured,
} from "./finalize-order-payment.ts";
import {
  describeDonation,
  finalizeDonationCaptured,
} from "./finalize-donation-payment.ts";
import {
  describeMembership,
  finalizeMembershipCaptured,
} from "./finalize-membership-payment.ts";

export type FinalizeOutcome = "captured" | "already_processed";

export interface CapturedIntent {
  id: string;
  domain: string;
  entity_id: string | null;
  status: string;
}

export interface FinalizeResult {
  outcome: FinalizeOutcome;
  /** `payment_intents.domain`: session | court | commerce | donation. */
  domain: string;
  /** The domain row this charge belongs to (session id, booking id, ...). */
  entityId: string;
  /** That row's own status after finalization, for the client to render. */
  entityStatus: string;
}

/**
 * Idempotency gate. `claim_payment_intent_for_finalization` (0109) is a single
 * atomic SQL statement, so exactly one caller can win a given order at any
 * instant. If razorpay-webhook and verify-payment both fire for the same order
 * (fully expected: verify-payment is a fallback, not a replacement), the
 * loser's claim matches zero rows, no domain handler runs, no second ledger
 * group is written, and the loser returns `already_processed` rather than an
 * error.
 *
 * What it now also does, which it did not before: a claim that was made and
 * never finalized becomes claimable again once it goes stale, so a run that
 * died mid-handler is recoverable instead of permanently lost.
 */
export async function finalizePaymentCaptured(
  supabase: SupabaseClient,
  params: { razorpayOrderId: string; razorpayPaymentId: string },
): Promise<FinalizeResult> {
  const { data: claimed, error: claimError } = await supabase
    .rpc("claim_payment_intent_for_finalization", {
      p_razorpay_order_id: params.razorpayOrderId,
      p_razorpay_payment_id: params.razorpayPaymentId,
    })
    .maybeSingle<CapturedIntent>();

  if (claimError) {
    throw new AppError(
      "INTERNAL",
      `Failed to claim payment_intent: ${claimError.message}`,
      500,
    );
  }

  // The RPC returns a composite. An unmatched claim yields one whose id is
  // null, which is not an error: another delivery holds this intent, or it is
  // already finalized, or it does not exist. The read below tells them apart.
  if (!claimed || !claimed.id) {
    return await describeAlreadyProcessed(supabase, params.razorpayOrderId);
  }

  const intent = claimed;

  try {
    const result = await dispatchToDomainHandler(supabase, intent);
    await markFinalized(supabase, intent.id);
    return result;
  } catch (err) {
    // Record WHY on the intent itself, then rethrow unchanged so the caller's
    // own error handling is untouched. finalized_at deliberately stays null,
    // so the intent remains in `unfinalized_captures` and a later delivery can
    // re-enter it. Before 0109 this failure reached a console.error inside
    // razorpay-webhook's catch and nowhere else, which is why nobody could
    // produce a list of who it had happened to.
    await recordFinalizeFailure(supabase, intent.id, err);
    throw err;
  }
}

/**
 * Set `finalized_at`. Until this runs the charge counts as undelivered, so a
 * failure here is logged rather than swallowed: it would leave a correctly
 * delivered charge sitting in the reconciliation queue, which is a false
 * positive, and a false positive in a money queue is how a queue gets ignored.
 * It is not rethrown, because the domain handler already succeeded and telling
 * the client the payment failed would be the worse lie.
 */
async function markFinalized(supabase: SupabaseClient, intentId: string): Promise<void> {
  const { error } = await supabase.rpc("mark_payment_intent_finalized", {
    p_intent_id: intentId,
  });
  if (error) {
    console.error(
      `finalize-payment: handler succeeded but mark_payment_intent_finalized failed for ${intentId}:`,
      error.message,
    );
  }
}

/** Best effort. Never masks the original failure, which is what gets thrown. */
async function recordFinalizeFailure(
  supabase: SupabaseClient,
  intentId: string,
  err: unknown,
): Promise<void> {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const { error } = await supabase.rpc("record_payment_intent_finalize_failure", {
    p_intent_id: intentId,
    p_error: message,
  });
  if (error) {
    console.error(
      `finalize-payment: could not record finalize failure for ${intentId}:`,
      error.message,
    );
  }
}

/**
 * Domain dispatch. Extracted from the gate so the gate can wrap it in the
 * finalized/failed bookkeeping above without that bookkeeping being duplicated
 * down every branch.
 */
async function dispatchToDomainHandler(
  supabase: SupabaseClient,
  intent: CapturedIntent,
): Promise<FinalizeResult> {
  // COMMERCE RUNS BEFORE THE NULL entity_id CHECK, DELIBERATELY (AT-72).
  // Courts and sessions hand this gate an entity that already exists, so a
  // null entity_id for them means something is wrong. Commerce is the domain
  // whose entity row is created BY the handler: PAYMENTS.md keeps the `orders`
  // row until capture on purpose, "so `placed` never exists without a paid
  // intent behind it", and place_order_from_draft writes entity_id back in the
  // same transaction as the order. A null entity_id here is therefore the
  // NORMAL first-delivery case for commerce, and short circuiting on it (which
  // is what this gate did while commerce was unbuilt) would acknowledge the
  // capture and never create the order.
  if (intent.domain === "commerce") {
    return await finalizeOrderCaptured(supabase, intent);
  }

  // DONATION RUNS BEFORE THE NULL entity_id CHECK, DELIBERATELY (AT-112), for
  // the same reason commerce does: donation is a domain whose entity row (the
  // donations row) is created BY its handler, so a null entity_id here is the
  // NORMAL first-delivery case, not an error. The handler backfills entity_id
  // once the donations row exists.
  if (intent.domain === "donation") {
    return await finalizeDonationCaptured(supabase, intent);
  }

  if (!intent.entity_id) {
    // Every remaining domain hands the gate an entity that already exists, so a
    // null entity_id here means something is wrong. Acknowledge the capture
    // rather than pretending an unhandled domain was finalized.
    return {
      outcome: "captured",
      domain: intent.domain,
      entityId: "",
      entityStatus: "n/a",
    };
  }

  switch (intent.domain) {
    case "court":
      return await finalizeCourtBookingCaptured(supabase, intent);
    case "session":
      return await finalizeSessionCaptured(supabase, intent);
    // Membership hands the gate an entity that already exists (join-group /
    // renew-group-membership create the row before Razorpay is called), so
    // it correctly sits AFTER the null entity_id check, with courts and
    // sessions. Activation + the carve-out ledger group happen in the
    // handler, once per captured charge.
    case "membership":
      return await finalizeMembershipCaptured(supabase, intent);
    default:
      return {
        outcome: "captured",
        domain: intent.domain,
        entityId: intent.entity_id,
        entityStatus: "n/a",
      };
  }
}

/**
 * The UPDATE matched nothing: either no such intent exists (a real problem,
 * NOT_FOUND) or the other finalization path already captured it (expected,
 * idempotent, not an error). Read-only, so this branch can never write a
 * second ledger group no matter how many times it runs.
 */
async function describeAlreadyProcessed(
  supabase: SupabaseClient,
  razorpayOrderId: string,
): Promise<FinalizeResult> {
  const { data: existing, error: lookupError } = await supabase
    .from("payment_intents")
    .select("id, domain, entity_id, status")
    .eq("razorpay_order_id", razorpayOrderId)
    .maybeSingle<CapturedIntent>();

  if (lookupError) {
    throw new AppError(
      "INTERNAL",
      `Failed to look up payment_intents: ${lookupError.message}`,
      500,
    );
  }

  if (!existing) {
    throw new AppError(
      "NOT_FOUND",
      `No payment_intent for razorpay_order_id ${razorpayOrderId}.`,
      404,
    );
  }

  const entityId = existing.entity_id ?? "";
  let entityStatus = "n/a";

  if (existing.entity_id) {
    if (existing.domain === "court") {
      entityStatus = await describeCourtBooking(supabase, existing.entity_id);
    } else if (existing.domain === "session") {
      entityStatus = await describeSession(supabase, existing.entity_id);
    } else if (existing.domain === "commerce") {
      entityStatus = await describeOrder(supabase, existing.entity_id);
    } else if (existing.domain === "donation") {
      entityStatus = await describeDonation(supabase, existing.entity_id);
    } else if (existing.domain === "membership") {
      entityStatus = await describeMembership(supabase, existing.entity_id);
    }
  }

  return {
    outcome: "already_processed",
    domain: existing.domain,
    entityId,
    entityStatus,
  };
}
