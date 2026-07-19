// ATLITOS v2 — supabase/functions/razorpay-webhook/index.ts
//
// Razorpay servers call this, never a client. Epic AT-11.
// docs/architecture/PAYMENTS.md's "razorpay-webhook: signature verification
// and idempotency" section is this function's blueprint verbatim:
//
//   1. Verify `x-razorpay-signature` against the raw body (RAZORPAY_WEBHOOK_SECRET).
//   2. Idempotency: insert the event id into `webhook_events` before any
//      side effect; a `23505` unique violation means this exact event was
//      already processed, acknowledge and stop.
//   3. Branch on `event.event`: `payment.captured`, `payment.failed`, and as
//      of AT-60 `refund.processed` (commerce/donation domains and transfer.*
//      events do not exist yet — SCHEMA.md's phase sequencing,
//      PHASE-1-STATUS.md's handoff notes).
//      The `session` domain joined `court` in AT-40 and needs no new branch
//      here, because the domain fan-out lives behind the shared gate.
//   4. Always return 200 once the event is durably recorded, even for
//      event types this phase does not act on, so Razorpay does not retry
//      forever on an event this platform intentionally ignores.
//
// `handlePaymentCaptured`'s actual finalize step (flip payment_intents,
// dispatch on payment_intents.domain, transition the domain row, write the
// ledger group) lives in `_shared/finalize-payment.ts`, shared verbatim with
// verify-payment so the two entry points can never process the same capture
// differently. As of AT-40 that gate covers both the `court` and `session`
// domains; neither entry point knows or cares which, it just calls
// `finalizePaymentCaptured` and the gate routes by domain.

import { corsHeaders } from "../_shared/cors.ts";
import { serviceRoleClient } from "../_shared/supabase.ts";
import { verifyWebhookSignature } from "../_shared/razorpay.ts";
import { finalizePaymentCaptured } from "../_shared/finalize-payment.ts";

interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  status: string;
}

interface RazorpayRefundEntity {
  id: string;
  payment_id: string;
  /** Paise, as everywhere in Razorpay's API. */
  amount: number;
  status: string;
}

interface RazorpayWebhookEvent {
  // Razorpay does NOT put the event id in the JSON body; it arrives in the
  // x-razorpay-event-id request header. Body has entity/account_id/event/
  // contains/payload/created_at. An `id` property is kept optional here only
  // as a defensive fallback.
  id?: string;
  event: string;
  payload: {
    payment?: { entity: RazorpayPaymentEntity };
    refund?: { entity: RazorpayRefundEntity };
  };
}

function plainResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: corsHeaders });
}

/**
 * `refund.processed` (AT-60). Resolves the event to one `refunds` row and
 * settles it. Three lookups in priority order, because the row this event
 * belongs to may or may not have been created by us:
 *
 *   1. By `razorpay_refund_id`. The normal case on a duplicate delivery of
 *      an event whose refund we already settled or at least recorded.
 *   2. By the payment intent. The normal case on the FIRST delivery for a
 *      refund cancel-session-refund created but had not yet settled.
 *   3. Neither: the refund was issued outside this system, most plausibly by
 *      hand in the Razorpay dashboard while unsticking a pending one. A row
 *      is created so the ledger still records the money leaving, rather than
 *      the event being dropped and the books quietly going wrong.
 *
 * `settle_refund` does the actual work atomically and returns unchanged if
 * the row is already `processed`, so every path here is safe to run twice.
 */
