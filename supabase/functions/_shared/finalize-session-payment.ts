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

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./app-error.ts";
import type { CapturedIntent, FinalizeResult } from "./finalize-payment.ts";

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
