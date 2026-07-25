// ATLITOS v2 — supabase/functions/verify-payment/index.ts
//
// POST { razorpay_order_id, razorpay_payment_id, razorpay_signature } with
// the athlete's own JWT. Epic AT-11. The client-callback fallback
// PAYMENTS.md calls out: "so the demo works without a public webhook URL".
//
// This is NOT a second, weaker way to confirm a payment: the signature
// verified here (`_shared/razorpay.ts`'s `verifyPaymentSignature`, HMAC of
// "{order_id}|{payment_id}" keyed by RAZORPAY_KEY_SECRET) is Razorpay's own
// documented proof that the returned payment_id genuinely belongs to that
// order and was signed by Razorpay, not a client assertion. Finalization
// itself (flip payment_intents, transition the booking, write the ledger
// group) is byte-for-byte the same `finalizePaymentCaptured` call
// razorpay-webhook makes, guarded by the same `status = 'created'`
// optimistic update, so whichever of the two paths (this one, or a real
// webhook delivery) arrives first performs the write and the other is a
// no-op `already_processed` — idempotent with the webhook path, not a race
// against it.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import { getAuthenticatedUser, serviceRoleClient } from "../_shared/supabase.ts";
import { verifyPaymentSignature } from "../_shared/razorpay.ts";
import { finalizePaymentCaptured } from "../_shared/finalize-payment.ts";

interface VerifyPaymentRequestBody {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface PaymentIntentOwnerRow {
  id: string;
  user_id: string;
}

function parseRequestBody(raw: unknown): VerifyPaymentRequestBody {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const body = raw as Record<string, unknown>;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

  if (typeof razorpay_order_id !== "string" || razorpay_order_id.length === 0) {
    throw new AppError("VALIDATION", "razorpay_order_id is required.", 400);
  }
  if (typeof razorpay_payment_id !== "string" || razorpay_payment_id.length === 0) {
    throw new AppError("VALIDATION", "razorpay_payment_id is required.", 400);
  }
  if (typeof razorpay_signature !== "string" || razorpay_signature.length === 0) {
    throw new AppError("VALIDATION", "razorpay_signature is required.", 400);
  }

  return { razorpay_order_id, razorpay_payment_id, razorpay_signature };
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

    const signatureValid = await verifyPaymentSignature(
      body.razorpay_order_id,
      body.razorpay_payment_id,
      body.razorpay_signature,
    );
    if (!signatureValid) {
      throw new AppError(
        "INVALID_SIGNATURE",
        "Payment signature could not be verified.",
        400,
      );
    }

    // Defense in depth beyond signature verification: the caller must be
    // the athlete this payment_intent was created for, not just anyone who
    // happens to hold a valid Razorpay signature triple (which, in
    // practice, could only be handed to them by their own checkout sheet
    // anyway, but this keeps the ownership check explicit rather than
    // implicit).
    const { data: intent, error: intentLookupError } = await supabase
      .from("payment_intents")
      .select("id, user_id")
      .eq("razorpay_order_id", body.razorpay_order_id)
      .maybeSingle<PaymentIntentOwnerRow>();

    if (intentLookupError) {
      throw new AppError(
        "INTERNAL",
        `Failed to look up payment_intent: ${intentLookupError.message}`,
        500,
      );
    }
    if (!intent) {
      throw new AppError(
        "NOT_FOUND",
        `No payment_intent for razorpay_order_id ${body.razorpay_order_id}.`,
        404,
      );
    }
    if (intent.user_id !== user.id) {
      throw new AppError(
        "FORBIDDEN",
        "This payment does not belong to the calling user.",
        403,
      );
    }

    const result = await finalizePaymentCaptured(supabase, {
      razorpayOrderId: body.razorpay_order_id,
      razorpayPaymentId: body.razorpay_payment_id,
    });

    // Domain-neutral fields plus the two domain-named aliases, so a caller
    // that only ever books courts (portal-court) and one that only ever
    // books sessions (the athlete app) can each read the id they expect
    // without either having to switch on `domain`.
    return jsonResponse({
      domain: result.domain,
      entity_id: result.entityId,
      booking_id: result.domain === "court" ? result.entityId : null,
      session_id: result.domain === "session" ? result.entityId : null,
      // AT-72. Commerce's entity is created BY the gate, so this is the first
      // moment the order id exists; PRD-07 FR-23 gates Order Success on it.
      order_id: result.domain === "commerce" && result.entityId ? result.entityId : null,
      // Group fares (join-group / renew-group-membership) ride the same
      // shared gate; the membership-named alias keeps the client from
      // switching on domain, same as the other aliases above.
      membership_id: result.domain === "membership" ? result.entityId : null,
      status: result.entityStatus,
      outcome: result.outcome,
    });
  })
);
