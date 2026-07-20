// ATLITOS v2 — supabase/functions/_shared/finalize-order-payment.ts
//
// The `commerce` domain's leg of the shared capture gate in
// finalize-payment.ts. Epic P4, stories AT-72 and AT-73.
// Requirements: PRD-07 FR-21, FR-22, FR-23.
//
// The THIRD domain, deliberately built to the shape of the two that came
// before it (finalize-court-booking-payment.ts, finalize-session-payment.ts)
// rather than to a new one: called only with an intent the gate just flipped
// from `created` to `captured`, so everything here runs exactly once per
// charge; one RPC for the state half, one multi-row INSERT for the ledger
// half; a `describe*` read-only probe for the gate's already-processed branch.
//
// ============================================================================
// ONE DIFFERENCE FROM ITS TWO NEIGHBOURS, AND IT IS THE IMPORTANT ONE
//
// Courts and sessions hand this gate an entity that already exists: the
// booking was inserted `pending_payment`, the session was inserted
// `requested`. Commerce does not. PAYMENTS.md keeps the `orders` row until
// capture on purpose, "so `placed` never exists without a paid intent behind
// it", which means this handler CREATES the entity rather than transitioning
// one. Two consequences the gate has to respect, both handled in
// finalize-payment.ts: the commerce branch runs BEFORE the null entity_id
// short circuit, and entity_id is written by place_order_from_draft inside the
// same transaction as the order.
//
// ============================================================================
// WHAT IS IN THE TRANSACTION, AND WHY THE LEDGER IS NOT
//
// place_order_from_draft (0038) does consume_reservation, the orders insert,
// the order_items insert, the first order_timeline row and the cart clear, all
// in ONE transaction, which is PRD-07 FR-21 literally: "a payment success with
// a failed stock decrement is not a reachable state".
//
// The balanced ledger group is then written here, from the edge function,
// exactly as finalize-court-booking-payment.ts writes its own. That is not an
// oversight: CLAUDE.md says "ledger writes happen only in edge functions
// running under the service role", and one supabase-js `.insert([...])` call
// is one INSERT statement, which is one atomic write of the whole group with
// assert_ledger_group_balanced checking it. Writing the group inside the RPC
// would have been the easier code and the wrong precedent.
//
// The residual gap that ordering leaves (order created, ledger write failed)
// is covered the way AT-41 covers the identical gap for session accruals: this
// function checks for an existing group before writing, and writes a missing
// one on a later call, so a redelivered webhook repairs the books rather than
// duplicating them.
//
// ============================================================================
// THE GROUP, PER D1
//
// For an order of 1000 subtotal, 50 delivery, 180 GST, 20 roundup:
//
//   debit  platform   1250.00  clearing: order <id> payment captured
//   credit platform   1230.00  commerce revenue, order <id>
//   credit platform     20.00  donation roundup held for Empower allocation
//
// Commerce is first party in v1 (D1), so there is no seller leg and no
// platform fee leg. The roundup gets its OWN leg even though both legs are
// `platform`, so P6 can find every roundup rupee with one indexed query and
// move it to a real `upa_fund` account_ref without re-reading order rows.
//
// WHEN THE ROUNDUP IS ZERO THERE IS NO THIRD LEG AT ALL. The founder's
// rounding rule (round the total up to the next multiple of 10) produces zero
// whenever the total already lands on a multiple, and that is a common case,
// not an edge case. A 0.00 leg would balance and would be junk: it records a
// donation that did not happen, and every P6 query looking for roundup rupees
// would have to filter it back out. Two legs, not three, and the group still
// balances exactly.
//
// ============================================================================
// AT-73: THE LATE CAPTURE
//
// consume_reservation raises OUT_OF_STOCK if the guarded decrement cannot be
// applied because the TTL lapsed and the stock genuinely went to someone else.
// That rolls place_order_from_draft's whole transaction back, so NO order row
// exists, which is the only correct outcome: the shopper's money must not sit
// against an order that cannot be fulfilled. D2 names the resolution and names
// the machinery to use, and forbids inventing a second one, so this reuses
// AT-60's `refunds` row plus `settle_refund` verbatim.
//
// The refunds row carries `entity_id = payment_intent_id` for this one case,
// because there is no order to point at, and `refunds_one_per_entity` on
// (domain, entity_id) is then what makes a redelivered webhook converge on one
// refund instead of two.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./app-error.ts";
import { round2 } from "./fee-config.ts";
import { razorpayRequest } from "./razorpay.ts";
import type { CapturedIntent, FinalizeResult } from "./finalize-payment.ts";

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  subtotal: number;
  delivery_charges: number;
  gst_and_others: number;
  donation_roundup: number;
  total: number;
}

