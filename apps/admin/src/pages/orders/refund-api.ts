import { supabaseClient } from "../../providers/supabaseClient";
import type { CommerceError } from "../commerce/api";

// Phase 4 Track A. The admin refund call, kept in the orders bundle (this
// track owns apps/admin/src/pages/orders/**, not commerce/api.ts).
//
// Mirrors commerce/api.ts's advanceOrder posture exactly: the only mutation is
// a POST to the admin-order-refund EDGE FUNCTION, carrying the signed-in admin's
// own JWT. Nothing here writes a money row or an order status by table update
// (PRD-04 FR-26, CLAUDE.md financial invariant). The refundable ceiling and the
// state machine are re-derived server side inside claim_order_refund; the number
// this file reads is display only and is never trusted as authoritative.

export type { CommerceError } from "../commerce/api";

export interface OrderRefundRow {
  id: string;
  amount: number;
  status: "pending" | "processed" | "failed";
  razorpay_refund_id: string | null;
  failure_reason: string | null;
  created_at: string;
}

export interface RefundResult {
  refund_id: string;
  order_id: string;
  refunded_amount: number;
  remaining_refundable: number;
  payment_intent_status: "refunded" | "partially_refunded" | string;
  refund_status: "processed" | "pending";
}

/**
 * The order's refunds, read directly through the admin's own JWT
 * (refunds_select_admin RLS, 0026). Display only: "previously refunded" and
 * "remaining refundable" on this screen are computed from these rows, but the
 * server recomputes the ceiling authoritatively at refund time.
 */
export async function fetchOrderRefunds(orderId: string): Promise<OrderRefundRow[]> {
  const { data, error } = await supabaseClient
    .from("refunds")
    .select("id,amount,status,razorpay_refund_id,failure_reason,created_at")
    .eq("domain", "commerce")
    .eq("entity_id", orderId)
    .order("created_at", { ascending: true });

  if (error) throw { code: "INTERNAL", message: error.message } satisfies CommerceError;
  return (data as OrderRefundRow[]) ?? [];
}

/**
 * Issues one refund through the edge function. Does NOT decide whether the
 * amount is refundable or whether the charge can be refunded; claim_order_refund
 * owns both and raises AMOUNT_EXCEEDS_REFUNDABLE / INVALID_TRANSITION, which are
 * surfaced verbatim rather than swallowed (the AT-82 rule).
 */
export async function refundOrder(input: {
  orderId: string;
  amount: number;
  reason: string;
}): Promise<RefundResult> {
  const { data, error } = await supabaseClient.functions.invoke("admin-order-refund", {
    body: {
      order_id: input.orderId,
      amount: input.amount,
      reason: input.reason,
    },
  });

  if (error) {
    // supabase-js surfaces a non-2xx as FunctionsHttpError and keeps the body on
    // `context`. Read it so the admin sees the real code (AMOUNT_EXCEEDS_-
    // REFUNDABLE, INVALID_TRANSITION, ...) instead of a generic failure.
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const body = (await context.json()) as { error?: CommerceError };
        if (body?.error?.code) throw body.error;
      } catch (parsed) {
        if (parsed && typeof parsed === "object" && "code" in parsed) throw parsed;
      }
    }
    throw { code: "INTERNAL", message: error.message } satisfies CommerceError;
  }

  return data as RefundResult;
}
