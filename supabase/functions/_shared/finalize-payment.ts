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
// deliberately domain-agnostic: it flips the intent, and only then hands a
// captured intent to the domain handler, so no domain handler can ever be
// reached twice for the same charge.

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
  /**
   * SEC-F2. Null on a `captured` row means the charge landed but its domain
   * handler never finished, so the next delivery must re-enter that handler
   * instead of reporting the charge complete. See 0088.
   */
  finalized_at: string | null;
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
 * Idempotency gate. This UPDATE is a single atomic SQL statement guarded by
 * `where status = 'created'`, so exactly one caller can ever win it for a
 * given order. If razorpay-webhook and verify-payment both fire for the same
 * order (fully expected: verify-payment is a fallback, not a replacement),
 * the loser's UPDATE matches zero rows, no domain handler runs, no second
 * ledger group is written, and the loser returns `already_processed` rather
 * than an error.
 */
export async function finalizePaymentCaptured(
  supabase: SupabaseClient,
  params: { razorpayOrderId: string; razorpayPaymentId: string },
): Promise<FinalizeResult> {
  const { data: updatedIntents, error: intentUpdateError } = await supabase
    .from("payment_intents")
    .update({
      status: "captured",
      razorpay_payment_id: params.razorpayPaymentId,
    })
    .eq("razorpay_order_id", params.razorpayOrderId)
    .eq("status", "created")
    .select("id, domain, entity_id, status, finalized_at")
    .returns<CapturedIntent[]>();

  if (intentUpdateError) {
    throw new AppError(
      "INTERNAL",
      `Failed to update payment_intents: ${intentUpdateError.message}`,
      500,
    );
  }

  if (!updatedIntents || updatedIntents.length === 0) {
    // Nobody won the flip. Either this charge is genuinely complete, or a
    // previous attempt flipped it and then failed downstream (SEC-F2). Only
    // the second case may re-enter a domain handler.
    return await resumeOrDescribe(supabase, params.razorpayOrderId);
  }

  return await runDomainFinalization(supabase, updatedIntents[0]);
}

/**
 * SEC-F2. Dispatch to the domain handler, then record that the downstream work
 * completed. Split out of the gate so BOTH entry points reach it: the winner of
 * the `created -> captured` flip, and a retry that finds a captured intent with
 * work still owed.
 *
 * Every handler this dispatches to is idempotent by construction. The domain
 * RPCs return the existing row untouched on a repeat, and each handler that
 * owes a ledger group checks for one before writing (courts gained that guard
 * alongside this change; sessions owe no ledger at capture at all). Re-entry
 * therefore completes whatever is missing and touches nothing that already
 * landed.
 */
async function runDomainFinalization(
  supabase: SupabaseClient,
  intent: CapturedIntent,
): Promise<FinalizeResult> {
  const result = await dispatchDomain(supabase, intent);
  await markFinalized(supabase, intent.id);
  return result;
}

/**
 * Stamp `finalized_at`. Deliberately does NOT throw on failure: by the time
 * this runs the domain handler has already committed its work, and turning a
 * successful finalization into a 500 would tell Razorpay (and the athlete's
 * client) that a completed charge failed. An unstamped row surfaces in
 * `payment_finalization_backlog()` with `has_ledger_group = true`, which is the
 * signal for "work done, marker missing" rather than "work missing", and the
 * next delivery of the same capture re-runs the idempotent handler and stamps
 * it.
 */
async function markFinalized(supabase: SupabaseClient, intentId: string): Promise<void> {
  const { error } = await supabase
    .from("payment_intents")
    .update({ finalized_at: new Date().toISOString() })
    .eq("id", intentId)
    .is("finalized_at", null);

  if (error) {
    console.error(
      `SEC-F2: domain finalization completed for payment_intent ${intentId} but finalized_at could not be stamped: ${error.message}`,
    );
  }
}

async function dispatchDomain(
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
 * The UPDATE matched nothing. Three cases now, not two: no such intent
 * (NOT_FOUND), a captured intent whose downstream work is still owed (SEC-F2,
 * resume it), or a genuinely complete charge (describe it, read-only).
 */
async function resumeOrDescribe(
  supabase: SupabaseClient,
  razorpayOrderId: string,
): Promise<FinalizeResult> {
  const { data: existing, error: lookupError } = await supabase
    .from("payment_intents")
    .select("id, domain, entity_id, status, finalized_at")
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

  // SEC-F2, the repair path. A `captured` intent with no `finalized_at` is a
  // charge whose domain handler never finished. Before 0088 this branch
  // returned `already_processed` and the work was owed forever. Re-enter it.
  //
  // Scoped strictly to `captured`: a `refunded` or `partially_refunded` intent
  // has moved past capture and must not have its capture-time handler re-run.
  if (existing.status === "captured" && existing.finalized_at === null) {
    console.warn(
      `SEC-F2: resuming unfinished finalization for payment_intent ${existing.id} (domain ${existing.domain}).`,
    );
    // Returns outcome "captured", not a third value: from every caller's point
    // of view the charge is now complete, and widening the public
    // `"captured" | "already_processed"` contract would ripple through eight
    // typed client call sites for an observability nicety. The server log and
    // `finalized_at` carry the distinction.
    return await runDomainFinalization(supabase, existing);
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
