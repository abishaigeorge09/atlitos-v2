// ATLITOS v2 — supabase/functions/_shared/finalize-donation-payment.ts
//
// The `donation` domain's leg of the shared capture gate in finalize-payment.ts.
// Epic AT-8, story AT-112. Requirements: PRD-06 FR-5, FR-9, FR-17, FR-18.
//
// The FOURTH domain, built to the commerce shape exactly (finalize-order-
// payment.ts), because donation shares commerce's defining trait: its entity row
// (the donations row) is created BY this handler, not handed to the gate. So the
// donation branch, like commerce, runs BEFORE the gate's null-entity_id check,
// and this handler backfills payment_intents.entity_id after the row exists.
//
// TWO HALVES, THE COMMERCE SPLIT:
//   1. STATE, atomic, in record_donation_from_draft (0054): the donations row,
//      the funded_amount increment, the open -> funded flip, the owner
//      notification, one transaction (PRD-06 FR-9's race-critical atomicity).
//   2. LEDGER, here, one .insert = one atomic balanced group, under the service
//      role (CLAUDE.md: ledger writes live only in an edge function, never in
//      the RPC, the finalize-order-payment precedent).
//
// THE GROUP (PRD-06 FR-6: NO platform fee leg, unlike courts). For a donation of
// 500.00 to UPA <upa_id>:
//   debit  platform              500.00  clearing: donation captured
//   credit upa_fund(<upa_id>)    500.00  donation to the UPA's fund
// Debit equals credit, so it balances. A "general (no item)" donation still
// credits THE UPA's own account_ref (upa_id); only the checkout roundup credits
// the General Fund anchor, and that path lives in finalize-order-payment.
//
// IDEMPOTENT like its neighbours. The gate flips the intent once, so this runs
// once per capture; and it is idempotent by inspection anyway (the RPC returns
// an existing donation untouched, and the ledger insert is skipped when a
// donation-domain group for this donation already exists), so a re-entry writes
// nothing twice.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError, appErrorFromPostgrestMessage } from "./app-error.ts";
import { round2 } from "./fee-config.ts";
import type { CapturedIntent, FinalizeResult } from "./finalize-payment.ts";

interface DonationRow {
  id: string;
  donor_id: string;
  upa_id: string | null;
  item_id: string | null;
  amount: number;
}

export async function finalizeDonationCaptured(
  supabase: SupabaseClient,
  intent: CapturedIntent,
): Promise<FinalizeResult> {
  // 1. The state half, atomic in the RPC. Returns the donations row (created,
  //    or the existing one on a re-entry).
  const { data: donation, error: recordError } = await supabase
    .rpc("record_donation_from_draft", { p_payment_intent_id: intent.id })
    .single<DonationRow>();

  if (recordError) {
    throw appErrorFromPostgrestMessage(
      `record_donation_from_draft failed for intent ${intent.id}: ${recordError.message}`,
    );
  }

  // 2. Backfill entity_id onto the intent now that the donations row exists,
  //    exactly as commerce does (place_order_from_draft writes it back), so the
  //    already-processed branch and get_my_transactions can resolve the row.
  const { error: backfillError } = await supabase
    .from("payment_intents")
    .update({ entity_id: donation.id })
    .eq("id", intent.id)
    .is("entity_id", null);

  if (backfillError) {
    throw new AppError(
      "INTERNAL",
      `Failed to backfill entity_id for donation ${donation.id}: ${backfillError.message}`,
      500,
    );
  }

  // 3. The balanced ledger group, idempotent by inspection.
  await writeDonationLedgerGroup(supabase, intent, donation);

  return {
    outcome: "captured",
    domain: "donation",
    entityId: donation.id,
    entityStatus: "recorded",
  };
}

/**
 * The two-leg balanced group: debit platform, credit the UPA's upa_fund. No fee
 * leg (PRD-06 FR-6). Skipped if a donation-domain group for this donation
 * already exists, so a redelivery cannot double-credit the fund.
 */
async function writeDonationLedgerGroup(
  supabase: SupabaseClient,
  intent: CapturedIntent,
  donation: DonationRow,
): Promise<void> {
  if (!donation.upa_id) {
    // A standalone donation always targets a UPA (donate enforces it, the draft
    // column is NOT NULL). A null here would mean a corrupt draft; refuse rather
    // than write a group with no creditable account_ref.
    throw new AppError(
      "INTERNAL",
      `Donation ${donation.id} has no upa_id; cannot write its ledger group.`,
      500,
    );
  }

  const { data: existing, error: existingError } = await supabase
    .from("ledger_entries")
    .select("id")
    .eq("domain", "donation")
    .eq("entity_id", donation.id)
    .limit(1);

  if (existingError) {
    throw new AppError(
      "INTERNAL",
      `Failed to check existing ledger group for donation ${donation.id}: ${existingError.message}`,
      500,
    );
  }
  if (existing && existing.length > 0) return;

  const entryGroupId = crypto.randomUUID();
  const amount = round2(donation.amount);

  const { error: ledgerError } = await supabase.from("ledger_entries").insert([
    {
      entry_group_id: entryGroupId,
      payment_intent_id: intent.id,
      account_type: "platform",
      account_ref: null,
      direction: "debit",
      amount,
      domain: "donation",
      entity_id: donation.id,
      description: `Clearing: donation ${donation.id} captured`,
    },
    {
      entry_group_id: entryGroupId,
      payment_intent_id: intent.id,
      account_type: "upa_fund",
      account_ref: donation.upa_id,
      direction: "credit",
      amount,
      domain: "donation",
      entity_id: donation.id,
      description: `Donation to UPA fund ${donation.upa_id}`,
    },
  ]);

  if (ledgerError) {
    throw new AppError(
      "INTERNAL",
      `Failed to write ledger_entries for donation ${donation.id}: ${ledgerError.message}`,
      500,
    );
  }
}

/** Read-only status probe for the already-processed branch of the gate. */
export async function describeDonation(
  supabase: SupabaseClient,
  donationId: string,
): Promise<string> {
  const { data } = await supabase
    .from("donations")
    .select("id")
    .eq("id", donationId)
    .maybeSingle<{ id: string }>();

  return data ? "recorded" : "unknown";
}
