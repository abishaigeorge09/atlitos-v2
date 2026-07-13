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
  INTERNAL: 500,
};
