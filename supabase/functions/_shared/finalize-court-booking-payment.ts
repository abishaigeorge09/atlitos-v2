// ATLITOS v2 — supabase/functions/_shared/finalize-court-booking-payment.ts
//
// The one place "a court booking's payment was captured" gets finalized:
// flip payment_intents to captured, transition the booking pending_payment
// -> confirmed via RPC, write the balanced ledger_entries group. Both
// razorpay-webhook (server push) and verify-payment (client-callback
// fallback, PAYMENTS.md's "so the demo works without a public webhook URL")
// call this exact function, so the two paths cannot drift into different
// ledger-writing logic and so whichever one runs first is a no-op for
// whichever runs second (see the guarded update below).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./app-error.ts";
import { round2 } from "./fee-config.ts";

export type FinalizeOutcome = "captured" | "already_processed";

export interface FinalizeResult {
  outcome: FinalizeOutcome;
  bookingId: string;
  bookingStatus: string;
}

interface PaymentIntentRow {
  id: string;
  domain: string;
  entity_id: string | null;
  status: string;
}

interface CourtBookingRow {
  id: string;
  court_id: string;
  status: string;
  subtotal: number;
  gst: number;
  platform_fee: number;
  total: number;
}

/**
 * Idempotency gate: this UPDATE only ever succeeds (returns a row) for the
 * caller that wins the race, because it is a single atomic SQL statement
 * guarded by `where status = 'created'`. If razorpay-webhook and
 * verify-payment both fire for the same order (fully expected in this
 * demo, since verify-payment is a fallback, not a replacement), the second
 * caller's UPDATE matches zero rows and this function returns
 * `already_processed` without writing a second ledger group or attempting a
 * second (now invalid) pending_payment -> confirmed transition.
 */
export async function finalizeCourtBookingPaymentCaptured(
  supabase: SupabaseClient,
  params: { razorpayOrderId: string; razorpayPaymentId: string },
): Promise<FinalizeResult> {
  const { data: updatedIntents, error: intentUpdateError } = await supabase
    .from("payment_intents")
    .update({ status: "captured", razorpay_payment_id: params.razorpayPaymentId })
    .eq("razorpay_order_id", params.razorpayOrderId)
    .eq("status", "created")
    .select("id, domain, entity_id, status")
    .returns<PaymentIntentRow[]>();

  if (intentUpdateError) {
    throw new AppError(
      "INTERNAL",
      `Failed to update payment_intents: ${intentUpdateError.message}`,
      500,
    );
  }

  if (!updatedIntents || updatedIntents.length === 0) {
    // Either no such payment_intent exists at all, or it was already
    // captured by the other finalization path. Look it up read-only to
    // distinguish "not found" (a real problem) from "already processed"
    // (expected, idempotent, not an error).
    const { data: existing, error: lookupError } = await supabase
      .from("payment_intents")
      .select("id, domain, entity_id, status")
      .eq("razorpay_order_id", params.razorpayOrderId)
      .maybeSingle<PaymentIntentRow>();

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
        `No payment_intent for razorpay_order_id ${params.razorpayOrderId}.`,
        404,
      );
    }

    if (existing.domain !== "court" || !existing.entity_id) {
      throw new AppError(
        "INTERNAL",
        `payment_intent ${existing.id} is not a court booking intent.`,
        500,
      );
    }

    const { data: booking } = await supabase
      .from("court_bookings")
      .select("id, status")
      .eq("id", existing.entity_id)
      .maybeSingle<{ id: string; status: string }>();

    return {
      outcome: "already_processed",
      bookingId: existing.entity_id,
      bookingStatus: booking?.status ?? "confirmed",
    };
  }

  const intent = updatedIntents[0];

  if (intent.domain !== "court" || !intent.entity_id) {
    // Only the courts domain is wired end to end in this phase (sessions,
    // commerce, donation tables do not exist yet). Acknowledge without
    // erroring rather than pretending an unimplemented domain was handled.
    return {
      outcome: "captured",
      bookingId: intent.entity_id ?? "",
      bookingStatus: "n/a",
    };
  }

  const bookingId = intent.entity_id;

  const { data: bookingRpcResult, error: transitionError } = await supabase
    .rpc("court_booking_confirm_payment", {
      p_booking_id: bookingId,
      p_payment_intent_id: intent.id,
    })
    .single<CourtBookingRow>();

  if (transitionError) {
    throw new AppError(
      "INTERNAL",
      `court_booking_confirm_payment failed: ${transitionError.message}`,
      500,
    );
  }

  const booking = bookingRpcResult;

  const { data: court, error: courtLookupError } = await supabase
    .from("courts")
    .select("venue_id")
    .eq("id", booking.court_id)
    .single<{ venue_id: string }>();

  if (courtLookupError || !court) {
    throw new AppError(
      "INTERNAL",
      `Failed to resolve venue_id for court ${booking.court_id}.`,
      500,
    );
  }

  const entryGroupId = crypto.randomUUID();
  const partnerPayable = round2(booking.subtotal + booking.gst);

  // One insert call = one INSERT statement = one atomic write of the whole
  // balanced group (SCHEMA.md's worked example: debit platform for the full
  // captured amount, credit the partner's payable, credit the platform fee
  // leg). ledger_entries has INSERT-only grants (0010_payments_core.sql),
  // no role, including service_role, can UPDATE/DELETE a row here; a
  // correction is always a new reversing group, never this one being
  // touched again.
  const { error: ledgerError } = await supabase.from("ledger_entries").insert([
    {
      entry_group_id: entryGroupId,
      payment_intent_id: intent.id,
      account_type: "platform",
      account_ref: null,
      direction: "debit",
      amount: booking.total,
      domain: "court",
      entity_id: bookingId,
      description: `Clearing: court booking ${bookingId} payment captured`,
    },
    {
      entry_group_id: entryGroupId,
      payment_intent_id: intent.id,
      account_type: "court_partner",
      account_ref: court.venue_id,
      direction: "credit",
      amount: partnerPayable,
      domain: "court",
      entity_id: bookingId,
      description: `Court partner payable, booking ${bookingId}`,
    },
    {
      entry_group_id: entryGroupId,
      payment_intent_id: intent.id,
      account_type: "platform",
      account_ref: null,
      direction: "credit",
      amount: booking.platform_fee,
      domain: "court",
      entity_id: bookingId,
      description: `Platform fee, court booking ${bookingId}`,
    },
  ]);

  if (ledgerError) {
    throw new AppError(
      "INTERNAL",
      `Failed to write ledger_entries for booking ${bookingId}: ${ledgerError.message}`,
      500,
    );
  }

  return {
    outcome: "captured",
    bookingId,
    bookingStatus: booking.status,
  };
}
