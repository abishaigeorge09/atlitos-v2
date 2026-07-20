import { FunctionsHttpError } from "@supabase/supabase-js";
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
      "FORBIDDEN",
      "VALIDATION",
      "NOT_FOUND",
      "ALREADY_SETUP",
      "INVALID_TRANSITION",
      "ALREADY_RATED",
      "REASON_REQUIRED",
      "SLOT_TAKEN",
      "NOT_COACH",
      "TOO_EARLY",
      "SESSION_STARTED",
      // AT-61: the bare RPC refusing a money-consequential action. Listed so
      // it surfaces as itself rather than collapsing to INTERNAL, which is
      // what makes a regressed call site visible instead of looking like a
      // server fault.
      "USE_EDGE_FUNCTION",
      // Commerce (P4). Every one of these is raised by a migration as
      // `raise exception 'CODE: message'` and every one drives real UI, so
      // leaving them off this list is not cosmetic: an unlisted prefix falls
      // through to INTERNAL carrying the raw Postgres string, which is
      // exactly what PRD-07 FR-30 and AT-78 forbid showing a shopper.
      // Verified against the live project: add_to_cart raises
      // "OUT_OF_STOCK: ..." (P0001) and the 0036 delete guard raises
      // "ADDRESS_IN_USE: ..." / "ADDRESS_ON_PAST_ORDER: ...".
      "OUT_OF_STOCK",
      "ADDRESS_IN_USE",
      "ADDRESS_ON_PAST_ORDER",
      "PINCODE_INVALID",
      "ALREADY_RESERVED",
      "NO_RESERVATION",
      "NO_ADDRESS",
    ];
    // Codes whose meaning is "well formed request, current state refuses it",
    // matching the statuses `supabase/functions/_shared/app-error.ts` assigns
    // the same codes, so a caller sees one status for a given code whether it
    // arrived from an RPC or from an edge function.
    const conflictCodes: ApiErrorCode[] = [
      "OUT_OF_STOCK",
      "ADDRESS_IN_USE",
      "ADDRESS_ON_PAST_ORDER",
      "ALREADY_RESERVED",
      "SLOT_TAKEN",
      "INVALID_TRANSITION",
      "ALREADY_RATED",
      "TOO_EARLY",
      "SESSION_STARTED",
    ];

    const code = known.find((candidate) => candidate === prefix);
    if (code) {
      const status =
        code === "UNAUTHENTICATED"
          ? 401
          : code === "FORBIDDEN"
            ? 403
            : code === "NO_RESERVATION"
              ? 500
              : conflictCodes.includes(code)
                ? 409
                : 400;
      return { code, message: rest || error.message, status };
    }
  }

  if (error.code === "23505") {
    return { code: "VALIDATION", message: "That value is already in use.", status: 409 };
  }

  return { code: "INTERNAL", message: error.message, status: 500 };
}

/**
 * Maps a Supabase Edge Function invocation error (`client.functions.invoke`)
 * to `ApiError`. Every function under `supabase/functions/` throws `AppError`
 * and returns it as `{ error: { code, message } }` (see
 * `supabase/functions/_shared/http.ts`'s `errorResponse`), never a raw stack
 * trace; this reads that body back out. `FunctionsHttpError.context` is the
 * raw `Response`, only readable once (`.json()`), so this is async, unlike
 * the sync PostgREST/Auth mappers above.
 */
export async function mapEdgeFunctionError(error: unknown): Promise<ApiError> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: { code?: string; message?: string } };
      const code = body.error?.code as ApiErrorCode | undefined;
      if (code) {
        return {
          code,
          message: body.error?.message ?? error.message,
          status: error.context.status || 400,
        };
      }
    } catch {
      // Body wasn't the expected JSON shape; fall through to the generic
      // mapping below rather than throwing a second error while handling one.
    }
  }

  return {
    code: "INTERNAL",
    message: error instanceof Error ? error.message : "Something went wrong. Please try again.",
    status: 500,
  };
}
