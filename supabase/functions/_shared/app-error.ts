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
  INTERNAL: 500,
  // Razorpay-facing codes (AT-42 Route onboarding, AT-43 transfers).
  // RAZORPAY_ERROR is a bad gateway: their API rejected or failed a call we
  // consider well-formed. ROUTE_UNAVAILABLE is the narrower, actionable case
  // where Route itself is not enabled on the merchant account, which is a
  // founder dashboard action rather than anything a retry can fix.
  RAZORPAY_ERROR: 502,
  ROUTE_UNAVAILABLE: 503,
};
