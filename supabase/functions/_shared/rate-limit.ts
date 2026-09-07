// ATLITOS v2 — supabase/functions/_shared/rate-limit.ts
//
// SEC-F9. A per-caller spend ceiling for endpoints whose work costs money.
//
// TWO RULES FROM THE HANDBOOK, both deliberate:
//
//   1. Check BEFORE the expensive work, never after the response. A limiter
//      that runs after the paid call has already been made is a log line, not
//      a control.
//   2. FAIL CLOSED. If the counter cannot be read or written, deny. An open
//      failure mode on a spend ceiling means the one time the database is
//      unhappy is also the one time the key is unmetered.
//
// Keys are per USER, and callers should pass a per-IP key as well: either
// alone is trivially bypassable. A guest can mint a fresh anonymous session
// (0008) to reset a user key, and a residential proxy resets an IP key, but
// resetting both at once is real work.

import { AppError } from "./app-error.ts";
import { serviceRoleClient } from "./supabase.ts";

export interface RateLimit {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * Consumes one slot for every key. Throws `RATE_LIMITED` (429) when any key is
 * over its limit, so the caller can simply await this and proceed.
 *
 * Every key is incremented even when an earlier one already failed. That is
 * intentional: a caller who is over their IP limit should not get free user
 * quota out of it.
 */
export async function enforceRateLimit(
  keys: string[],
  { limit, windowSeconds }: RateLimit,
): Promise<void> {
  const supabase = serviceRoleClient();

  const results = await Promise.all(
    keys.map(async (key) => {
      const { data, error } = await supabase.rpc("rate_limit_hit", {
        p_key: key,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      // Fail closed: an unavailable limiter denies.
      if (error) {
        console.error("rate-limit: counter unavailable, denying", {
          key,
          message: error.message,
        });
        return false;
      }
      return data === true;
    }),
  );

  if (results.some((allowed) => !allowed)) {
    throw new AppError(
      "RATE_LIMITED",
      "You are doing that too quickly. Please wait a moment and try again.",
      429,
      // Retry-After in seconds. The window is fixed, so the honest worst case
      // is the full window; a caller that retries sooner is refused again
      // rather than charged.
      windowSeconds,
    );
  }
}

/**
 * Best-effort caller IP. Supabase sits behind a proxy, so the socket address is
 * the proxy's; `x-forwarded-for`'s FIRST entry is the client. It is spoofable
 * by anyone who can set the header, which is why it is only ever ONE of the
 * keys and never the only one.
 */
export function callerIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
