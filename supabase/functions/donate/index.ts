// ATLITOS v2 — supabase/functions/donate/index.ts
//
// POST with the donor's own JWT:
//   { upa_id, item_id?, amount, expected_total?, method?: 'standalone' }
//
// Epic AT-8, story AT-111. Requirements: PRD-06 FR-5, FR-7, FR-8, FR-15, FR-16,
// FR-19. Implements PAYMENTS.md's `donate` sequence, the FOURTH payment domain,
// built to book-session's shape (caller's own JWT, re-validate, one Razorpay
// order), never a new pattern.
//
// The donations row does NOT exist yet at this step (PHASE-6-STATUS.md line 40):
// this function creates ONLY the payment_intents row (domain='donation',
// entity_id=NULL) and the Razorpay order, plus a donation_drafts row staging the
// {upa_id, item_id, donor_id, amount} the finalize handler copies from (the
// order_drafts precedent). finalize-donation-payment writes the donations row,
// the funded_amount move, and the balanced ledger group on capture.
//
// WHAT IS RE-VALIDATED HERE, BEFORE RAZORPAY (never a client cache, PRD-06 FR-16):
//   - The UPA exists and is status='verified'. An unverified/deactivated UPA is
//     unresolvable: 404 NOT_FOUND, the same answer as a nonexistent id, so a
//     donor cannot fund a UPA that is not live (isolation gate, AT-128).
//   - If item-specific, the item belongs to this UPA and is still open with
//     funded_amount < cost. Otherwise ITEM_FUNDED 409, before any charge. This
//     is where the item-funded race is stopped; the finalize re-check only keeps
//     funded_amount race-safe (it never rejects a captured donation).
//   - amount >= fee_config donations.min_amount (MIN_AMOUNT), the donation floor.
//   - The server figure is authoritative. amount is rounded server side and, if
//     the client sends the expected_total its BillSummary displayed, a mismatch
//     is PRICE_MISMATCH 409 with no intent and no Razorpay order (the book-session
//     discipline: the client's number is never charged blind).

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError } from "../_shared/app-error.ts";
import {
  getAuthenticatedUser,
  serviceRoleClient,
} from "../_shared/supabase.ts";
import { createOrder, razorpayKeyId } from "../_shared/razorpay.ts";
import { getActiveFeeConfig, round2 } from "../_shared/fee-config.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DonateRequestBody {
  upa_id: string;
  item_id?: string;
  amount: number;
  /** What the client's BillSummary displayed; compared, never charged. */
  expected_total?: number;
  method?: string;
}

interface UpaRow {
  id: string;
  status: string;
  applicant_user_id: string;
}

interface WishlistItemRow {
  id: string;
  upa_id: string;
  cost: number;
  funded_amount: number;
  status: string;
}

interface PaymentIntentRow {
  id: string;
}

