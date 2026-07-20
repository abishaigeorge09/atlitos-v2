// ATLITOS v2 — supabase/functions/razorpay-route-transfer/index.ts
//
// POST { amount } with the caller's own JWT, `verify_jwt` true. Story AT-43.
// Implements PRD-02 FR-28 (server re-derives the balance, writes the
// `transfers` row and the balancing debit `ledger_entries` group atomically,
// never allows a transfer exceeding the derived balance) and FR-29 (a failure
// surfaces a specific reason and writes NO ledger row). FR-27's `active` gate
// is enforced here as well as in the UI, because a disabled button is not a
// control.
//
// Order of operations, and why it is this order:
//
//   1. Authenticate, and resolve the coach from `auth.uid()` alone. The
//      caller never names whose money is moving.
//   2. Pre-flight, read only: the payout account must be `active`, and the
//      requested amount must not exceed `get_payout_account_balance()`.
//      Failing here means Razorpay is never called and nothing is written,
//      which is most of FR-29 on its own.
//   3. Call Razorpay's Transfer API. If this fails for any reason, including
//      Route not being enabled on the merchant account, the function returns
//      a specific reason and STILL nothing is written. No `transfers` row,
//      no `ledger_entries` row. This is the FR-29 requirement stated exactly.
//   4. Only on Razorpay accepting the transfer, `record_transfer` writes the
//      row and the balanced debit group in one transaction, re-running the
//      step 2 checks under a row lock on the payout account so two concurrent
//      transfers cannot both spend the same balance.
//
// The amount the client sends is a REQUEST, never an authority. Step 2 and
// step 4 both re-derive the balance from `ledger_entries` server side, using
// the same expression `get_coach_wallet_balance()` uses for the number the
// coach was shown, so the displayed balance and the validated balance cannot
// diverge (PAYMENTS.md's "it should call this same RPC rather than
// reimplementing the sum").
//
// Scope note: this function is coach-only, matching PRD-02 FR-28. The RPCs it
// calls in 0028 are owner-generic (they key off `payout_accounts.owner_type`),
// so the court partner payout path becomes a caller change here rather than a
// second set of money functions, but that path is not in P3 scope and is not
// built here.
//
// Route entitlement: as of this writing Route is not enabled on the test
// merchant account, so step 3 returns `503 ROUTE_UNAVAILABLE` carrying
// Razorpay's own description verbatim. That is deliberately not stubbed into
// a fake success. A transfer that reports itself accepted when no money moved
// would write a debit against the coach's real balance for money they never
// received, which is the single worst thing this function could do.

import { handleCorsPreflight } from "../_shared/cors.ts";
import { jsonResponse, withErrorHandling } from "../_shared/http.ts";
import { AppError, appErrorFromPostgrestMessage } from "../_shared/app-error.ts";
import {
  getAuthenticatedUser,
  serviceRoleClient,
} from "../_shared/supabase.ts";
import { razorpayRequest } from "../_shared/razorpay.ts";

interface TransferRequestBody {
  /** Rupees, 2dp. A request, not an authority; re-checked server side twice. */
  amount: number;
}

interface PayoutAccountRow {
  id: string;
  owner_type: string;
  owner_id: string;
  razorpay_account_id: string | null;
  status: string;
}

interface TransferRow {
  id: string;
  payout_account_id: string;
  amount: number;
  razorpay_transfer_id: string | null;
  status: string;
  ledger_entry_group_id: string;
}

/** Razorpay's transfer entity, the subset this function reads. */
interface RazorpayTransfer {
  id: string;
  entity: string;
  recipient: string;
  amount: number;
  currency: string;
  status: string;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseRequestBody(raw: unknown): TransferRequestBody {
  if (typeof raw !== "object" || raw === null) {
    throw new AppError("VALIDATION", "Request body must be a JSON object.", 400);
  }
  const { amount } = raw as Record<string, unknown>;

  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new AppError(
      "VALIDATION",
      "amount must be a positive number of rupees.",
      400,
    );
  }

  const rounded = round2(amount);
  if (rounded !== amount) {
    // Reject rather than silently rounding: the coach is told a number and
    // must transfer that number, not one this function quietly adjusted.
    throw new AppError(
      "VALIDATION",
      "amount must have at most 2 decimal places.",
      400,
    );
  }

  return { amount: rounded };
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

    // ---- 1. Resolve the coach from the JWT. Never from the request body.
    const { data: coach, error: coachError } = await supabase
      .from("coach_profiles")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle<{ user_id: string }>();

    if (coachError) {
      throw new AppError(
        "INTERNAL",
        `Failed to load coach profile: ${coachError.message}`,
        500,
      );
    }
    if (!coach) {
      throw new AppError(
        "NOT_COACH",
        "A coach profile is required to transfer earnings.",
        403,
      );
    }

