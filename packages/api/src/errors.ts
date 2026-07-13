import type { ApiError, ApiErrorCode } from "@atlitos/types";

/**
 * Maps a raw GoTrue (Supabase Auth) error to the shared `ApiError` shape
 * every screen consumes, per errors.ts's rule: "the client never
 * pattern-matches on a raw error message string" outside this one place.
 */
export function mapAuthError(error: { message: string; status?: number }): ApiError {
  const message = error.message.toLowerCase();

  let code: ApiErrorCode = "INTERNAL";
  if (message.includes("invalid login credentials") || message.includes("invalid email or password")) {
    code = "INVALID_CREDENTIALS";
  } else if (message.includes("already registered") || message.includes("already been registered")) {
    code = "EMAIL_TAKEN";
  } else if (message.includes("phone") && message.includes("already")) {
    code = "PHONE_TAKEN";
  } else if (message.includes("token has expired") || message.includes("expired")) {
    code = "OTP_EXPIRED";
  } else if (message.includes("invalid") && (message.includes("otp") || message.includes("token"))) {
    code = "OTP_INVALID";
  } else if (message.includes("rate limit") || error.status === 429) {
    code = "RATE_LIMITED";
  } else if (!error.status || error.status >= 500) {
    code = "INTERNAL";
  } else {
    code = "VALIDATION";
  }

  return { code, message: error.message, status: error.status ?? 400 };
}

/**
 * Maps a raw PostgREST/RPC error to `ApiError`. RPCs in this repo raise
 * Postgres exceptions prefixed with the `ApiErrorCode` they mean
 * ("ALREADY_SETUP: ...", "VALIDATION: ...", see 0004_player_and_coach_setup_rpc.sql),
 * so the prefix is the primary signal; message-substring checks are the
 * fallback for errors Postgres itself raises (constraint violations, etc).
 */
export function mapPostgrestError(error: { message: string; code?: string }): ApiError {
  const prefixMatch = /^([A-Z_]+):\s*(.*)$/.exec(error.message);
  if (prefixMatch) {
    const [, prefix, rest] = prefixMatch;
    const known: ApiErrorCode[] = [
      "UNAUTHENTICATED",
      "GUEST_FORBIDDEN",
      "VALIDATION",
      "NOT_FOUND",
      "ALREADY_SETUP",
      "INVALID_TRANSITION",
      "SLOT_TAKEN",
      "NOT_COACH",
    ];
    const code = known.find((candidate) => candidate === prefix);
    if (code) {
      return { code, message: rest || error.message, status: code === "UNAUTHENTICATED" ? 401 : 400 };
    }
  }

  if (error.code === "23505") {
    return { code: "VALIDATION", message: "That value is already in use.", status: 409 };
  }

  return { code: "INTERNAL", message: error.message, status: 500 };
}