interface RazorpayRefund {
  id: string;
  status: string;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function finalizeOrderCaptured(
  supabase: SupabaseClient,
  intent: CapturedIntent,
): Promise<FinalizeResult> {
  // The whole state half, in one transaction. See the header.
  const { data: order, error: placeError } = await supabase
    .rpc("place_order_from_draft", { p_payment_intent_id: intent.id })
    .single<OrderRow>();

  if (placeError) {
    if (placeError.message.startsWith("OUT_OF_STOCK")) {
      // AT-73. No order was created. Give the money back through AT-60's
      // machinery, not a second refund path.
      const refundOutcome = await refundUnfulfillableCapture(supabase, intent);
      return {
        outcome: "captured",
        domain: "commerce",
        entityId: "",
        entityStatus: `unfulfillable_${refundOutcome}`,
      };
    }
    throw new AppError(
      "INTERNAL",
      `place_order_from_draft failed for intent ${intent.id}: ${placeError.message}`,
      500,
    );
  }

  await writeCommerceLedgerGroup(supabase, intent, order);

  return {
    outcome: "captured",
    domain: "commerce",
    entityId: order.id,
    entityStatus: order.status,
  };
}

/**
 * The balanced group. Idempotent by inspection rather than by hope: if any
 * commerce ledger row already exists for this order, the group was written by
 * an earlier call and writing it again would double the platform's recorded
 * revenue for one sale.
 */
async function writeCommerceLedgerGroup(
  supabase: SupabaseClient,
  intent: CapturedIntent,
  order: OrderRow,
): Promise<void> {
  const { data: existing, error: existingError } = await supabase
    .from("ledger_entries")
    .select("id")
    .eq("domain", "commerce")
    .eq("entity_id", order.id)
    .limit(1);

  if (existingError) {
    throw new AppError(
      "INTERNAL",
      `Failed to check existing ledger group for order ${order.id}: ${existingError.message}`,
      500,
    );
  }
  if (existing && existing.length > 0) return;

  const entryGroupId = crypto.randomUUID();
  const roundup = round2(order.donation_roundup);
  const revenue = round2(order.total - roundup);

  const legs: Record<string, unknown>[] = [
    {
      entry_group_id: entryGroupId,
      payment_intent_id: intent.id,
      account_type: "platform",
      account_ref: null,
      direction: "debit",
      amount: order.total,
      domain: "commerce",
      entity_id: order.id,
      description: `Clearing: order ${order.order_number} payment captured`,
    },
    {
      entry_group_id: entryGroupId,
      payment_intent_id: intent.id,
      account_type: "platform",
      account_ref: null,
      direction: "credit",
      amount: revenue,
      domain: "commerce",
      entity_id: order.id,
      description: `Commerce revenue, order ${order.order_number}`,
    },
  ];

  // The zero case writes no third leg. See the header: a 0.00 donation leg
  // would balance and would record a donation that never happened.
  if (roundup > 0) {
    legs.push({
      entry_group_id: entryGroupId,
      payment_intent_id: intent.id,
      account_type: "platform",
      account_ref: null,
      direction: "credit",
      amount: roundup,
      domain: "commerce",
      entity_id: order.id,
      description:
        `Donation roundup held for Empower allocation, order ${order.order_number}`,
    });
  }

  const { error: ledgerError } = await supabase.from("ledger_entries").insert(legs);

  if (ledgerError) {
    throw new AppError(
      "INTERNAL",
      `Failed to write ledger_entries for order ${order.id}: ${ledgerError.message}`,
      500,
    );
  }
}

/**
 * AT-73's automatic refund, for the one case D2 says is reachable: a capture
 * that arrived after the TTL against stock that has since sold. No order
 * exists and none may be created, so the money goes straight back.
 *
 * Returns a short outcome word for the gate's `entityStatus`, never throws:
 * the charge itself is already captured and durably recorded, and throwing
 * here would make razorpay-webhook retry a capture it has already processed.
 */
async function refundUnfulfillableCapture(
  supabase: SupabaseClient,
  intent: CapturedIntent,
): Promise<string> {
  console.error(
    `finalize-order-payment: intent ${intent.id} captured but stock was gone; refunding in full.`,
  );

  const { data: intentRow } = await supabase
    .from("payment_intents")
    .select("id, user_id, amount, razorpay_payment_id")
    .eq("id", intent.id)
    .maybeSingle<
      { id: string; user_id: string; amount: number; razorpay_payment_id: string | null }
    >();

  if (!intentRow || !intentRow.razorpay_payment_id) {
    console.error(
      `finalize-order-payment: no razorpay_payment_id on intent ${intent.id}; refund left for admin.`,
    );
    return "refund_pending";
  }

  // Claim the refund. Losing this insert means another delivery already owns
  // it, which is exactly what refunds_one_per_entity is for.
  const { data: inserted, error: insertError } = await supabase
    .from("refunds")
    .insert({
      payment_intent_id: intentRow.id,
      domain: "commerce",
      // No order row exists, so the charge itself is the entity. See header.
      entity_id: intentRow.id,
      amount: intentRow.amount,
    })
    .select("id, status")
    .maybeSingle<{ id: string; status: string }>();

  let refundId: string;
  if (insertError) {
    if (insertError.code !== "23505") {
      console.error(
        `finalize-order-payment: could not record refund for intent ${intent.id}:`,
        insertError.message,
      );
      return "refund_pending";
    }
    const { data: existing } = await supabase
      .from("refunds")
      .select("id, status")
      .eq("domain", "commerce")
      .eq("entity_id", intentRow.id)
      .maybeSingle<{ id: string; status: string }>();

    if (!existing) return "refund_pending";
    if (existing.status === "processed") return "refunded";
    refundId = existing.id;
  } else if (inserted) {
    refundId = inserted.id;
  } else {
    return "refund_pending";
  }

  let razorpayRefund: RazorpayRefund;
  try {
    razorpayRefund = await razorpayRequest<RazorpayRefund>(
      "POST",
      `/payments/${intentRow.razorpay_payment_id}/refund`,
      {
        amount: Math.round(intentRow.amount * 100),
        speed: "normal",
        notes: {
          domain: "commerce",
          payment_intent_id: intentRow.id,
          reason: "stock sold out before capture, no order created",
        },
      },
    );
  } catch (err) {
    const detail = errorText(err);
    console.error(
      `finalize-order-payment: Razorpay refund failed for intent ${intent.id}:`,
      detail,
    );
    await supabase
      .from("refunds")
      .update({ failure_reason: detail.slice(0, 500) })
      .eq("id", refundId);
    return "refund_pending";
  }

  const { error: settleError } = await supabase.rpc("settle_refund", {
    p_refund_id: refundId,
    p_razorpay_refund_id: razorpayRefund.id,
  });

  if (settleError) {
    // Razorpay HAS refunded; only the bookkeeping failed. Do not retry the
    // refund. The refund.processed webhook settles it when it arrives.
    console.error(
      `finalize-order-payment: refund ${razorpayRefund.id} issued but settle_refund failed:`,
      settleError.message,
    );
    await supabase
      .from("refunds")
      .update({ razorpay_refund_id: razorpayRefund.id })
      .eq("id", refundId);
    return "refund_pending";
  }

  return "refunded";
}

/** Read-only status probe for the already-processed branch of the gate. */
export async function describeOrder(
  supabase: SupabaseClient,
  orderId: string,
): Promise<string> {
  const { data } = await supabase
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle<{ status: string }>();

  return data?.status ?? "unknown";
}
