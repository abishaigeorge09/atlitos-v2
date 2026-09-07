// ATLITOS v2 — supabase/functions/checkout/index.ts
//
// POST with the shopper's own JWT. Epic P4, story AT-71.
// Requirements: PRD-07 FR-16, FR-17, FR-18, FR-19, FR-20.
// Implements PAYMENTS.md's `checkout` sequence and PHASE-4-STATUS.md D1, D2
// and the two founder decisions of 2026-07-20.
//
// Request:
//   {
//     items: [{ product_variant_id, qty }],
//     address_id,
//     donation_roundup: boolean,          // the FR-16 checkbox, not an amount
//     subtotal?, delivery_charges?, gst_and_others?, total?   // FR-17's bill
//   }
//
// Response:
//   { payment_intent_id, razorpay_order_id, key_id, amount, currency, bill }
//
// The order is NOT created here and `orders` is not touched. PAYMENTS.md:
// "the `orders` row itself is not created at this step, only after the webhook
// confirms capture, so `placed` never exists without a paid intent behind it."
// What IS created here is the priced draft (0038's order_drafts) that the
// finalize handler copies from, because D4 forbids recomputing the bill after
// the money landed.
//
// ============================================================================
// THE SEQUENCE, AND WHY EACH STEP IS WHERE IT IS
//
//   1. Authenticate, and re-derive the address against the caller's real
//      auth.uid(). This function runs as service_role and so bypasses RLS,
//      which means a client-supplied address_id is an untrusted pointer at a
//      table full of OTHER people's addresses until it is checked. CLAUDE.md's
//      "RLS is not scoping" rule, in the one place where ignoring it would
//      ship a stranger's parcel to the wrong door.
//   2. RE-PRICE FROM SCRATCH. Every number is derived from product_variants,
//      products and fee_config. The client's submitted total is compared, never
//      consumed. Mismatch is PRICE_MISMATCH (FR-19) and nothing else runs.
//   3. Availability pre-check through the shared view, so an out of stock cart
//      is refused with OUT_OF_STOCK (FR-20) before a payment intent even
//      exists. reserve_stock_for_checkout re-checks authoritatively under a row
//      lock; this pre-check exists to name the offending lines cleanly and to
//      avoid manufacturing intents for carts that were never going to sell.
//   4. payment_intents row (placeholder order id, the shape PAYMENTS.md's
//      shared helper documents).
//   5. RESERVE STOCK, BEFORE RAZORPAY. D2's whole point. If the reservation
//      cannot be taken, no charge is ever attempted.
//   6. The order draft.
//   7. Razorpay. If this throws, the reservation is RELEASED (D2 exit 2) and
//      the intent is failed, so the units go straight back to the sellable pool
//      rather than waiting out the 15 minute TTL.
//
// ============================================================================
// THE MONEY, PER D1 AND THE FOUNDER DECISIONS
//
//   subtotal          sum(effective_price * qty), server derived
//   delivery_charges  fee_config commerce.delivery_flat, flat per order
//   gst_and_others    fee_config commerce.gst_percent applied to subtotal
//   donation_roundup  ceil(preRoundupTotal / m) * m - preRoundupTotal,
//                     where m is fee_config commerce.donation_roundup_multiple
//   total             subtotal + delivery + gst + roundup
//
// No platform fee row. Atlitos is the seller of record for v1 gear, so there
// is no counterparty to split with (D1). Delivery is added BEFORE the roundup
// is derived, which the founder called out explicitly as an ordering
// dependency: rounding first and then adding delivery would produce a total
// that is not a multiple of anything.
//
// THE ROUNDUP CAN BE ZERO, and that is the case worth reading twice. When the
// post-delivery, post-GST total already lands on a multiple of 10 there is
// nothing to round up, the BillSummary row is suppressed rather than showing
// 0.00, and the finalize handler writes NO donation ledger leg. A 0.00 leg
// would technically balance while recording an event that did not happen.
//
// All roundup arithmetic is done in PAISE, as integers. `ceil` on a float
// rupee amount is exactly the kind of expression that returns 123.00000000001
// and charges a shopper an extra rupee, and integer modulo cannot.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError, appErrorFromPostgrestMessage } from "../_shared/app-error.ts";
import {
  getAuthenticatedUser,
  serviceRoleClient,
} from "../_shared/supabase.ts";
import { createOrder, razorpayKeyId } from "../_shared/razorpay.ts";
import { getActiveFeeConfig, round2 } from "../_shared/fee-config.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CheckoutLineInput {
  product_variant_id: string;
  qty: number;
}