async function handleRefundProcessed(
  supabase: ReturnType<typeof serviceRoleClient>,
  refund: RazorpayRefundEntity,
): Promise<void> {
  const { data: byRefundId } = await supabase
    .from("refunds")
    .select("id")
    .eq("razorpay_refund_id", refund.id)
    .maybeSingle<{ id: string }>();

  let refundRowId = byRefundId?.id ?? null;

  const { data: intent } = await supabase
    .from("payment_intents")
    .select("id, domain, entity_id, amount")
    .eq("razorpay_payment_id", refund.payment_id)
    .maybeSingle<
      { id: string; domain: string; entity_id: string | null; amount: number }
    >();

  if (!refundRowId) {
    if (!intent) {
      console.error(
        `razorpay-webhook: refund.processed for unknown payment ${refund.payment_id}; nothing to settle.`,
      );
      return;
    }

    const { data: byIntent } = await supabase
      .from("refunds")
      .select("id")
      .eq("payment_intent_id", intent.id)
      .maybeSingle<{ id: string }>();

    refundRowId = byIntent?.id ?? null;

    if (!refundRowId) {
      if (!intent.entity_id) {
        console.error(
          `razorpay-webhook: refund.processed for intent ${intent.id} with no entity_id; cannot attribute the ledger group.`,
        );
        return;
      }
      // Externally issued refund. Amount comes from Razorpay's own entity
      // (paise), not from the intent, so a partial dashboard refund is
      // recorded at the amount that actually moved.
      const { data: created, error: createError } = await supabase
        .from("refunds")
        .insert({
          payment_intent_id: intent.id,
          domain: intent.domain,
          entity_id: intent.entity_id,
          amount: refund.amount / 100,
          razorpay_refund_id: refund.id,
        })
        .select("id")
        .maybeSingle<{ id: string }>();

      if (createError || !created) {
        console.error(
          `razorpay-webhook: could not record externally issued refund ${refund.id}:`,
          createError?.message,
        );
        return;
      }
      refundRowId = created.id;
    }
  }

  const { error: settleError } = await supabase.rpc("settle_refund", {
    p_refund_id: refundRowId,
    p_razorpay_refund_id: refund.id,
  });

  if (settleError) {
    console.error(
      `razorpay-webhook: settle_refund failed for refund row ${refundRowId} (${refund.id}):`,
      settleError.message,
    );
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return plainResponse("method not allowed", 405);
  }

  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-razorpay-signature") ?? "";

  let signatureValid: boolean;
  try {
    signatureValid = await verifyWebhookSignature(rawBody, signatureHeader);
  } catch (err) {
    // requiredEnv throws if RAZORPAY_WEBHOOK_SECRET is unset. This function
    // cannot operate without it (README.md documents it as optional only in
    // the sense that the demo does not depend on a working public webhook,
    // relying on verify-payment instead); a 500 here is a configuration
    // error, not a signature failure.
    console.error("razorpay-webhook misconfigured:", err);
    return plainResponse("webhook not configured", 500);
  }

  if (!signatureValid) {
    return plainResponse("invalid signature", 400);
  }

  let event: RazorpayWebhookEvent;
  try {
    event = JSON.parse(rawBody) as RazorpayWebhookEvent;
  } catch {
    return plainResponse("invalid json", 400);
  }

  // Razorpay carries the event id in this header, not in the body. Fixed
  // 2026-07-18: reading event.id from the body yielded undefined, the
  // webhook_events insert failed its not-null primary key, this function
  // returned 500 for every real delivery, and Razorpay retried forever.
  const eventId = req.headers.get("x-razorpay-event-id") ?? event.id;
  if (!eventId) {
    // Signature already verified, so this is a Razorpay contract change,
    // not an attacker. Acknowledge to stop retries and log for follow up.
    console.error("razorpay-webhook: delivery with no x-razorpay-event-id header; event type:", event.event);
    return plainResponse("ok (no event id)", 200);
  }

  const supabase = serviceRoleClient();

  // Idempotency gate: insert-before-act. A duplicate delivery of the same
  // event id (Razorpay retries on any non-2xx response, and can redeliver
  // an already-processed event) hits the unique constraint on `id` and is
  // acknowledged without a second side effect.
  const { error: dedupeError } = await supabase
    .from("webhook_events")
    .insert({ id: eventId, event_type: event.event, payload: event });

  if (dedupeError) {
    if (dedupeError.code === "23505") {
      return plainResponse("ok (duplicate)", 200);
    }
    console.error("razorpay-webhook: failed to record webhook_events row:", dedupeError);
    return plainResponse("failed to record event", 500);
  }

  try {
    switch (event.event) {
      case "payment.captured": {
        const payment = event.payload.payment?.entity;
        if (payment) {
          await finalizePaymentCaptured(supabase, {
            razorpayOrderId: payment.order_id,
            razorpayPaymentId: payment.id,
          });
        }
        break;
      }
      case "payment.failed": {
        const payment = event.payload.payment?.entity;
        if (payment) {
          await supabase
            .from("payment_intents")
            .update({ status: "failed" })
            .eq("razorpay_order_id", payment.order_id)
            .eq("status", "created");
        }
        break;
      }
      case "refund.processed": {
        // AT-60, PRD-02 FR-35. Razorpay's final confirmation that a refund
        // SETTLED, as opposed to the synchronous response cancel-session-
        // refund already got confirming it was ACCEPTED. Both paths call
        // settle_refund, which is a no-op on an already-processed row, so a
        // duplicate webhook plus the synchronous path converge on exactly one
        // refund record and exactly one reversing ledger group.
        const refund = event.payload.refund?.entity;
        if (refund) {
          await handleRefundProcessed(supabase, refund);
        }
        break;
      }
      default:
        // transfer.processed / transfer.failed are named in PAYMENTS.md but
        // Route transfers are not built in this pass; unrecognized or
        // unimplemented event types are acknowledged, not errored, matching
        // PAYMENTS.md's blueprint.
        break;
    }
  } catch (err) {
    // The event is already durably recorded in webhook_events; if the
    // side-effect step fails, log for investigation but still ack so
    // Razorpay does not retry indefinitely into a guaranteed-duplicate
    // event id. Manual reconciliation reads webhook_events.payload.
    console.error(`razorpay-webhook: failed to process event ${eventId} (${event.event}):`, err);
  }

  return plainResponse("ok", 200);
});
