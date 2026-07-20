// ATLITOS v2 — supabase/functions/_shared/app-error.ts
//
// One error shape every function in this directory throws and catches, so
// the client always sees `{ error: { code, message } }` with the exact codes
// docs/architecture/API-MAPPING.md and PAYMENTS.md name (PRICE_MISMATCH,
// SLOT_TAKEN, INVALID_TRANSITION, ...), never a raw Postgres/Deno stack
// trace leaking to the client.

export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "AppError";
  }
}

/**
 * Postgres exceptions raised via `raise exception 'CODE: message'` (the
 * convention every RPC in supabase/migrations/*.sql follows) surface to
 * supabase-js as a PostgrestError whose `.message` is that same string.
 * This maps one back to an AppError with the right client-facing code and a
 * matching HTTP status, instead of every call site re-deriving it.
 */
export function appErrorFromPostgrestMessage(message: string): AppError {
  const match = message.match(/^([A-Z_]+):\s*(.*)$/);
  const code = match ? match[1] : "INTERNAL";
  const detail = match ? match[2] : message;

  const status = STATUS_BY_CODE[code] ?? 400;
  return new AppError(code, detail, status);
}

const STATUS_BY_CODE: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  REASON_REQUIRED: 400,
  SLOT_TAKEN: 409,
  ALREADY_ACCEPTED: 409,
  ALREADY_CHECKED_IN: 409,
  ALREADY_RATED: 409,
  ALREADY_PROCESSED: 200,
  INVALID_TRANSITION: 409,
  PRICE_MISMATCH: 409,
  // Coaching state machine codes raised by session_transition (0021), so an
  // edge function relaying that RPC's error surfaces the same code the RPC
  // named instead of flattening everything to a 400.
  TOO_EARLY: 409,
  SESSION_STARTED: 409,
  // AT-61 (0027): session_transition refusing a money-consequential action to
  // a non-service-role caller. 500, not 4xx: the edge functions call the
  // service_role-only internal entry point, so if one of them ever sees this
  // the server is misconfigured, not the client misbehaving.
  USE_EDGE_FUNCTION: 500,
  // AT-44: the caller asked for a coach wallet but holds no coach role.
  NOT_COACH: 403,
  // AT-41: a session reached completion with no captured payment behind it.
  PAYMENT_NOT_CAPTURED: 409,
  // Commerce (AT-71, AT-72). OUT_OF_STOCK is raised by both
  // reserve_stock_for_checkout (before Razorpay, the ordinary refusal) and
  // consume_reservation (the late capture), and 409 is right for both: the
  // request was well formed and the inventory refused it.
  OUT_OF_STOCK: 409,
  // reserve_stock_for_checkout, when an intent already holds a reservation.
  // Never shopper facing; it means checkout retried without a fresh intent.
  ALREADY_RESERVED: 409,
  // consume_reservation, when a capture arrives for an intent that reserved
  // nothing. 500 rather than 4xx: checkout and finalize disagree, which is a
  // server problem, not a client one.
  NO_RESERVATION: 500,
  // place_order_from_draft (0038), when a capture arrives for an intent that
  // carries no priced bill. Same reasoning as NO_RESERVATION.
  NO_DRAFT: 500,
  // PRD-07 FR-14. Checkout without a usable saved address.
  NO_ADDRESS: 400,
  // 0036/0038's address delete guard: an order still on the way uses it.
  ADDRESS_IN_USE: 409,
  INTERNAL: 500,
  // Razorpay-facing codes (AT-42 Route onboarding, AT-43 transfers).
  // RAZORPAY_ERROR is a bad gateway: their API rejected or failed a call we
  // consider well-formed. ROUTE_UNAVAILABLE is the narrower, actionable case
  // where Route itself is not enabled on the merchant account, which is a
  // founder dashboard action rather than anything a retry can fix.
  RAZORPAY_ERROR: 502,
  ROUTE_UNAVAILABLE: 503,
  // AT-43 (0028), PRD-02 FR-27 and FR-29. Both are 409 rather than 400: the
  // request was well formed, the account's state or the ledger's state
  // refused it, and both are conditions the coach can resolve and retry.
  PAYOUT_ACCOUNT_NOT_ACTIVE: 409,
  INSUFFICIENT_BALANCE: 409,
  // AT-81 (0039): admin catalog RPC refusals, relayed by apps/admin.
  // MEDIA_REQUIRED is a 400 (the request was incomplete); SKU_TAKEN and
  // VARIANT_IN_USE are 409s (well formed, refused by the catalog's state).
  MEDIA_REQUIRED: 400,
  SKU_TAKEN: 409,
  VARIANT_IN_USE: 409,
  // AT-82: admin-order-advance refusing to relay `placed -> cancelled`
  // because the refund path it would owe the shopper is not a P4 story.
  CANCEL_NOT_AVAILABLE: 409,
};