interface CheckoutRequestBody {
  items: CheckoutLineInput[];
  address_id: string;
  donation_roundup: boolean;
  /** FR-17's client computed bill, compared and never consumed. */
  subtotal?: number;
  delivery_charges?: number;
  gst_and_others?: number;
  total?: number;
  /** The client's own roundup figure, carried only so the comparison below can
   * catch a client that computed it wrong. Declared rather than smuggled in
   * through a `Record<string, unknown>` cast, which did not typecheck. */
  __client_roundup?: number;
}

interface AddressRow {
  id: string;
  user_id: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
}

interface AvailabilityRow {
  product_variant_id: string;
  product_id: string;
  size: string | null;
  color: string | null;
  effective_price: number;
  available_stock: number;
}

interface PricedLine {
  product_variant_id: string;
  qty: number;
  unit_price: number;
  product_title_snapshot: string;
  variant_label_snapshot: string;
}

function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

function fromPaise(paise: number): number {
  return round2(paise / 100);
}

/**
 * The founder's rule, in integer arithmetic: the distance from the total up to
 * the next multiple of `multiple`. Zero when the total already lands on one,
 * which is a real and reachable answer, not a failure to compute.
 */
function roundupPaise(preRoundupPaise: number, multiplePaise: number): number {
  if (multiplePaise <= 0) return 0;
  const remainder = preRoundupPaise % multiplePaise;
  return remainder === 0 ? 0 : multiplePaise - remainder;
}

function parseRequestBody(raw: unknown): CheckoutRequestBody {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const body = raw as Record<string, unknown>;

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new AppError("VALIDATION", "items must be a non empty array.", 400);
  }

  const seen = new Set<string>();
  const items: CheckoutLineInput[] = body.items.map((raw) => {
    const line = raw as Record<string, unknown>;
    const id = line.product_variant_id;
    const qty = line.qty;
    if (typeof id !== "string" || !UUID_RE.test(id)) {
      throw new AppError("VALIDATION", "Every item needs a product_variant_id uuid.", 400);
    }
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty <= 0) {
      throw new AppError("VALIDATION", "Every item needs a whole qty greater than zero.", 400);
    }
    if (seen.has(id)) {
      // reserve_stock_for_checkout refuses a duplicated variant outright, so
      // catch it here with a message that says what to do about it.
      throw new AppError(
        "VALIDATION",
        "The same product variant appears twice; merge the quantities first.",
        400,
      );
    }
    seen.add(id);
    return { product_variant_id: id, qty };
  });

  if (typeof body.address_id !== "string" || !UUID_RE.test(body.address_id)) {
    throw new AppError("NO_ADDRESS", "A saved delivery address is required.", 400);
  }

  // FR-16's checkbox. A number is accepted too, for the client that still
  // sends the pre-decision `donationRoundup` amount: any non zero value reads
  // as opted in, and the amount itself is re-derived server side regardless,
  // then compared like every other line of the bill.
  const roundupInput = body.donation_roundup;
  let donationRoundup: boolean;
  if (typeof roundupInput === "boolean") {
    donationRoundup = roundupInput;
  } else if (typeof roundupInput === "number") {
    donationRoundup = roundupInput > 0;
  } else if (roundupInput === undefined || roundupInput === null) {
    donationRoundup = false;
  } else {
    throw new AppError("VALIDATION", "donation_roundup must be true or false.", 400);
  }

  const parsed: CheckoutRequestBody = {
    items,
    address_id: body.address_id,
    donation_roundup: donationRoundup,
  };

  for (const key of ["subtotal", "delivery_charges", "gst_and_others", "total"] as const) {
    const value = body[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new AppError("VALIDATION", `${key} must be a non negative number.`, 400);
    }
    parsed[key] = value;
  }

  if (typeof roundupInput === "number") {
    // Carried through only so the comparison below can catch a client that
    // computed the roundup itself and got it wrong.
    parsed.__client_roundup = roundupInput;
  }

  return parsed;
}

