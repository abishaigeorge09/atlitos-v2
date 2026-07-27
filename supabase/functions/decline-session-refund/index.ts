// ATLITOS v2 — supabase/functions/decline-session-refund/index.ts
//
// POST { session_id, reason? } with the COACH's own JWT.
// QA finding CO-04 (P0 money). Requirements: PRD-02 FR-14, FR-19, FR-35;
// PRD-01 FR-25; CLAUDE.md financial invariant.
//
// The coach declines a request the athlete already paid for (`requested` ->
// `declined`, FR-14). No service was rendered and the coach never accepted, so
// PRD-02 section 8's single carve-out from "no in-app refunds" applies exactly
// as it does to the athlete-initiated `requested` -> `cancelled` edge
// (cancel-session-refund, FR-35): the full captured amount goes back and the
// platform retains no fee. Before CO-04 this refund did not exist and the
// athlete's money was captured and never returned.
//
// This function is the DECLINE mirror of cancel-session-refund. The only real
// differences are the transition action (`decline` not `cancel`), the identity
// the RPC enforces (coach not athlete), and the resume predicate (a session
// already `declined` by this coach). Everything about the money — find the
// captured intent, claim a `refunds` row, call Razorpay, settle via
// settle_refund, converge idempotently with the refund.processed webhook — is
// the same machinery AT-60 built, reused rather than reinvented.
//
// Order of operations, each step deliberate and identical to AT-60's:
//
//   1. `session_transition_internal(actor, session_id, 'decline', reason)`
//      called with the SERVICE-ROLE client (AT-61, 0027). The RPC enforces
//      "only the assigned coach" and "only from requested"; this function adds
//      no second opinion. The actor is `getAuthenticatedUser()`'s id, validated
//      against GoTrue, never read from the body. `session_transition('decline')`
//      is now closed to `authenticated` callers (0085), so this function is the
//      only path to a decline and FR-35's refund cannot be skipped.
//   2. THE SESSION IS DECLINED BEFORE RAZORPAY IS CALLED, and stays declined
//      whatever Razorpay does. A provider outage must never trap the coach in a
//      state they already left; the refund outcome is reported separately.
//   3. A `refunds` row is inserted PENDING. The unique index on
//      (domain, entity_id) is the idempotency gate: a double tap loses the
//      insert, reads the existing row, and never issues a second refund.
//   4. Razorpay's refund API is called. On success, `settle_refund` writes the
//      reversing ledger group (debit platform / credit the payer) and flips the
//      row to `processed`, netting the session to zero. On failure the row
//      stays `pending` with a failure_reason and this function returns 200 with
//      refund_status "pending": the DECLINE succeeded, which is what the coach
//      asked for, and the refund is now visible to admin and retryable.
//
// Ledger writes happen only inside `settle_refund` under the service role, per
// CLAUDE.md. This function never inserts a ledger row itself.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError, appErrorFromPostgrestMessage } from "../_shared/app-error.ts";
import {
  getAuthenticatedUser,
  serviceRoleClient,
} from "../_shared/supabase.ts";
import { razorpayRequest } from "../_shared/razorpay.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SessionRow {
  id: string;
  coach_id: string;
  player_id: string;
  status: string;
  total: number;
  payment_intent_id: string | null;
}

interface IntentRow {
  id: string;
  user_id: string;
  status: string;
  amount: number;
  razorpay_payment_id: string | null;
}

interface RefundRow {
  id: string;
  status: string;
  amount: number;
  razorpay_refund_id: string | null;
  ledger_entry_group_id: string | null;
  attempts: number;
}

interface RazorpayRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
}

function parseRequestBody(raw: unknown): { session_id: string; reason?: string } {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const { session_id, reason } = raw as Record<string, unknown>;
  if (typeof session_id !== "string" || !UUID_RE.test(session_id)) {
    throw new AppError("VALIDATION", "session_id must be a valid uuid.", 400);
  }
  if (reason !== undefined && typeof reason !== "string") {
    throw new AppError("VALIDATION", "reason, when supplied, must be a string.", 400);
  }
  return { session_id, reason: typeof reason === "string" ? reason : undefined };
}

