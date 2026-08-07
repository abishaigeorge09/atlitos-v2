// ATLITOS v2 — supabase/functions/admin-order-refund/index.ts
//
// POST { order_id, amount, reason } with an ADMIN's own JWT.
// Phase 4 (LAUNCH), Track A. Requirements: PRD-04 FR-24, FR-25, FR-53;
// PAYMENTS.md `admin-order-refund` design (Refunds section);
// CLAUDE.md financial invariant.
//
// This is the judgement-call refund path PAYMENTS.md defers to admin: a
// cancelled accepted session, a no-show, a quality complaint, a commerce
// return. Unlike cancel-session-refund and decline-session-refund (self-serve,
// full, no judgement), an order refund can be PARTIAL and can be issued more
// than once against the same order until the order total is exhausted.
//
// It reuses the AT-60 machinery rather than inventing a parallel record:
//
//   1. requireAdmin: the caller's admin role is read THROUGH THE CALLER'S OWN
//      JWT (user_roles_select_own), exactly the admin-order-advance pattern, not
//      app_metadata (which GoTrue's getUser does not carry; see that function's
//      header for the full reasoning). The service-role client cannot answer
//      this question because it has no auth.uid().
//   2. claim_order_refund (0095): the atomic, intent-locked claim that enforces
//      the state machine (INVALID_TRANSITION unless captured/partially_refunded)
//      and the remaining-refundable ceiling (AMOUNT_EXCEEDS_REFUNDABLE) server
//      side, then inserts the pending `refunds` row. This function NEVER trusts
//      the admin client's displayed refundable number (PRD-04 FR-24).
//   3. Razorpay's refund API against the original payment.
//   4. settle_refund (0026, partial arm in 0095): writes the reversing ledger
//      group (debit platform / credit the payer) and flips the charge to
//      `refunded` or `partially_refunded`. This is the same convergence point
//      the refund.processed webhook calls, so a duplicate webhook plus the
//      synchronous path land on exactly one refund record and one ledger group.
//   5. Exactly one audit_log row per successful refund (FR-53).
//
// Ledger writes happen only inside settle_refund under the service role, per
// CLAUDE.md. This function never inserts a ledger row itself. Money-row writes
// (the refunds row) happen only inside the service-role RPC or under the
// service-role client here; no client can reach either.
//
// DELIBERATELY NO AUTO-RESUME OF A FAILED RAZORPAY CALL. If Razorpay fails, the
// refund stays pending, visible in the admin refunds queue, and the
// refund.processed webhook is the settle convergence path if the call actually
// went through. A repeated admin submission for the same order while a refund
// is pending is refused by claim_order_refund with REFUND_IN_PROGRESS (index
// 1c, 0095), so this function can never issue a second Razorpay refund racing
// the first. Double-refunding is the one mistake this function must never make,
// and the safest way not to make it is to never re-issue against an
// in-flight refund from here.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError, appErrorFromPostgrestMessage } from "../_shared/app-error.ts";
import { serviceRoleClient, userScopedClient } from "../_shared/supabase.ts";
import { razorpayRequest } from "../_shared/razorpay.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RefundBody {
  order_id?: unknown;
  amount?: unknown;
  reason?: unknown;
}

interface RefundRow {
  id: string;
  payment_intent_id: string;
  domain: string;
  entity_id: string;
  status: string;
  amount: number;
}

interface IntentRow {
  id: string;
  user_id: string;
  status: string;
  amount: number;
  razorpay_payment_id: string | null;
}

interface OrderRow {
  id: string;
  total: number;
}

interface RazorpayRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: string;
}

/**
 * Validates the caller's bearer token against GoTrue, then confirms the admin
 * role by reading `user_roles` through the caller's own JWT (the
 * admin-order-advance pattern; see that function for why NOT app_metadata).
 */
async function requireAdmin(req: Request): Promise<string> {
  const userClient = userScopedClient(req);

  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) {
    throw new AppError("UNAUTHENTICATED", "Invalid or expired session.", 401);
  }

  const { data: roleRow, error: roleError } = await userClient
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (roleError || !roleRow) {
    throw new AppError("FORBIDDEN", "Admin role required.", 403);
  }

  return data.user.id;
}

