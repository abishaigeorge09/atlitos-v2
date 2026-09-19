import type { ApiError } from "@atlitos/types";

import type { AtlitosClient } from "./client";
import { mapEdgeFunctionError, mapPostgrestError } from "./errors";

/**
 * `@atlitos/api`'s account deletion domain. Apple App Store Guideline
 * 5.1.1(v) and the Google Play account deletion policy both require an
 * account created in the app to be deletable FROM INSIDE the app. The
 * atlitos.com/delete-account page is a request-by-email mechanism and does
 * not satisfy either on its own.
 *
 * Backed by migration 0098 (`account_deletion_preview`, `delete_my_account`)
 * and the `delete-account` edge function.
 *
 * FINANCIAL INVARIANT: nothing in this file deletes, inserts or updates a
 * money row. Deletion is entirely server side. It retains every
 * payment_intent, ledger_entry, refund, order, donation, session and court
 * booking, and 0098 asserts inside the same transaction that the payment
 * intent count, the ledger entry count, the ledger to intent linkage and
 * every entry group's balance are unchanged, raising FINANCIAL_INVARIANT or
 * LEDGER_UNBALANCED rather than committing if any of them moved.
 *
 * The preview call is the ONLY source the confirmation screen may use for
 * its counts. Copy must never invent what is deleted or retained.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Why deletion cannot proceed right now. Every one is time bounded and
 * resolvable by the user, so none of them is a permanent refusal.
 *
 *  - `PAYMENT_IN_FLIGHT`             a payment is created or authorized but
 *                                    not yet settled. Minutes.
 *  - `LAST_ADMIN`                    the only remaining platform admin.
 *  - `COACH_HAS_UPCOMING_SESSIONS`   players are booked with this coach.
 *  - `PARTNER_HAS_UPCOMING_BOOKINGS` customers hold a slot at this venue.
 */
export type AccountDeletionBlocker =
  | "PAYMENT_IN_FLIGHT"
  | "LAST_ADMIN"
  | "COACH_HAS_UPCOMING_SESSIONS"
  | "PARTNER_HAS_UPCOMING_BOOKINGS";

/** Counts of what deletion removes. Read from the server, never guessed. */
export interface AccountDeletionRemoved {
  clips: number;
  follows: number;
  addresses: number;
  savedItems: number;
  cartItems: number;
}

/**
 * Counts of what deletion keeps. These are the financial and legal records
 * atlitos.com/privacy already discloses as retained, plus the rows a second
 * party still reads. They are anonymised, never orphaned: the author resolves
 * to a tombstone profile named "Deleted user".
 */
export interface AccountDeletionRetained {
  orders: number;
  payments: number;
  donations: number;
  sessions: number;
  courtBookings: number;
}

export interface AccountDeletionPreview {
  alreadyDeleted: boolean;
  blocker: AccountDeletionBlocker | null;
  blockerCount: number;
  removed: AccountDeletionRemoved;
  retained: AccountDeletionRetained;
}

export interface AccountDeletionResult {
  status: "deleted" | "already_deleted";
  /** False when the row deletion succeeded but releasing the sign in did not. */
  authReleased: boolean;
  storageObjectsRemoved: number;
}

