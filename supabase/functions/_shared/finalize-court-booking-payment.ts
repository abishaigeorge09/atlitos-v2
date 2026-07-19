// ATLITOS v2 — supabase/functions/_shared/finalize-court-booking-payment.ts
//
// The `court` domain's leg of the shared capture gate in
// finalize-payment.ts: transition the booking pending_payment -> confirmed
// via RPC, then write the balanced ledger_entries group.
//
// AT-40 refactor: this file used to own the idempotency gate (the
// `update payment_intents ... where status = 'created'` optimistic update)
// as well as the court-specific work, which meant adding the sessions domain
// would have meant either a second copy of that gate or a court-named helper
// quietly handling sessions. The gate now lives in finalize-payment.ts and
// dispatches here; this function is only ever called with an intent that was
// just flipped to `captured` by that gate, so it still runs exactly once per
// charge, and both razorpay-webhook and verify-payment still reach it through
// exactly one code path.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./app-error.ts";
import { round2 } from "./fee-config.ts";
import type { CapturedIntent, FinalizeResult } from "./finalize-payment.ts";

interface CourtBookingRow {
  id: string;
  court_id: string;
  status: string;
  subtotal: number;
  gst: number;
  platform_fee: number;
  total: number;
}

export async function finalizeCourtBookingCaptured(
  supabase: SupabaseClient,
  intent: CapturedIntent,
): Promise<FinalizeResult> {
  const bookingId = intent.entity_id as string;

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
    domain: "court",
    entityId: bookingId,
    entityStatus: booking.status,
  };
}

/** Read-only status probe for the already-processed branch of the gate. */
export async function describeCourtBooking(
  supabase: SupabaseClient,
  bookingId: string,
): Promise<string> {
  const { data } = await supabase
    .from("court_bookings")
    .select("status")
    .eq("id", bookingId)
    .maybeSingle<{ status: string }>();

  return data?.status ?? "confirmed";
}