function parseRequestBody(raw: unknown): DonateRequestBody {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const body = raw as Record<string, unknown>;

  if (typeof body.upa_id !== "string" || !UUID_RE.test(body.upa_id)) {
    throw new AppError("VALIDATION", "upa_id must be a valid uuid.", 400);
  }

  let itemId: string | undefined;
  if (body.item_id !== undefined && body.item_id !== null) {
    if (typeof body.item_id !== "string" || !UUID_RE.test(body.item_id)) {
      throw new AppError("VALIDATION", "item_id must be a valid uuid.", 400);
    }
    itemId = body.item_id;
  }

  if (
    typeof body.amount !== "number" ||
    !Number.isFinite(body.amount) ||
    body.amount <= 0
  ) {
    throw new AppError("VALIDATION", "amount is required and must be a positive number.", 400);
  }

  let expectedTotal: number | undefined;
  if (body.expected_total !== undefined && body.expected_total !== null) {
    if (typeof body.expected_total !== "number" || !Number.isFinite(body.expected_total)) {
      throw new AppError("VALIDATION", "expected_total must be a number.", 400);
    }
    expectedTotal = body.expected_total;
  }

  if (body.method !== undefined && body.method !== null && body.method !== "standalone") {
    throw new AppError("VALIDATION", "method must be standalone.", 400);
  }

  return {
    upa_id: body.upa_id,
    item_id: itemId,
    amount: body.amount,
    expected_total: expectedTotal,
    method: "standalone",
  };
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
    // 1. The UPA must exist and be verified. Unresolvable otherwise (404),
    //    the same answer as a nonexistent id (PRD-06 FR-16, AT-128).
    // ------------------------------------------------------------------
    const { data: upa, error: upaError } = await supabase
      .from("upa_applications")
      .select("id, status, applicant_user_id")
      .eq("id", body.upa_id)
      .maybeSingle<UpaRow>();

    if (upaError) {
      throw new AppError("INTERNAL", `Failed to load UPA: ${upaError.message}`, 500);
    }
    if (!upa || upa.status !== "verified") {
      throw new AppError("NOT_FOUND", "This athlete is not available for donations.", 404);
    }

    // ------------------------------------------------------------------
    // 2. If item-specific, re-check the item live (not client cache): it must
    //    belong to this UPA and still be open and not fully funded. ITEM_FUNDED
    //    here, before any charge, is where the second sponsor is blocked.
    // ------------------------------------------------------------------
    if (body.item_id) {
      const { data: item, error: itemError } = await supabase
        .from("upa_wishlist_items")
        .select("id, upa_id, cost, funded_amount, status")
        .eq("id", body.item_id)
        .maybeSingle<WishlistItemRow>();

      if (itemError) {
        throw new AppError("INTERNAL", `Failed to load item: ${itemError.message}`, 500);
      }
      if (!item || item.upa_id !== body.upa_id) {
        throw new AppError("NOT_FOUND", "That wishlist item does not exist for this athlete.", 404);
      }
      if (item.status !== "open" || round2(item.funded_amount) >= round2(item.cost)) {
        throw new AppError("ITEM_FUNDED", "This item has already been funded.", 409);
      }
    }

    // ------------------------------------------------------------------
    // 3. The donation floor, and the server-authoritative amount. The client's
    //    number is never charged blind: it is rounded here and, if the client
    //    told us what its BillSummary showed, compared (PRICE_MISMATCH).
    // ------------------------------------------------------------------
    const minConfig = await getActiveFeeConfig(supabase, "donations", "min_amount");
    const minAmount = round2(minConfig.value);
    const amount = round2(body.amount);

    if (amount < minAmount) {
      throw new AppError(
        "MIN_AMOUNT",
        `The minimum donation is ${minAmount.toFixed(2)}.`,
        422,
      );
    }

    if (body.expected_total !== undefined && round2(body.expected_total) !== amount) {
      throw new AppError(
        "PRICE_MISMATCH",
        "The amount changed since you opened this donation. Review the total and try again.",
        409,
      );
    }

    // ------------------------------------------------------------------
    // 4. The payment intent. entity_id stays NULL: donation is the domain whose
    //    entity row (the donations row) is created BY the finalize handler, like
    //    commerce. The gate runs the donation branch BEFORE the null-entity_id
    //    check for exactly this reason.
    // ------------------------------------------------------------------
    const placeholderOrderId = `pending:${crypto.randomUUID()}`;
    const { data: intent, error: intentInsertError } = await supabase
      .from("payment_intents")
      .insert({
        user_id: user.id,
        domain: "donation",
        entity_id: null,
        amount,
        status: "created",
        razorpay_order_id: placeholderOrderId,
      })
      .select("id")
      .single<PaymentIntentRow>();

    if (intentInsertError || !intent) {
      throw new AppError(
        "INTERNAL",
        `Failed to create payment_intent: ${intentInsertError?.message}`,
        500,
      );
    }

    // ------------------------------------------------------------------
    // 5. The draft: the {upa_id, item_id, donor_id, amount} the finalize handler
    //    copies from. Written before Razorpay so a capture can never arrive
    //    against an intent with no draft behind it.
    // ------------------------------------------------------------------
    const { error: draftError } = await supabase.from("donation_drafts").insert({
      payment_intent_id: intent.id,
      donor_id: user.id,
      upa_id: body.upa_id,
      item_id: body.item_id ?? null,
      amount,
    });

    if (draftError) {
      await supabase.from("payment_intents").update({ status: "failed" }).eq("id", intent.id);
      throw new AppError("INTERNAL", `Failed to record donation draft: ${draftError.message}`, 500);
    }

    // ------------------------------------------------------------------
    // 6. Razorpay, last. On failure the intent is failed (the draft cascades on
    //    its FK when the intent is later swept, and is inert until then).
    // ------------------------------------------------------------------
    try {
      const amountPaise = Math.round(amount * 100);
      const order = await createOrder({
        amountPaise,
        currency: "INR",
        receipt: intent.id,
        notes: {
          domain: "donation",
          // No donations row exists yet, so the intent id identifies this charge
          // to the webhook (PAYMENTS.md: entity_id falls back to the intent id).
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
          amount: amountPaise,
          currency: "INR",
          bill: { donation: amount, total: amount },
        },
        200,
      );
    } catch (err) {
      await supabase.from("payment_intents").update({ status: "failed" }).eq("id", intent.id);
      if (err instanceof AppError) throw err;
      throw new AppError(
        "INTERNAL",
        err instanceof Error ? err.message : "Unknown error creating the donation order.",
        500,
      );
    }
  })
);
