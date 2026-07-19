// ATLITOS v2 — supabase/functions/cancel-session-refund/index.ts
//
// POST { session_id } with the ATHLETE's own JWT.
// Epic AT-11, story AT-60. Requirements: PRD-02 FR-19 (amended 2026-07-19),
// FR-34, FR-35; PRD-01 FR-25, FR-26.
//
// The athlete booked, paid, and changed their mind before the coach ever
// answered. PRD-02 section 8's single carve-out from "no in-app refunds"
// applies: nobody has to judge anything, because the coach never accepted and
// no service was rendered, so the full amount goes back and the platform
// retains no fee.
//
// Order of operations, and every step of it is deliberate:
//
//   1. `session_transition(session_id, 'cancel')` called with the ATHLETE's
//      own JWT, exactly as complete-session calls it with the coach's. The
//      RPC is what enforces "only the booking athlete" and "only from
//      requested"; this function adds no second opinion about who may cancel
//      what. Under the service-role key auth.uid() is null and the RPC would
//      reject, which is why two clients are used here.
//   2. THE SESSION IS CANCELLED BEFORE RAZORPAY IS CALLED, and stays
//      cancelled whatever Razorpay does. FR-35 is explicit: "the athlete is
//      never left holding a `requested` session they have already cancelled".
//      Ordering it the other way round would mean a Razorpay outage traps the
//      athlete in the exact state this whole amendment exists to let them
//      leave.
//   3. A `refunds` row is inserted PENDING. The unique index on
//      (domain, entity_id) is the idempotency gate: a double tap loses the
//      insert, reads the existing row, and never issues a second refund.
//   4. Razorpay's refund API is called. On success, `settle_refund` writes
//      the reversing ledger group and flips the row to `processed`. On
//      failure the row stays `pending` with a failure_reason, and this
//      function returns 200 with refund_status "pending", because the
//      CANCELLATION succeeded and that is what the athlete asked for. The
//      refund is now visible to admin (`refunds where status <> 'processed'`)
//      and retryable, which is FR-35's "never silently lost".
//
// Idempotency has one subtlety worth naming: if a previous attempt called
// Razorpay and the response was lost in flight, retrying blindly could refund
// twice. So when this function finds an EXISTING pending row it first asks
// Razorpay what refunds already exist against that payment, and settles
// against the one it finds rather than creating another. That check is
// deliberately skipped on the first attempt, where no prior call can exist.
//
// Ledger writes happen only inside `settle_refund` under the service role,
// per CLAUDE.md. This function never inserts a ledger row itself.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError, appErrorFromPostgrestMessage } from "../_shared/app-error.ts";
import {
  getAuthenticatedUser,
  serviceRoleClient,
  userScopedClient,
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

function parseRequestBody(raw: unknown): { session_id: string } {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const { session_id } = raw as Record<string, unknown>;
  if (typeof session_id !== "string" || !UUID_RE.test(session_id)) {
    throw new AppError("VALIDATION", "session_id must be a valid uuid.", 400);
  }
  return { session_id };
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
    const asAthlete = userScopedClient(request);
    const supabase = serviceRoleClient();

    // ------------------------------------------------------------------
    // 1. Cancel, as the athlete. The RPC owns identity and the machine.
    // ------------------------------------------------------------------
    const { data: transitioned, error: transitionError } = await asAthlete
      .rpc("session_transition", {
        p_session_id: body.session_id,
        p_action: "cancel",
      })
      .single<SessionRow>();

    let session: SessionRow;

    if (transitionError) {
      // One narrow repair path, mirroring complete-session's: the session is
      // ALREADY cancelled by this athlete and its refund never settled. That
      // is precisely the FR-35 retry case (attempt 1 cancelled the session,
      // then Razorpay failed), and it must be resumable rather than dead.
      const { data: existing } = await supabase
        .from("sessions")
        .select("id, coach_id, player_id, status, total, payment_intent_id")
        .eq("id", body.session_id)
        .maybeSingle<SessionRow>();

      const resumable = existing != null &&
        existing.status === "cancelled" &&
        existing.player_id === user.id;

      if (!resumable) {
        throw appErrorFromPostgrestMessage(transitionError.message);
      }
      session = existing;
    } else {
      session = transitioned;
    }

    // From here the session IS cancelled. Nothing below may throw in a way
    // that suggests otherwise; refund trouble is reported as a pending
    // refund on a successful cancellation, never as a failed cancellation.

    // ------------------------------------------------------------------
    // 2. Find the captured charge. No charge means nothing to refund, and
    //    that is a perfectly ordinary outcome, not an error: a session can
    //    sit `requested` with an unpaid intent (0024 abandons those).
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
        outcome: "cancelled_without_refund",
      });
    }

    // ------------------------------------------------------------------
    // 3. Claim the refund. Losing this insert means another call already
    //    owns it; read that row rather than issuing a second refund.
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
        // Not fatal: worst case this attempt tries the refund below and
        // Razorpay rejects the duplicate on its own side.
        console.error(
          `cancel-session-refund: could not list prior refunds for ${intent.razorpay_payment_id}:`,
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
              reason: "athlete cancelled an unanswered request",
            },
          },
        );
      } catch (err) {
        // FR-35's failure branch. The session stays cancelled, the refund
        // stays pending and visible to admin, and the athlete is told the
        // money is on its way rather than being shown a failure they cannot
        // act on and did not cause.
        const detail = errorText(err);
        console.error(
          `cancel-session-refund: Razorpay refund failed for session ${session.id}:`,
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
          outcome: "cancelled_refund_pending",
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
      // Razorpay HAS refunded; only our bookkeeping failed. Do not report
      // this as a failure to the athlete, and do not retry the refund. The
      // row stays pending with the reason, and the refund.processed webhook
      // will settle it when it arrives.
      console.error(
        `cancel-session-refund: refund ${razorpayRefund.id} issued but settle_refund failed:`,
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
        outcome: "cancelled_refund_pending",
      });
    }

    return jsonResponse({
      session_id: session.id,
      status: session.status,
      refund_status: settled.status,
      refund_amount: settled.amount,
      outcome: "cancelled_and_refunded",
    });
  })
);