// ---------------------------------------------------------------------------
// Shaping
// ---------------------------------------------------------------------------

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function shapePreview(raw: unknown): AccountDeletionPreview {
  const row = (raw ?? {}) as Record<string, unknown>;
  const removed = (row.removed ?? {}) as Record<string, unknown>;
  const retained = (row.retained ?? {}) as Record<string, unknown>;

  return {
    alreadyDeleted: row.already_deleted === true,
    blocker: (row.blocker as AccountDeletionBlocker | null) ?? null,
    blockerCount: num(row.blocker_count),
    removed: {
      clips: num(removed.clips),
      follows: num(removed.follows),
      addresses: num(removed.addresses),
      savedItems: num(removed.saved_items),
      cartItems: num(removed.cart_items),
    },
    retained: {
      orders: num(retained.orders),
      payments: num(retained.payments),
      donations: num(retained.donations),
      sessions: num(retained.sessions),
      courtBookings: num(retained.court_bookings),
    },
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * `AtlitosClient.rpc` is keyed to the RPC names in
 * packages/types/src/db/database.types.ts, which is GENERATED from the live
 * schema and therefore does not yet know about 0098's two functions.
 *
 * That file belongs to the types package, not this one, so it is deliberately
 * not hand edited here. Regenerate it once 0098 is applied and this cast can
 * be deleted; the call itself is otherwise identical and the response is
 * shaped through `shapePreview` either way. Tracked in docs/qa/BUG-LEDGER.md.
 */
type UntypedRpc = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

export function useAccountDeletion(client: AtlitosClient) {
  return {
    /**
     * Read only. Returns the real counts and any blocker for the CALLER only.
     * The RPC takes no user id, so it cannot report on another account.
     */
    async preview(): Promise<AccountDeletionPreview> {
      const { data, error } = await (client as unknown as UntypedRpc).rpc(
        "account_deletion_preview",
      );
      if (error) throw mapPostgrestError(error);
      return shapePreview(data);
    },

    /**
     * Deletes the caller's own account. The edge function calls
     * `delete_my_account()` under the caller's own JWT, then releases the
     * GoTrue email and phone and removes the caller's storage objects under
     * the service role.
     *
     * Idempotent: a retry after a dropped response returns `already_deleted`
     * rather than failing.
     *
     * Throws an ApiError whose code is one of the AccountDeletionBlocker
     * values (surfaced by the RPC as `DELETION_BLOCKED: <blocker>`) when the
     * account is not currently deletable.
     */
    async deleteAccount(): Promise<AccountDeletionResult> {
      const { data, error } = await client.functions.invoke("delete-account", {
        body: {},
      });
      if (error) throw await mapEdgeFunctionError(error);

      const body = (data ?? {}) as Record<string, unknown>;
      return {
        status: body.status === "already_deleted" ? "already_deleted" : "deleted",
        authReleased: body.auth_released !== false,
        storageObjectsRemoved: num(body.storage_objects_removed),
      };
    },
  };
}

export type UseAccountDeletionResult = ReturnType<typeof useAccountDeletion>;

/**
 * Turns a blocker into the sentence the confirmation screen shows. Kept in the
 * api package so mobile and any future surface state the same reason, and so a
 * new blocker cannot ship with copy invented at the call site.
 *
 * House style: no emojis, no em dashes, no hyphens in copy strings.
 */
export function accountDeletionBlockerMessage(
  blocker: AccountDeletionBlocker,
  count: number,
): string {
  switch (blocker) {
    case "PAYMENT_IN_FLIGHT":
      return "A payment is still settling. Try again in a few minutes.";
    case "LAST_ADMIN":
      return "You are the only admin. Add another admin before you delete this account.";
    case "COACH_HAS_UPCOMING_SESSIONS":
      return count === 1
        ? "You have 1 upcoming session booked. Complete or cancel it, then delete."
        : `You have ${count} upcoming sessions booked. Complete or cancel them, then delete.`;
    case "PARTNER_HAS_UPCOMING_BOOKINGS":
      return count === 1
        ? "A customer holds 1 upcoming booking at your venue. Clear it, then delete."
        : `Customers hold ${count} upcoming bookings at your venue. Clear them, then delete.`;
  }
}

/** Narrow an ApiError thrown by deleteAccount back to a blocker, when it is one. */
export function accountDeletionBlockerFromError(
  error: ApiError,
): AccountDeletionBlocker | null {
  const codes: AccountDeletionBlocker[] = [
    "PAYMENT_IN_FLIGHT",
    "LAST_ADMIN",
    "COACH_HAS_UPCOMING_SESSIONS",
    "PARTNER_HAS_UPCOMING_BOOKINGS",
  ];
  const haystack = `${error.code ?? ""} ${error.message ?? ""}`;
  return codes.find((code) => haystack.includes(code)) ?? null;
}
