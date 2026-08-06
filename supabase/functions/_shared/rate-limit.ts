// ATLITOS v2 — supabase/functions/_shared/rate-limit.ts
//
// LAUNCH Phase 3, Track B. Thin wrapper over the Postgres-backed token bucket
// RPC Track A owns (CT-2, PHASE-3-STATUS.md): `public.take_rate_limit_token`.
// Edge isolates have no durable shared memory, so the bucket state lives in
// Postgres (`public.edge_rate_limits`), one shared RPC, service_role EXECUTE
// only. This file never talks to that table directly, only the RPC.
//
// FAIL-MODE (the plan's non-negotiable): a DB hiccup on the rate-limit check
// itself must never turn into a 500 on a READ path. `takeRateLimitToken`
// FAILS OPEN on an RPC error (serves the request, logs the failure) for both
// consumers in this phase (`get-clip-playback-url`/`get-clip-playback-urls`,
// `ai-search`). Throttling is a scale guard, not a security boundary; the
// security boundaries (clip authz, RLS) fail closed as always and are
// untouched by this file.

// deno-lint-ignore no-explicit-any
type AnySupabaseClient = any;

export interface RateLimitOutcome {
  /** True when the request may proceed (token taken, or the check failed open). */
  allowed: boolean;
  /** True when `allowed` is true only because the RPC itself errored. */
  failedOpen: boolean;
}

/**
 * Atomically take one token from `bucket`/`key`'s fixed window
 * (`p_max` tokens per `p_window_seconds`). Must be called with a
 * SERVICE ROLE client: EXECUTE on `take_rate_limit_token` is revoked from
 * `anon`/`authenticated` (CT-2), so a caller passing a user-scoped client
 * gets a permission error here, which itself fails open per the mode above.
 */
export async function takeRateLimitToken(
  supabase: AnySupabaseClient,
  bucket: string,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<RateLimitOutcome> {
  try {
    const { data, error } = await supabase.rpc("take_rate_limit_token", {
      p_bucket: bucket,
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error(`[rate-limit] take_rate_limit_token(${bucket}) errored, failing open: ${error.message}`);
      return { allowed: true, failedOpen: true };
    }
    return { allowed: data === true, failedOpen: false };
  } catch (err) {
    console.error(`[rate-limit] take_rate_limit_token(${bucket}) threw, failing open:`, err);
    return { allowed: true, failedOpen: true };
  }
}

/** Best-effort client IP, for the per-IP playback bucket. Never authoritative for security, only for the throttle key. */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

/**
 * The CT-1 429 shape: `{ error: "RATE_LIMITED", retry_after_seconds }`, flat
 * (not the `{ error: { code, message } }` AppError envelope every other
 * function uses), because CT-1 in PHASE-3-STATUS.md names this exact body.
 */
export function rateLimitedResponse(retryAfterSeconds: number, corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: "RATE_LIMITED", retry_after_seconds: retryAfterSeconds }),
    {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
