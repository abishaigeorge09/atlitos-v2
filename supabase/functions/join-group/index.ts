// ATLITOS v2 — supabase/functions/join-group/index.ts
//
// POST with the athlete's own JWT:
//   { group_id, expected_total }
//
// The group fares join leg, mirroring book-session's shape exactly so
// membership payments ride the SAME rails (founder-ratified fares model:
// monthly subscription per group, manual renewal v1 through the existing
// one-time payment rails, no autopay):
//
//   1. Re-price server side from `training_groups.monthly_fee` and the
//      active `fee_config` ('sessions', 'platform_fee_flat') row, the
//      coaching carve-out (PAYMENTS.md): total = monthly_fee, the platform
//      fee comes out of the coach's amount. A client total mismatch is
//      `409 PRICE_MISMATCH` with no membership row and no Razorpay order.
//   2. `join_training_group` (0079, service_role-only RPC): the capacity
//      guard. Locks the group row, counts live (pending + active)
//      memberships, inserts the membership as `pending` with the fare
//      snapshot. GROUP_FULL / ALREADY_MEMBER / GROUP_INACTIVE surface as
//      409s before Razorpay is ever called, so a losing racer is never
//      charged.
//   3. `payment_intents` (domain `membership`, entity_id = membership id,
//      placeholder order id), then the Razorpay order with notes
//      {domain, entity_id, payment_intent_id}, then backfill the real order
//      id, then link the intent onto the membership row. Byte-for-byte the
//      book-session sequence.
//   4. Return the order for the client's checkout sheet. Nothing here
//      confirms payment: capture is finalized only by
//      `_shared/finalize-payment.ts` (razorpay-webhook or verify-payment),
//      whose membership leg activates the membership (period_start = today,
//      period_end = +1 month, IST) and writes the carve-out ledger group.
//
// On a Razorpay failure after the membership exists, the seat is released
// via the service-role-only RPC `membership_abandon_unpaid` (pending ->
// lapsed), never a raw status UPDATE from this function.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError, appErrorFromPostgrestMessage } from "../_shared/app-error.ts";
import {
  getAuthenticatedUser,
  serviceRoleClient,
} from "../_shared/supabase.ts";
import { createOrder, razorpayKeyId } from "../_shared/razorpay.ts";
import { getActiveFeeConfig, round2 } from "../_shared/fee-config.ts";

interface JoinGroupRequestBody {
  group_id: string;
  expected_total: number;
}

interface GroupRow {
  id: string;
  coach_id: string;
  name: string;
  monthly_fee: number;
  active: boolean;
  coach_profiles: { status: string } | null;
}

interface MembershipRow {
  id: string;
  group_id: string;
  player_id: string;
  status: string;
  price: number;
  platform_fee: number;
  total: number;
}

interface PaymentIntentRow {
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRequestBody(raw: unknown): JoinGroupRequestBody {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const { group_id, expected_total } = raw as Record<string, unknown>;

  if (typeof group_id !== "string" || !UUID_RE.test(group_id)) {
    throw new AppError("VALIDATION", "group_id must be a valid uuid.", 400);
  }
  if (typeof expected_total !== "number" || !Number.isFinite(expected_total)) {
    throw new AppError(
      "VALIDATION",
      "expected_total is required and must be a number.",
      400,
    );
  }

  return { group_id, expected_total };
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
    // 1. Group must exist, be active, and belong to a verified coach; then
    //    re-price and compare BEFORE any row is created. The RPC re-checks
    //    all of this authoritatively under its lock; this pass exists so a
    //    stale client total never creates a pending seat.
    // ------------------------------------------------------------------
    const { data: group, error: groupError } = await supabase
      .from("training_groups")
      .select("id, coach_id, name, monthly_fee, active, coach_profiles(status)")
      .eq("id", body.group_id)
      .maybeSingle<GroupRow>();

    if (groupError) {
      throw new AppError(
        "INTERNAL",
        `Failed to load training group: ${groupError.message}`,
        500,
      );
    }
    if (!group || !group.active || group.coach_profiles?.status !== "verified") {
      throw new AppError("NOT_FOUND", "Training group not found or not joinable.", 404);
    }
    if (group.coach_id === user.id) {
      throw new AppError("VALIDATION", "A coach cannot join their own group.", 400);
    }

    const price = round2(group.monthly_fee);
    const feeConfig = await getActiveFeeConfig(
      supabase,
      "sessions",
      "platform_fee_flat",
    );
    const platformFee = round2(feeConfig.value);
    const total = price; // fee is carved out of the monthly fee, see header.

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
        "The price changed since this group was priced. Review the total and try again.",
        409,
      );
    }

    // ------------------------------------------------------------------
    // 2. The capacity-guarded insert. GROUP_FULL / ALREADY_MEMBER etc.
    //    arrive as Postgres exceptions with the shared error vocabulary
    //    and map straight through, before any Razorpay call.
    // ------------------------------------------------------------------
    const { data: membership, error: joinError } = await supabase
      .rpc("join_training_group", {
        p_actor_id: user.id,
        p_group_id: body.group_id,
      })
      .single<MembershipRow>();

    if (joinError || !membership) {
      throw appErrorFromPostgrestMessage(
        joinError?.message ?? "INTERNAL: join_training_group returned no row",
      );
    }

    // ------------------------------------------------------------------
    // 3. payment_intents first (placeholder order id), then Razorpay, then
    //    backfill, then link. The book-session sequence.
    // ------------------------------------------------------------------
    const { data: intent, error: intentInsertError } = await supabase
      .from("payment_intents")
      .insert({
        user_id: user.id,
        domain: "membership",
        entity_id: membership.id,
        amount: total,
        status: "created",
        razorpay_order_id: `pending:${membership.id}`,
      })
      .select("id")
      .single<PaymentIntentRow>();

    if (intentInsertError || !intent) {
      await supabase
        .rpc("membership_abandon_unpaid", { p_membership_id: membership.id })
        .then(() => undefined, () => undefined);
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
          group_id: group.id,
          status: membership.status,
          razorpay_order_id: order.id,
          key_id: razorpayKeyId(),
          amount: amountPaise,
          currency: "INR",
          bill: { price, platform_fee: platformFee, total },
        },
        200,
      );
    } catch (err) {
      // Razorpay (or the backfill) failed: release the seat via the RPC.
      await supabase
        .rpc("membership_abandon_unpaid", { p_membership_id: membership.id })
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
