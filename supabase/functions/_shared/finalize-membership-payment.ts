// ATLITOS v2 — supabase/functions/_shared/finalize-membership-payment.ts
//
// The `membership` domain's leg of the shared capture gate in
// finalize-payment.ts. Called only with an intent this process just flipped
// from `created` to `captured`, so everything here runs exactly once per
// charge; a renewal is a NEW intent for the same membership row, so it gets
// its own pass through this file and its own ledger group, which is correct:
// two payments, two balanced groups.
//
// Unlike the session domain (which accrues at COMPLETION, because a paid
// session can still be declined), a membership's money event IS the capture:
// the founder-ratified fares model has no per-session money, no no-show
// effect, and no pro-rata refunds, so the month is earned the moment it is
// bought. Two writes happen here, in order:
//
//   1. `activate_group_membership_paid` (0079, service_role-only RPC): flips
//      pending -> active with period_start = today (IST) and period_end =
//      +1 month, or extends an active membership's period_end by 1 month on
//      renewal. The status write lives in the RPC, not here (CLAUDE.md:
//      state machine transitions are enforced by Postgres RPCs).
//   2. The balanced ledger group, written HERE under the service role
//      (CLAUDE.md: ledger writes only in edge functions). Same carve-out
//      shape as coaching (PAYMENTS.md), using the fee snapshotted on the
//      membership row at join/renew time:
//
//        debit  platform             total          clearing
//        credit coach <coach_id>     total - fee    membership earnings
//        credit platform             fee            platform fee
//
// Idempotency: the gate's status='created' UPDATE means this runs once per
// charge; on top of that, the ledger write is skipped if a coach-credit row
// for THIS intent already exists (covers a previous run that died between
// the RPC call and the ledger insert, the complete-session repair pattern).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./app-error.ts";
import { round2 } from "./fee-config.ts";
import type { CapturedIntent, FinalizeResult } from "./finalize-payment.ts";

interface MembershipRow {
  id: string;
  group_id: string;
  player_id: string;
  status: string;
  price: number;
  platform_fee: number;
  total: number;
}

export async function finalizeMembershipCaptured(
  supabase: SupabaseClient,
  intent: CapturedIntent,
): Promise<FinalizeResult> {
  const membershipId = intent.entity_id as string;

  // Activate (or extend) through the RPC. This is the status/period writer.
  const { data: membership, error: activateError } = await supabase
    .rpc("activate_group_membership_paid", { p_membership_id: membershipId })
    .single<MembershipRow>();

  if (activateError || !membership) {
    // The charge is recorded as captured either way (the gate already flipped
    // the intent); a failure here is a reconciliation problem to surface, not
    // something to swallow.
    throw new AppError(
      "INTERNAL",
      `Failed to activate membership ${membershipId}: ${activateError?.message}`,
      500,
    );
  }

  // Coach for the ledger credit.
  const { data: group, error: groupError } = await supabase
    .from("training_groups")
    .select("id, coach_id")
    .eq("id", membership.group_id)
    .maybeSingle<{ id: string; coach_id: string }>();

  if (groupError || !group) {
    throw new AppError(
      "INTERNAL",
      `Failed to load group ${membership.group_id} for membership ${membershipId}: ${groupError?.message}`,
      500,
    );
  }

  // Ledger idempotency beyond the gate (see header).
  const { data: existingLegs, error: legError } = await supabase
    .from("ledger_entries")
    .select("id")
    .eq("payment_intent_id", intent.id)
    .eq("account_type", "coach")
    .limit(1);

  if (legError) {
    throw new AppError(
      "INTERNAL",
      `Failed to check existing membership accrual for intent ${intent.id}: ${legError.message}`,
      500,
    );
  }

  if ((existingLegs ?? []).length === 0) {
    const gross = round2(membership.total);
    const platformFee = round2(membership.platform_fee);
    const coachPayable = round2(gross - platformFee);

    if (coachPayable <= 0) {
      throw new AppError(
        "INTERNAL",
        `Membership ${membershipId} would credit the coach ${coachPayable}, which ledger_entries rejects.`,
        500,
      );
    }

    const entryGroupId = crypto.randomUUID();

    const { error: ledgerError } = await supabase.from("ledger_entries").insert([
      {
        entry_group_id: entryGroupId,
        payment_intent_id: intent.id,
        account_type: "platform",
        account_ref: null,
        direction: "debit",
        amount: gross,
        domain: "membership",
        entity_id: membership.id,
        description: `Clearing: membership ${membership.id} captured`,
      },
      {
        entry_group_id: entryGroupId,
        payment_intent_id: intent.id,
        account_type: "coach",
        account_ref: group.coach_id,
        direction: "credit",
        amount: coachPayable,
        domain: "membership",
        entity_id: membership.id,
        description: `Membership earnings, membership ${membership.id}`,
      },
      {
        entry_group_id: entryGroupId,
        payment_intent_id: intent.id,
        account_type: "platform",
        account_ref: null,
        direction: "credit",
        amount: platformFee,
        domain: "membership",
        entity_id: membership.id,
        description: `Platform fee, membership ${membership.id}`,
      },
    ]);

    if (ledgerError) {
      throw new AppError(
        "INTERNAL",
        `Failed to write ledger_entries for membership ${membership.id}: ${ledgerError.message}`,
        500,
      );
    }
  }

  return {
    outcome: "captured",
    domain: "membership",
    entityId: membership.id,
    entityStatus: membership.status,
  };
}

/** Read-only status probe for the already-processed branch of the gate. */
export async function describeMembership(
  supabase: SupabaseClient,
  membershipId: string,
): Promise<string> {
  const { data } = await supabase
    .from("group_memberships")
    .select("status")
    .eq("id", membershipId)
    .maybeSingle<{ status: string }>();

  return data?.status ?? "unknown";
}
