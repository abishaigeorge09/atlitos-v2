// ATLITOS v2 — supabase/functions/renew-group-membership/index.ts
//
// POST with the athlete's own JWT:
//   { membership_id, expected_total }
//
// Manual renewal (founder-ratified: no autopay in v1). Same rails as
// join-group with two differences, both deliberate:
//
//   1. No capacity guard. An active member renewing already holds their
//      seat; capacity is only contested at join time.
//   2. No abandon path. A failed Razorpay call leaves the membership
//      exactly as it was: still active, still expiring on its current
//      period_end. Only the intent is marked failed. There is no pending
//      seat to release.
//
// The `renew_group_membership` RPC (0079, service_role only) validates the
// caller owns the ACTIVE membership (a lapsed member re-joins instead,
// through join-group's capacity guard, since their seat was released) and
// re-snapshots price/platform_fee/total at today's monthly_fee + fee_config,
// so an admin fee edit applies to the next month and never retroactively.
// Capture then flows through the SAME `_shared/finalize-payment.ts`
// membership leg as the first month: `activate_group_membership_paid`
// extends period_end by 1 month from max(period_end, today), and a second
// balanced carve-out ledger group is written for the new charge.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError, appErrorFromPostgrestMessage } from "../_shared/app-error.ts";
import {
  getAuthenticatedUser,
  serviceRoleClient,
} from "../_shared/supabase.ts";
import { createOrder, razorpayKeyId } from "../_shared/razorpay.ts";
import { getActiveFeeConfig, round2 } from "../_shared/fee-config.ts";

interface RenewRequestBody {
  membership_id: string;
  expected_total: number;
}

interface MembershipRow {
  id: string;
  group_id: string;
  player_id: string;
  status: string;
  price: number;
  platform_fee: number;
  total: number;
  period_end: string | null;
}

interface PaymentIntentRow {
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRequestBody(raw: unknown): RenewRequestBody {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const { membership_id, expected_total } = raw as Record<string, unknown>;

  if (typeof membership_id !== "string" || !UUID_RE.test(membership_id)) {
    throw new AppError("VALIDATION", "membership_id must be a valid uuid.", 400);
  }
  if (typeof expected_total !== "number" || !Number.isFinite(expected_total)) {
    throw new AppError(
      "VALIDATION",
      "expected_total is required and must be a number.",
      400,
    );
  }

  return { membership_id, expected_total };
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
    // 1. Re-price server side BEFORE touching the membership: current
    //    monthly_fee for the membership's group plus the active fee row,
    //    compared against the client's displayed total.
    // ------------------------------------------------------------------
    const { data: current, error: lookupError } = await supabase
      .from("group_memberships")
      .select("id, group_id, player_id, status")
      .eq("id", body.membership_id)
      .maybeSingle<{ id: string; group_id: string; player_id: string; status: string }>();

    if (lookupError) {
      throw new AppError(
        "INTERNAL",
        `Failed to load membership: ${lookupError.message}`,
        500,
      );
    }
    if (!current || current.player_id !== user.id) {
      // Same NOT_FOUND for missing and not-yours: no membership enumeration.
      throw new AppError("NOT_FOUND", "Membership not found.", 404);
    }

    const { data: group, error: groupError } = await supabase
      .from("training_groups")
      .select("id, monthly_fee, active")
      .eq("id", current.group_id)
      .maybeSingle<{ id: string; monthly_fee: number; active: boolean }>();

    if (groupError || !group) {
      throw new AppError(
        "INTERNAL",
        `Failed to load group for membership ${current.id}: ${groupError?.message}`,
        500,
      );
    }

    const price = round2(group.monthly_fee);
    const feeConfig = await getActiveFeeConfig(
      supabase,
      "sessions",
      "platform_fee_flat",
    );
    const platformFee = round2(feeConfig.value);
    const total = price;

    if (platformFee >= price) {
      throw new AppError(
        "INTERNAL",
        `Platform fee ${platformFee} is not less than monthly fee ${price}.`,
        500,
      );
    }

    if (round2(body.expected_total) !== total) {
      throw new AppError(
        "PRICE_MISMATCH",
        "The price changed since this renewal was priced. Review the total and try again.",
        409,
      );
    }

    // ------------------------------------------------------------------
    // 2. Validate + re-snapshot through the RPC (active membership, active
    //    group, fare columns updated).
    // ------------------------------------------------------------------
    const { data: membership, error: renewError } = await supabase
      .rpc("renew_group_membership", {
        p_actor_id: user.id,
        p_membership_id: body.membership_id,
      })
      .single<MembershipRow>();

    if (renewError || !membership) {
      throw appErrorFromPostgrestMessage(
        renewError?.message ?? "INTERNAL: renew_group_membership returned no row",
      );
    }

    // ------------------------------------------------------------------
    // 3. Intent, order, backfill, link. The book-session sequence, with the
    //    membership re-linked to its NEWEST intent (full history stays in
    //    payment_intents via domain + entity_id).
    // ------------------------------------------------------------------
    const { data: intent, error: intentInsertError } = await supabase
      .from("payment_intents")
      .insert({
        user_id: user.id,
        domain: "membership",
        entity_id: membership.id,
        amount: total,
        status: "created",
        razorpay_order_id: `pending:renew:${membership.id}:${Date.now()}`,
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

    try {
      const amountPaise = Math.round(total * 100);
      const order = await createOrder({
        amountPaise,
        currency: "INR",
        receipt: membership.id,
        notes: {
          domain: "membership",
          entity_id: membership.id,
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

      const { error: linkError } = await supabase
        .from("group_memberships")
        .update({ payment_intent_id: intent.id })
        .eq("id", membership.id);

      if (linkError) {
        throw new AppError(
          "INTERNAL",
          `Failed to link payment_intent to membership: ${linkError.message}`,
          500,
        );
      }

      return jsonResponse(
        {
          membership_id: membership.id,
          group_id: membership.group_id,
          status: membership.status,
          period_end: membership.period_end,
          razorpay_order_id: order.id,
          key_id: razorpayKeyId(),
          amount: amountPaise,
          currency: "INR",
          bill: { price, platform_fee: platformFee, total },
        },
        200,
      );
    } catch (err) {
      // See header note 2: nothing to unwind on the membership itself.
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