/** Size and colour into one human label, no hyphens, per house style. */
function variantLabel(size: string | null, color: string | null): string {
  const parts = [size, color].filter((part): part is string => !!part && part.trim() !== "");
  return parts.length > 0 ? parts.join(" / ") : "Standard";
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
    // 1. The address, scoped to the caller. See the header.
    // ------------------------------------------------------------------
    const { data: address, error: addressError } = await supabase
      .from("addresses")
      .select("id, user_id, line1, line2, city, state, pincode")
      .eq("id", body.address_id)
      .eq("user_id", user.id)
      .maybeSingle<AddressRow>();

    if (addressError) {
      throw new AppError("INTERNAL", `Failed to load address: ${addressError.message}`, 500);
    }
    if (!address) {
      throw new AppError(
        "NO_ADDRESS",
        "That delivery address does not exist on this account.",
        404,
      );
    }

    // ------------------------------------------------------------------
    // 2. Re-price from scratch (FR-18). Nothing the client sent is used as
    //    an input to any number below; it is only ever compared at the end.
    // ------------------------------------------------------------------
    const variantIds = body.items.map((line) => line.product_variant_id);

    const { data: availability, error: availabilityError } = await supabase
      .from("product_variant_availability")
      .select("product_variant_id, product_id, size, color, effective_price, available_stock")
      .in("product_variant_id", variantIds)
      .returns<AvailabilityRow[]>();

    if (availabilityError) {
      throw new AppError(
        "INTERNAL",
        `Failed to load variant availability: ${availabilityError.message}`,
        500,
      );
    }

    const availabilityById = new Map(
      (availability ?? []).map((row) => [row.product_variant_id, row]),
    );

    // A variant missing from the view is a variant of a deactivated product
    // (0033 reproduces the `products.active` predicate inside the view), or a
    // variant that does not exist. Both are "you cannot buy this", and both
    // are the shopper's cue to go back to cart, so both are OUT_OF_STOCK
    // rather than a 404 that a cart screen has no way to render.
    const missing = variantIds.filter((id) => !availabilityById.has(id));
    if (missing.length > 0) {
      throw new AppError(
        "OUT_OF_STOCK",
        `These items are no longer available: ${missing.join(", ")}`,
        409,
      );
    }

    const productIds = [...new Set((availability ?? []).map((row) => row.product_id))];
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, title")
      .in("id", productIds)
      .returns<{ id: string; title: string }[]>();

    if (productsError) {
      throw new AppError("INTERNAL", `Failed to load products: ${productsError.message}`, 500);
    }
    const titleById = new Map((products ?? []).map((row) => [row.id, row.title]));

    // ------------------------------------------------------------------
    // 3. Availability pre-check (FR-20). Every offending line, not the first.
    // ------------------------------------------------------------------
    const outOfStock = body.items
      .filter((line) => {
        const row = availabilityById.get(line.product_variant_id) as AvailabilityRow;
        return row.available_stock < line.qty;
      })
      .map((line) => line.product_variant_id);

    if (outOfStock.length > 0) {
      throw new AppError(
        "OUT_OF_STOCK",
        `Not enough stock for variant(s): ${outOfStock.join(", ")}`,
        409,
      );
    }

    const pricedLines: PricedLine[] = body.items.map((line) => {
      const row = availabilityById.get(line.product_variant_id) as AvailabilityRow;
      return {
        product_variant_id: line.product_variant_id,
        qty: line.qty,
        unit_price: round2(row.effective_price),
        product_title_snapshot: titleById.get(row.product_id) ?? "Item",
        variant_label_snapshot: variantLabel(row.size, row.color),
      };
    });

    // Paise throughout, so the bill is exact integer arithmetic and the
    // rounding rule cannot drift by a floating point epsilon.
    const subtotalPaise = pricedLines.reduce(
      (sum, line) => sum + toPaise(line.unit_price) * line.qty,
      0,
    );

    const deliveryConfig = await getActiveFeeConfig(supabase, "commerce", "delivery_flat");
    const gstConfig = await getActiveFeeConfig(supabase, "commerce", "gst_percent");
    const multipleConfig = await getActiveFeeConfig(
      supabase,
      "commerce",
      "donation_roundup_multiple",
    );

    const deliveryPaise = toPaise(deliveryConfig.value);
    const gstPaise = Math.round(subtotalPaise * gstConfig.value);
    const preRoundupPaise = subtotalPaise + deliveryPaise + gstPaise;
    const roundup = body.donation_roundup
      ? roundupPaise(preRoundupPaise, toPaise(multipleConfig.value))
      : 0;
    const totalPaise = preRoundupPaise + roundup;

    const bill = {
      subtotal: fromPaise(subtotalPaise),
      delivery_charges: fromPaise(deliveryPaise),
      gst_and_others: fromPaise(gstPaise),
      donation_roundup: fromPaise(roundup),
      total: fromPaise(totalPaise),
    };

    // ------------------------------------------------------------------
    // FR-19. Every figure the client chose to send is checked, not just the
    // total, so a client whose subtotal and GST are both wrong by offsetting
    // amounts is still caught. The corrected bill rides along on the error so
    // the client can re-display BillSummary for confirmation without a second
    // round trip.
    // ------------------------------------------------------------------
    const clientRoundup = body.__client_roundup;
    const mismatches: string[] = [];
    const compare = (label: string, expected: number, actual: number | undefined) => {
      if (actual === undefined) return;
      if (toPaise(actual) !== toPaise(expected)) mismatches.push(label);
    };
    compare("subtotal", bill.subtotal, body.subtotal);
    compare("delivery_charges", bill.delivery_charges, body.delivery_charges);
    compare("gst_and_others", bill.gst_and_others, body.gst_and_others);
    compare("total", bill.total, body.total);
    if (typeof clientRoundup === "number") {
      compare("donation_roundup", bill.donation_roundup, clientRoundup);
    }

    if (mismatches.length > 0) {
      throw new AppError(
        "PRICE_MISMATCH",
        `The bill changed since you opened checkout (${mismatches.join(", ")}). Review the updated total and try again.`,
        409,
      );
    }

    // ------------------------------------------------------------------
    // 4. The payment intent. entity_id stays null: commerce is the domain
    //    whose entity row is created BY the finalize handler, and
    //    place_order_from_draft sets it in the same transaction as the order.
    // ------------------------------------------------------------------
    const placeholderOrderId = `pending:${crypto.randomUUID()}`;
    const { data: intent, error: intentInsertError } = await supabase
      .from("payment_intents")
      .insert({
        user_id: user.id,
        domain: "commerce",
        entity_id: null,
        amount: bill.total,
        status: "created",
        razorpay_order_id: placeholderOrderId,
      })
      .select("id")
      .single<{ id: string }>();

    if (intentInsertError || !intent) {
      throw new AppError(
        "INTERNAL",
        `Failed to create payment_intent: ${intentInsertError?.message}`,
        500,
      );
    }

    // ------------------------------------------------------------------
    // 5. RESERVE BEFORE RAZORPAY. D2. All lines or none, under a row lock in
    //    ascending variant id order, re-deriving availability after the lock.
    //    This is the authoritative stock check; step 3 was only an optimistic
    //    pre-check that narrows the race window without closing it.
    // ------------------------------------------------------------------
    const { error: reserveError } = await supabase.rpc("reserve_stock_for_checkout", {
      p_payment_intent_id: intent.id,
      p_lines: body.items.map((line) => ({
        product_variant_id: line.product_variant_id,
        qty: line.qty,
      })),
    });

    if (reserveError) {
      await supabase
        .from("payment_intents")
        .update({ status: "failed" })
        .eq("id", intent.id);
      throw appErrorFromPostgrestMessage(reserveError.message);
    }

    // ------------------------------------------------------------------
    // 6. The draft: the bill exactly as priced above, frozen. The finalize
    //    handler copies it; it never recomputes (D4).
    // ------------------------------------------------------------------
    const { error: draftError } = await supabase.from("order_drafts").insert({
      payment_intent_id: intent.id,
      user_id: user.id,
      address_id: address.id,
      ship_to_line1: address.line1,
      ship_to_line2: address.line2,
      ship_to_city: address.city,
      ship_to_state: address.state,
      ship_to_pincode: address.pincode,
      subtotal: bill.subtotal,
      delivery_charges: bill.delivery_charges,
      gst_and_others: bill.gst_and_others,
      donation_roundup: bill.donation_roundup,
      total: bill.total,
      lines: pricedLines,
    });

    if (draftError) {
      await supabase
        .rpc("release_reservation", {
          p_payment_intent_id: intent.id,
          p_reason: "checkout could not record the priced bill",
        })
        .then(() => undefined, () => undefined);
      await supabase
        .from("payment_intents")
        .update({ status: "failed" })
        .eq("id", intent.id);
      throw new AppError("INTERNAL", `Failed to record order draft: ${draftError.message}`, 500);
    }

    // ------------------------------------------------------------------
    // 7. Razorpay, last, once everything that can refuse the sale already has.
    // ------------------------------------------------------------------
    try {
      const order = await createOrder({
        amountPaise: totalPaise,
        currency: "INR",
        receipt: intent.id,
        notes: {
          domain: "commerce",
          // No order row exists yet, so the intent id is what identifies this
          // charge to the webhook. PAYMENTS.md allows exactly this: entity_id
          // falls back to the intent id when the domain row does not exist.
          entity_id: intent.id,
          payment_intent_id: intent.id,
        },
      });

      const { error: intentUpdateError } = await supabase
        .from("payment_intents")
        .update({ razorpay_order_id: order.id })
        .eq("id", intent.id);

      if (intentUpdateError) {
        throw new AppError(
          "INTERNAL",
          `Failed to persist razorpay_order_id: ${intentUpdateError.message}`,
          500,
        );
      }

      return jsonResponse(
        {
          payment_intent_id: intent.id,
          razorpay_order_id: order.id,
          key_id: razorpayKeyId(),
          amount: totalPaise,
          currency: "INR",
          bill,
        },
        200,
      );
    } catch (err) {
      // D2 exit 2, the synchronous half. Nothing was decremented, so there is
      // no "add it back" step to get wrong: the held rows become `released`
      // and the units are sellable again immediately rather than after the 15
      // minute TTL. Best effort, because the original error is what the
      // shopper needs to see.
      await supabase
        .rpc("release_reservation", {
          p_payment_intent_id: intent.id,
          p_reason: "razorpay order creation failed at checkout",
        })
        .then(() => undefined, () => undefined);
      await supabase
        .from("payment_intents")
        .update({ status: "failed" })
        .eq("id", intent.id);

      if (err instanceof AppError) throw err;
      throw appErrorFromPostgrestMessage(
        err instanceof Error ? err.message : "INTERNAL: unknown error",
      );
    }
  })
);