/** Rupees, 2dp. Rejects non-finite, non-positive, and over-precise amounts. */
function parseAmount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new AppError("VALIDATION", "amount must be a number (rupees).", 400);
  }
  if (raw <= 0) {
    throw new AppError("VALIDATION", "amount must be greater than zero.", 400);
  }
  // No sub-paise precision: the ledger and Razorpay both work in whole paise.
  if (Math.round(raw * 100) !== Number((raw * 100).toFixed(4))) {
    throw new AppError("VALIDATION", "amount must have at most 2 decimal places.", 400);
  }
  return Number(raw.toFixed(2));
}

function parseBody(raw: unknown): { orderId: string; amount: number; reason: string } {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const { order_id, amount, reason } = raw as RefundBody;

  if (typeof order_id !== "string" || !UUID_RE.test(order_id)) {
    throw new AppError("VALIDATION", "order_id must be a valid uuid.", 400);
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new AppError("VALIDATION", "reason is required.", 400);
  }

  return { orderId: order_id, amount: parseAmount(amount), reason: reason.trim() };
}

/** Rupees to paise, the unit Razorpay's refund API takes. */
function toPaise(amount: number): number {
  return Math.round(amount * 100);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Relay a Postgres `CODE: message` refusal from the claim RPC to the right
 * client status. INVALID_TRANSITION / NOT_FOUND / VALIDATION are already in the
 * shared status map; AMOUNT_EXCEEDS_REFUNDABLE and REFUND_IN_PROGRESS are 409s
 * this function names explicitly (both: a well-formed request the order's money
 * state refuses), without editing the shared _shared/app-error.ts map.
 */
function claimError(message: string): AppError {
  if (message.startsWith("AMOUNT_EXCEEDS_REFUNDABLE")) {
    const detail = message.replace(/^AMOUNT_EXCEEDS_REFUNDABLE:\s*/, "");
    return new AppError("AMOUNT_EXCEEDS_REFUNDABLE", detail, 409);
  }
  if (message.startsWith("REFUND_IN_PROGRESS")) {
    const detail = message.replace(/^REFUND_IN_PROGRESS:\s*/, "");
    return new AppError("REFUND_IN_PROGRESS", detail, 409);
  }
  return appErrorFromPostgrestMessage(message);
}

async function remainingRefundable(
  supabase: ReturnType<typeof serviceRoleClient>,
  orderId: string,
  orderTotal: number,
): Promise<number> {
  const { data } = await supabase
    .from("refunds")
    .select("amount,status")
    .eq("domain", "commerce")
    .eq("entity_id", orderId)
    .in("status", ["pending", "processed"]);

  const claimed = (data ?? []).reduce(
    (sum, r) => sum + Number((r as { amount: number }).amount),
    0,
  );
  return Number((orderTotal - claimed).toFixed(2));
}

Deno.serve((req) =>
  withErrorHandling(req, async (request) => {
    const preflight = handleCorsPreflight(request);
    if (preflight) return preflight;

    if (request.method !== "POST") {
      throw new AppError("VALIDATION", "Only POST is supported.", 405);
    }

    // Admin identity first, before any read of the order, so a non-admin learns
    // nothing about whether the order exists.
    const actorId = await requireAdmin(request);
    const body = parseBody(await request.json().catch(() => null));
    const supabase = serviceRoleClient();

    // ------------------------------------------------------------------
    // 1. Claim. The RPC enforces the state machine and the refundable
    //    ceiling atomically under an intent-row lock, then inserts the
    //    pending refunds row. Nothing here second-guesses either check.
    // ------------------------------------------------------------------
    const { data: claimed, error: claimErr } = await supabase
      .rpc("claim_order_refund", { p_order_id: body.orderId, p_amount: body.amount })
      .single<RefundRow>();

    if (claimErr) {
      throw claimError(claimErr.message);
    }
    if (!claimed) {
      throw new AppError("NOT_FOUND", `Order ${body.orderId} does not exist.`, 404);
    }
    const refund = claimed;

    // The order (for the response's remaining_refundable) and the captured
    // charge (for the Razorpay refund). Read after the claim, so an
    // INVALID_TRANSITION / AMOUNT_EXCEEDS_REFUNDABLE never reaches Razorpay.
    const [{ data: order }, { data: intent }] = await Promise.all([
      supabase.from("orders").select("id,total").eq("id", body.orderId).single<OrderRow>(),
      supabase
        .from("payment_intents")
        .select("id,user_id,status,amount,razorpay_payment_id")
        .eq("id", refund.payment_intent_id)
        .single<IntentRow>(),
    ]);

    if (!order || !intent) {
      // The claim succeeded, so both rows exist; a read failure here is a
      // server problem, not a client one.
      throw new AppError(
        "INTERNAL",
        `Refund ${refund.id} claimed but its order/intent could not be read.`,
        500,
      );
    }

    // ------------------------------------------------------------------
    // 2. Razorpay. A missing razorpay_payment_id (a synthetic-rail capture)
    //    means there is nothing real to call; leave the refund pending and
    //    report it honestly. On a real payment, issue the refund.
    // ------------------------------------------------------------------
    if (!intent.razorpay_payment_id) {
      return jsonResponse({
        refund_id: refund.id,
        order_id: order.id,
        refunded_amount: refund.amount,
        remaining_refundable: await remainingRefundable(supabase, order.id, order.total),
        payment_intent_status: intent.status,
        refund_status: "pending",
      });
    }

    let razorpayRefund: RazorpayRefund;
    try {
      razorpayRefund = await razorpayRequest<RazorpayRefund>(
        "POST",
        `/payments/${intent.razorpay_payment_id}/refund`,
        {
          amount: toPaise(refund.amount),
          speed: "normal",
          notes: {
            domain: "commerce",
            entity_id: order.id,
            refund_id: refund.id,
            reason: body.reason,
          },
        },
      );
    } catch (err) {
      // The refund stays pending, visible to admin and settleable by the
      // webhook if Razorpay actually accepted it. No re-issue happens from here.
      const detail = errorText(err);
      console.error(
        `admin-order-refund: Razorpay refund failed for order ${order.id}:`,
        detail,
      );
      await supabase
        .from("refunds")
        .update({ failure_reason: detail.slice(0, 500) })
        .eq("id", refund.id);

      return jsonResponse({
        refund_id: refund.id,
        order_id: order.id,
        refunded_amount: refund.amount,
        remaining_refundable: await remainingRefundable(supabase, order.id, order.total),
        payment_intent_status: intent.status,
        refund_status: "pending",
      });
    }

    // ------------------------------------------------------------------
    // 3. Settle. One RPC, service role, atomic, a no-op if the webhook beat
    //    us to it. Writes the reversing group and flips the charge to
    //    refunded / partially_refunded.
    // ------------------------------------------------------------------
    const { data: settled, error: settleErr } = await supabase
      .rpc("settle_refund", {
        p_refund_id: refund.id,
        p_razorpay_refund_id: razorpayRefund.id,
      })
      .single<RefundRow>();

    if (settleErr) {
      // Razorpay HAS refunded; only our bookkeeping failed. Do not retry the
      // refund. The row keeps its provider id; refund.processed settles it.
      console.error(
        `admin-order-refund: refund ${razorpayRefund.id} issued but settle_refund failed:`,
        settleErr.message,
      );
      await supabase
        .from("refunds")
        .update({
          razorpay_refund_id: razorpayRefund.id,
          failure_reason:
            `Refund issued at Razorpay but ledger settlement failed: ${settleErr.message}`
              .slice(0, 500),
        })
        .eq("id", refund.id);

      return jsonResponse({
        refund_id: refund.id,
        order_id: order.id,
        refunded_amount: refund.amount,
        remaining_refundable: await remainingRefundable(supabase, order.id, order.total),
        payment_intent_status: intent.status,
        refund_status: "pending",
      });
    }

    // ------------------------------------------------------------------
    // 4. The charge's new status (refunded vs partially_refunded), read after
    //    settle set it, and exactly one audit_log row (FR-53).
    // ------------------------------------------------------------------
    const { data: afterIntent } = await supabase
      .from("payment_intents")
      .select("status")
      .eq("id", intent.id)
      .single<{ status: string }>();

    const { error: auditError } = await supabase.from("audit_log").insert({
      actor_id: actorId,
      action: "order.refund",
      entity_type: "order",
      entity_id: order.id,
      before: { payment_intent_status: intent.status },
      after: {
        payment_intent_status: afterIntent?.status ?? null,
        refund_id: refund.id,
        refunded_amount: settled.amount,
      },
      note: body.reason,
    });

    if (auditError) {
      throw new AppError(
        "INTERNAL",
        `Refund ${refund.id} settled but the audit row failed: ${auditError.message}`,
        500,
      );
    }

    return jsonResponse({
      refund_id: refund.id,
      order_id: order.id,
      refunded_amount: settled.amount,
      remaining_refundable: await remainingRefundable(supabase, order.id, order.total),
      payment_intent_status: afterIntent?.status ?? intent.status,
      refund_status: settled.status,
    });
  })
);