/** Rupees to paise, the unit Razorpay's refund API takes. */
function toPaise(amount: number): number {
  return Math.round(amount * 100);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

Deno.serve((req) =>
  withErrorHandling(req, async (request) => {
    const preflight = handleCorsPreflight(request);
    if (preflight) return preflight;

    if (request.method !== "POST") {
      throw new AppError("VALIDATION", "Only POST is supported.", 405);
    }

    const body = parseRequestBody(await request.json().catch(() => null));
    const user = await getAuthenticatedUser(request);
    const supabase = serviceRoleClient();

    // ------------------------------------------------------------------
    // 1. Decline, under the SERVICE ROLE via the internal entry point
    //    (AT-61, 0027). `session_transition('decline')` now refuses an
    //    `authenticated` caller with USE_EDGE_FUNCTION (0085), so this
    //    function is the only path to a decline and FR-35's refund cannot be
    //    skipped. The RPC still owns identity (coach only) and the machine
    //    (from `requested` only); the actor arrives as `p_actor_id` because
    //    auth.uid() is null under the service-role key, and it comes from
    //    getAuthenticatedUser's GoTrue-validated token, never the body.
    // ------------------------------------------------------------------
    const { data: transitioned, error: transitionError } = await supabase
      .rpc("session_transition_internal", {
        p_actor_id: user.id,
        p_session_id: body.session_id,
        p_action: "decline",
        p_reason: body.reason ?? null,
      })
      .single<SessionRow>();

    let session: SessionRow;

    if (transitionError) {
      // One narrow repair path, mirroring cancel-session-refund's: the session
      // is ALREADY declined by this coach and its refund never settled. That
      // is the FR-35 retry case (attempt 1 declined the session, then Razorpay
      // failed), and it must be resumable rather than dead.
      const { data: existing } = await supabase
        .from("sessions")
        .select("id, coach_id, player_id, status, total, payment_intent_id")
        .eq("id", body.session_id)
        .maybeSingle<SessionRow>();

      const resumable = existing != null &&
        existing.status === "declined" &&
        existing.coach_id === user.id;

      if (!resumable) {
        throw appErrorFromPostgrestMessage(transitionError.message);
      }
      session = existing;
    } else {
      session = transitioned;
    }

    // From here the session IS declined. Nothing below may throw in a way that
    // suggests otherwise; refund trouble is reported as a pending refund on a
    // successful decline, never as a failed decline.

    // ------------------------------------------------------------------
    // 2. Find the captured charge. No captured charge means nothing to refund,
    //    and that is an ordinary outcome, not an error: a session can sit
    //    `requested` with an unpaid intent (0024 abandons those).
    // ------------------------------------------------------------------
    const { data: intent } = await supabase
      .from("payment_intents")
      .select("id, user_id, status, amount, razorpay_payment_id")
      .eq("domain", "session")
      .eq("entity_id", session.id)
      .maybeSingle<IntentRow>();

    if (!intent || intent.status !== "captured" || !intent.razorpay_payment_id) {
      return jsonResponse({
        session_id: session.id,
        status: session.status,
        refund_status: "not_applicable",
        refund_amount: null,
        outcome: "declined_without_refund",
      });
    }

    // ------------------------------------------------------------------
    // 3. Claim the refund. Losing this insert means another call already owns
    //    it; read that row rather than issuing a second refund.
    // ------------------------------------------------------------------
    const { data: inserted, error: insertError } = await supabase
      .from("refunds")
      .insert({
        payment_intent_id: intent.id,
        domain: "session",
        entity_id: session.id,
        amount: intent.amount,
      })
      .select("id, status, amount, razorpay_refund_id, ledger_entry_group_id, attempts")
      .maybeSingle<RefundRow>();

    let refund: RefundRow;
    let isRetry = false;

    if (insertError) {
      if (insertError.code !== "23505") {
        throw new AppError(
          "INTERNAL",
          `Failed to record refund for session ${session.id}: ${insertError.message}`,
          500,
        );
      }
      const { data: existingRefund } = await supabase
        .from("refunds")
        .select("id, status, amount, razorpay_refund_id, ledger_entry_group_id, attempts")
        .eq("domain", "session")
        .eq("entity_id", session.id)
        .maybeSingle<RefundRow>();

      if (!existingRefund) {
        throw new AppError(
          "INTERNAL",
          `Refund row for session ${session.id} vanished between insert and read.`,
          500,
        );
      }

      // Already done. The double tap, and the case where the webhook settled
      // it first, both land here.
      if (existingRefund.status === "processed") {
        return jsonResponse({
          session_id: session.id,
          status: session.status,
          refund_status: "processed",
          refund_amount: existingRefund.amount,
          outcome: "already_refunded",
        });
      }

      refund = existingRefund;
      isRetry = true;
    } else {
      refund = inserted as RefundRow;
    }

    // ------------------------------------------------------------------
    // 4. Razorpay. On a retry, look before leaping: a prior attempt may have
    //    succeeded with its response lost, and refunding twice is the one
    //    mistake this function must never make.
    // ------------------------------------------------------------------
    let razorpayRefund: RazorpayRefund | null = null;

    if (isRetry) {
      try {
        const prior = await razorpayRequest<{ items?: RazorpayRefund[] }>(
          "GET",
          `/payments/${intent.razorpay_payment_id}/refunds`,
        );
        razorpayRefund = (prior.items ?? [])[0] ?? null;
      } catch (err) {
        console.error(
          `decline-session-refund: could not list prior refunds for ${intent.razorpay_payment_id}:`,
          errorText(err),
        );
      }
    }

    if (!razorpayRefund) {
      await supabase
        .from("refunds")
        .update({ attempts: refund.attempts + 1 })
        .eq("id", refund.id);

      try {
        razorpayRefund = await razorpayRequest<RazorpayRefund>(
          "POST",
          `/payments/${intent.razorpay_payment_id}/refund`,
          {
            amount: toPaise(intent.amount),
            speed: "normal",
            notes: {
              domain: "session",
              entity_id: session.id,
              refund_id: refund.id,
              reason: "coach declined an unanswered, already-paid request",
            },
          },
        );
      } catch (err) {
        // FR-35's failure branch. The session stays declined, the refund stays
        // pending and visible to admin, and the athlete is told the money is
        // on its way rather than being shown a failure they cannot act on.
        const detail = errorText(err);
        console.error(
          `decline-session-refund: Razorpay refund failed for session ${session.id}:`,
          detail,
        );

        await supabase
          .from("refunds")
          .update({ failure_reason: detail.slice(0, 500) })
          .eq("id", refund.id);

        return jsonResponse({
          session_id: session.id,
          status: session.status,
          refund_status: "pending",
          refund_amount: refund.amount,
          outcome: "declined_refund_pending",
        });
      }
    }

    // ------------------------------------------------------------------
    // 5. Settle. One RPC, service role, atomic, and a no-op if the webhook
    //    beat us to it. That is what makes the two paths converge.
    // ------------------------------------------------------------------
    const { data: settled, error: settleError } = await supabase
      .rpc("settle_refund", {
        p_refund_id: refund.id,
        p_razorpay_refund_id: razorpayRefund.id,
      })
      .single<RefundRow>();

    if (settleError) {
      // Razorpay HAS refunded; only our bookkeeping failed. Do not report this
      // as a failure to the coach, and do not retry the refund. The row stays
      // pending with the reason, and refund.processed settles it on arrival.
      console.error(
        `decline-session-refund: refund ${razorpayRefund.id} issued but settle_refund failed:`,
        settleError.message,
      );
      await supabase
        .from("refunds")
        .update({
          razorpay_refund_id: razorpayRefund.id,
          failure_reason: `Refund issued at Razorpay but ledger settlement failed: ${settleError.message}`
            .slice(0, 500),
        })
        .eq("id", refund.id);

      return jsonResponse({
        session_id: session.id,
        status: session.status,
        refund_status: "pending",
        refund_amount: refund.amount,
        outcome: "declined_refund_pending",
      });
    }

    return jsonResponse({
      session_id: session.id,
      status: session.status,
      refund_status: settled.status,
      refund_amount: settled.amount,
      outcome: "declined_and_refunded",
    });
  })
);
