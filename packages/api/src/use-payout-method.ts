import { useMemo } from "react";

import type { AtlitosClient } from "./client";
import { mapPostgrestError } from "./errors";
import type { PayoutMethodType, SavePayoutMethodInput } from "@atlitos/types";

export { validatePayoutMethod } from "@atlitos/types";
export type { PayoutMethodType, SavePayoutMethodInput } from "@atlitos/types";

// Payout details for a coach or a venue (migration 0130,
// docs/PLAN-PAYOUTS-CLICKS-SEARCH.md Track 1).
//
// Razorpay Route is closed to ELSHEPH, so Atlitos pays coaches and venues by
// NEFT or UPI and needs to know where. `payout_methods` has no client grant
// at all: the only way in is these two security definer RPCs, which resolve
// ownership from the caller's own session. The app only ever sees the last
// four digits of an account number, never the full value, including straight
// after saving it.
//
// There is no client-initiated transfer any more. Admin pays out, so the
// owner's job is only to keep these details correct. Changing them sends the
// account back to review, which is deliberate: it is what stops a hijacked
// account from redirecting money.

export type PayoutOwnerType = "coach" | "court_partner";
export type PayoutAccountStatus = "not_started" | "pending" | "active" | "needs_attention" | "failed";

export interface MaskedPayoutMethod {
  methodType: PayoutMethodType;
  accountHolderName: string;
  accountNumberLast4: string | null;
  ifsc: string | null;
  vpa: string | null;
  panLast4: string | null;
  hasPan: boolean;
  verificationStatus: "unverified" | "verified" | "rejected";
  verificationNote: string | null;
  verifiedAt: string | null;
  updatedAt: string;
}

export interface MyPayoutState {
  payoutAccountId: string | null;
  status: PayoutAccountStatus;
  method: MaskedPayoutMethod | null;
  /** Everything the ledger says you are owed. */
  balance: number;
  /** The part of `balance` past the 24 hour hold, which Atlitos can pay now. */
  eligibleBalance: number;
}


interface RawMethod {
  method_type: PayoutMethodType;
  account_holder_name: string;
  account_number_last4: string | null;
  ifsc: string | null;
  vpa: string | null;
  pan_last4: string | null;
  has_pan: boolean;
  verification_status: MaskedPayoutMethod["verificationStatus"];
  verification_note: string | null;
  verified_at: string | null;
  updated_at: string;
}

function toMethod(raw: RawMethod | null): MaskedPayoutMethod | null {
  if (!raw) return null;
  return {
    methodType: raw.method_type,
    accountHolderName: raw.account_holder_name,
    accountNumberLast4: raw.account_number_last4,
    ifsc: raw.ifsc,
    vpa: raw.vpa,
    panLast4: raw.pan_last4,
    hasPan: raw.has_pan,
    verificationStatus: raw.verification_status,
    verificationNote: raw.verification_note,
    verifiedAt: raw.verified_at,
    updatedAt: raw.updated_at,
  };
}

export function usePayoutMethod(client: AtlitosClient, ownerType: PayoutOwnerType, venueId: string | null = null) {
  return useMemo(
    () => ({
      async get(): Promise<MyPayoutState> {
        const { data, error } = await client.rpc("get_my_payout_method", {
          p_owner_type: ownerType,
          p_venue_id: venueId ?? undefined,
        });
        if (error) throw mapPostgrestError(error);
        const body = data as {
          payout_account_id: string | null;
          payout_status: PayoutAccountStatus;
          method: RawMethod | null;
          balance: number;
          eligible_balance: number;
        };
        return {
          payoutAccountId: body.payout_account_id,
          status: body.payout_status,
          method: toMethod(body.method),
          balance: Number(body.balance),
          eligibleBalance: Number(body.eligible_balance),
        };
      },

      /** Returns `changed: false` when the details were identical, in which
       * case an existing verification is kept. */
      async save(input: SavePayoutMethodInput): Promise<{ status: PayoutAccountStatus; method: MaskedPayoutMethod | null; changed: boolean }> {
        const { data, error } = await client.rpc("upsert_my_payout_method", {
          p_owner_type: ownerType,
          p_venue_id: venueId ?? undefined,
          p_method_type: input.methodType,
          p_account_holder_name: input.accountHolderName,
          p_account_number: input.methodType === "bank_account" ? input.accountNumber : undefined,
          p_ifsc: input.methodType === "bank_account" ? input.ifsc : undefined,
          p_vpa: input.methodType === "upi" ? input.vpa : undefined,
          p_pan: input.pan?.trim() ? input.pan : undefined,
        });
        if (error) throw mapPostgrestError(error);
        const body = data as { payout_status: PayoutAccountStatus; method: RawMethod | null; changed: boolean };
        return { status: body.payout_status, method: toMethod(body.method), changed: body.changed };
      },
    }),
    [client, ownerType, venueId],
  );
}

export type UsePayoutMethodResult = ReturnType<typeof usePayoutMethod>;