    const { data: account, error: accountError } = await supabase
      .from("payout_accounts")
      .select("id, owner_type, owner_id, razorpay_account_id, status")
      .eq("owner_type", "coach")
      .eq("owner_id", coach.user_id)
      .maybeSingle<PayoutAccountRow>();

    if (accountError) {
      throw new AppError(
        "INTERNAL",
        `Failed to load payout account: ${accountError.message}`,
        500,
      );
    }

    // ---- 2. Pre-flight. Nothing below this point has written anything yet,
    //         and nothing will unless Razorpay accepts the transfer.
    //
    // FR-27: `active` is the gate. Every non-active state gets its own
    // sentence, because "transfer failed" with no reason is precisely the
    // failure mode FR-29 exists to prevent.
    if (!account || account.status === "not_started") {
      throw new AppError(
        "PAYOUT_ACCOUNT_NOT_ACTIVE",
        "Set up your payout account before transferring earnings.",
        409,
      );
    }
    if (account.status !== "active") {
      const reason = account.status === "pending"
        ? "Your payout account is still being verified. Transfers open once it is active."
        : account.status === "needs_attention"
        ? "Your payout account needs more information before transfers can be made."
        : "Your payout account could not be verified. Set it up again to transfer earnings.";
      throw new AppError("PAYOUT_ACCOUNT_NOT_ACTIVE", reason, 409);
    }
    if (!account.razorpay_account_id) {
      // An `active` row with no linked account id is a data integrity fault,
      // not a user error, and must never reach Razorpay as a transfer with
      // an undefined recipient.
      throw new AppError(
        "INTERNAL",
        `Payout account ${account.id} is active but carries no razorpay_account_id.`,
        500,
      );
    }

    const { data: balanceData, error: balanceError } = await supabase.rpc(
      "get_payout_account_balance",
      { p_payout_account_id: account.id },
    );

    if (balanceError) {
      throw appErrorFromPostgrestMessage(balanceError.message);
    }

    const balance = round2(Number(balanceData ?? 0));

    if (body.amount > balance) {
      // FR-28's server re-check, and FR-29's specific reason. The client's
      // displayed maximum is irrelevant here; this number is the ledger's.
      throw new AppError(
        "INSUFFICIENT_BALANCE",
        `Transfer of ${body.amount} exceeds your available balance of ${balance}.`,
        409,
      );
    }

    // ---- 3. Razorpay. Any throw from here propagates as ROUTE_UNAVAILABLE
    //         503 or RAZORPAY_ERROR 502 with the upstream description
    //         verbatim, and NOTHING has been written (FR-29).
    const transfer = await razorpayRequest<RazorpayTransfer>(
      "POST",
      "/transfers",
      {
        account: account.razorpay_account_id,
        // Razorpay is paise everywhere. Rounded before the multiply, not
        // after, so a 2dp rupee amount lands on an exact integer of paise.
        amount: Math.round(body.amount * 100),
        currency: "INR",
        notes: {
          payout_account_id: account.id,
          owner_type: account.owner_type,
          owner_id: account.owner_id,
        },
      },
    );

    // ---- 4. Razorpay accepted. Record the movement atomically: the
    //         `transfers` row plus the balanced debit group, with the
    //         balance and `active` checks re-run under a row lock.
    const { data: recorded, error: recordError } = await supabase.rpc(
      "record_transfer",
      {
        p_payout_account_id: account.id,
        p_amount: body.amount,
        p_razorpay_transfer_id: transfer.id,
      },
    ).maybeSingle<TransferRow>();

    if (recordError) {
      // Money has moved at Razorpay but the ledger write failed. Log loudly
      // with the provider id: `transfer.processed` reconciles this by
      // creating the record from the provider's own event, the same way
      // AT-60's refund.processed handles a refund issued outside this
      // system. Surfacing the provider id is what makes that reconciliation
      // traceable rather than a mystery credit.
      console.error(
        `razorpay-route-transfer: Razorpay transfer ${transfer.id} for payout account ${account.id} was accepted but record_transfer failed:`,
        recordError.message,
      );
      throw appErrorFromPostgrestMessage(recordError.message);
    }
    if (!recorded) {
      throw new AppError(
        "INTERNAL",
        `record_transfer returned no row for Razorpay transfer ${transfer.id}.`,
        500,
      );
    }

    return jsonResponse({
      transfer_id: recorded.id,
      razorpay_transfer_id: recorded.razorpay_transfer_id,
      amount: Number(recorded.amount),
      status: recorded.status,
      ledger_entry_group_id: recorded.ledger_entry_group_id,
      balance_before: balance,
      balance_after: round2(balance - Number(recorded.amount)),
    }, 200);
  })
);
