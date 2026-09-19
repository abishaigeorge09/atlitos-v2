// ATLITOS v2 — supabase/functions/_shared/finalize-session-payment.ts
//
// The `session` domain's leg of the shared capture gate in
// finalize-payment.ts (AT-40). Called only with an intent this process just
// flipped from `created` to `captured`, so everything here runs exactly once
// per charge.
//
// Deliberately small, and deliberately writes NO ledger group. Two facts make
// that correct rather than an omission:
//
//   1. A session has no pending_payment state to leave. 0018_coaching.sql
//      header note 3 is explicit that a session's first persisted state is
//      `requested` (PRD-01 FR-24), unlike a court booking which is inserted
//      `pending_payment` and needs this step to reach `confirmed`. There is
//      no status transition owed here at all; the athlete's client polls
//      payment_intents.status to know the charge landed.
//   2. PAYMENTS.md's Route section puts the session's money event at
//      COMPLETION, not at capture: "a session or court booking's completion
//      event ... writes the earnings-accrual ledger_entries group
//      immediately". A coach has not earned anything at the moment an
//      athlete pays; the session has not happened yet, and it can still be
//      declined or cancelled. AT-41's complete-session function writes the
//      balanced group (SCHEMA.md's worked example) when the coach marks the
//      session complete. Writing an accrual here as well would double-credit
//      the coach for one session.
//
// So the captured funds sit in the platform's Razorpay account with no
// ledger attribution until the session is completed, which is exactly what
// "the platform holds funds and releases them later" means in PAYMENTS.md's
// on-demand-transfer model. `payment_intents` remains the record that the
// charge happened; `ledger_entries` remains the record of who is owed what.

// ============================================================================
// 0109: THE STATUS GUARD THIS FILE NEVER HAD
//
// It selected `id, status` from the session and then never looked at the
// status it had just read, returning outcome "captured" on a session that was
// already cancelled or declined. 17 production rows are in that end state.
//
// The window is not a microsecond race. `unpaid_hold_ttl()` is 15 minutes and
// UPI collect routinely exceeds it, so the ordinary sequence is: athlete taps
// Cancel, cancel-session-refund reads the intent, finds it still `created`,
// records refund_status "not_applicable" and cancels the session (correct
// given what it can see), and the capture lands afterwards.
//
// CLASS SWEEP, the other four domains:
//   court       finalizeCourtBookingCaptured calls court_booking_confirm_payment,
//               which raises INVALID_TRANSITION unless the booking is still
//               pending_payment. Guarded.
//   membership  activate_group_membership_paid (0079) is the status writer and
//               refuses a membership that is not in an activatable state.
//               Guarded.
//   commerce    consume_reservation raises OUT_OF_STOCK on a lapsed hold and
//               finalize-order-payment refunds. Guarded, and it is the only
//               domain that already had a refund path for this shape.
//   donation    creates its own entity; there is no prior state to contradict.
// Session was the one domain whose handler read the status and ignored it.
// ============================================================================

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./app-error.ts";
import type { CapturedIntent, FinalizeResult } from "./finalize-payment.ts";

/**
 * Statuses from which a session can never come back, so a payment landing on
 * one has bought nothing. Deliberately an explicit list rather than "not
 * requested": a capture arriving on an `accepted`, `in_progress`, `completed`
 * or `rated` session is a slow but successful payment for a real session, and
 * refusing those would invent a failure. `rescheduled` is also fine, the
 * session still exists and the money still applies to it.
 */
const DEAD_SESSION_STATUSES = ["cancelled", "declined"] as const;

export async function finalizeSessionCaptured(
  supabase: SupabaseClient,
  intent: CapturedIntent,
): Promise<FinalizeResult> {
  const sessionId = intent.entity_id as string;

  const { data: session, error } = await supabase
    .from("sessions")
    .select("id, status")
    .eq("id", sessionId)
    .maybeSingle<{ id: string; status: string }>();

  if (error) {
    throw new AppError(
      "INTERNAL",
      `Failed to load session ${sessionId}: ${error.message}`,
      500,
    );
  }

  if (!session) {
    // The intent points at a session row that does not exist. The charge is
    // still recorded as captured (the athlete's money did move), so this is
    // a reconciliation problem, not something to unwind here.
    throw new AppError(
      "NOT_FOUND",
      `payment_intent ${intent.id} references missing session ${sessionId}.`,
      404,
    );
  }

  if ((DEAD_SESSION_STATUSES as readonly string[]).includes(session.status)) {
    // The charge landed on a session that is already gone. Do NOT return
    // outcome "captured": that told the athlete their booking succeeded while
    // the session sat cancelled, which is the single most dishonest thing this
    // codebase does with money.
    //
    // Throwing leaves the intent CAPTURED and UNFINALIZED, which is exactly
    // right. `finalized_at` stays null, so the row appears in 0109's
    // `unfinalized_captures` view with this message in `finalize_last_error`,
    // and the money is visible as owed instead of silently absorbed. Before
    // 0109 there was nowhere for that fact to live.
    //
    // It does NOT issue the refund, because there is no refund path for this
    // case: cancel-session-refund and decline-session-refund both require the
    // session to still be `requested`, session_transition refuses a second
    // cancel with INVALID_TRANSITION, and admin-order-refund is commerce only.
    // Building one is a separate change; see PAYMENTS.md, "Captured against a
    // dead entity". Surfacing the debt honestly is what this guard can do.
    throw new AppError(
      "SESSION_CANCELLED",
      "This session was cancelled before the payment completed, so the booking was not created. The payment has been recorded and a refund is owed.",
      409,
    );
  }

  return {
    outcome: "captured",
    domain: "session",
    entityId: sessionId,
    entityStatus: session.status,
  };
}

/** Read-only status probe for the already-processed branch of the gate. */
export async function describeSession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<string> {
  const { data } = await supabase
    .from("sessions")
    .select("status")
    .eq("id", sessionId)
    .maybeSingle<{ status: string }>();

  return data?.status ?? "unknown";
}
