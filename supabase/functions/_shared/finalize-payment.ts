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
    .select("id, domain, entity_id, status")
    .returns<CapturedIntent[]>();

  if (intentUpdateError) {
    throw new AppError(
      "INTERNAL",
      `Failed to update payment_intents: ${intentUpdateError.message}`,
      500,
    );
  }

  if (!updatedIntents || updatedIntents.length === 0) {
    return await describeAlreadyProcessed(supabase, params.razorpayOrderId);
  }

  const intent = updatedIntents[0];

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

  if (!intent.entity_id) {
    // Domains whose row is created by the webhook itself (donation) are not
    // built in this phase. Acknowledge the capture rather than pretending an
    // unimplemented domain was handled.
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
    }
  }

  return {
    outcome: "already_processed",
    domain: existing.domain,
    entityId,
    entityStatus,
  };
}
