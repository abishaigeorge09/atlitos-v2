// ATLITOS v2 — supabase/functions/_shared/supabase.ts
//
// Two Supabase client constructors, matching CLAUDE.md's financial
// invariant split:
//   - `serviceRoleClient()` — the service_role key, bypasses RLS, the only
//     client allowed to write payment_intents/ledger_entries and call the
//     service_role-only RPCs (court_booking_confirm_payment, ...).
//   - `getAuthenticatedUser(req)` — validates the caller's own JWT against
//     GoTrue (never trusts a client-supplied user id), used to know *whose*
//     booking/order this is before the service-role client does anything.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { AppError } from "./app-error.ts";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new AppError(
      "INTERNAL",
      `Server misconfiguration: ${name} is not set.`,
      500,
    );
  }
  return value;
}

export function serviceRoleClient(): SupabaseClient {
  const url = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface AuthenticatedUser {
  id: string;
  /**
   * The caller's GoTrue email, when the account has one (phone-OTP signups
   * may not). razorpay-route-onboard needs it: Razorpay's Accounts API
   * requires an email on the linked account, and taking it from the
   * validated session rather than the request body keeps a client from
   * onboarding a sub-merchant under someone else's address.
   */
  email?: string;
}

/**
 * Validates the bearer token on the incoming request against GoTrue (the
 * anon-key client's `auth.getUser()` round-trips to Supabase Auth, it does
 * not just decode the JWT locally), returning the caller's user id. Throws
 * `UNAUTHENTICATED` (401) if the header is missing or the session is
 * invalid/expired.
 */
/**
 * An anon-key client carrying the caller's own bearer token, so PostgREST and
 * every `security definer` RPC see the caller's real `auth.uid()` and RLS
 * applies to them normally. AT-41's complete-session needs this: only the
 * assigned coach may call `session_transition(..., 'complete')`, and that RPC
 * reads `auth.uid()`, which is null under the service-role key. The service
 * role is still what writes the ledger afterwards; the two clients are used
 * for the two halves deliberately, never interchangeably.
 */
export function userScopedClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throw new AppError("UNAUTHENTICATED", "Missing Authorization header.", 401);
  }
  const url = requiredEnv("SUPABASE_URL");
  const anonKey = requiredEnv("SUPABASE_ANON_KEY");
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getAuthenticatedUser(
  req: Request,
): Promise<AuthenticatedUser> {
  const userClient = userScopedClient(req);

  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) {
    throw new AppError(
      "UNAUTHENTICATED",
      "Invalid or expired session.",
      401,
    );
  }

  await assertNotSuspended(data.user.id);

  return { id: data.user.id, email: data.user.email ?? undefined };
}

/**
 * SEC-F4 (0090). `users.status = 'suspended'` was enforced nowhere before this:
 * an admin could suspend an account and it would keep booking, paying and
 * uploading indefinitely.
 *
 * This is the layer that closes immediately. 0090's access-token hook also
 * denies a suspended user their next token, but that is bounded by the
 * access-token TTL, so a suspended member would keep their current token's
 * worth of access. Every protected edge function -- every money path, every
 * upload, every admin mutation -- routes through getAuthenticatedUser, so
 * checking here shuts all of them at once, on the very next request.
 *
 * The read is under the SERVICE ROLE on purpose. Reading through the caller's
 * own client would make the check depend on a SELECT policy on `users`, and a
 * policy change (or a caller whose row is not readable) would silently turn the
 * check into a no-op. That is the failure mode 0017 documents for the roles
 * lookup, and it is worth one extra client construction to avoid repeating.
 *
 * Deliberately NOT applied to `getOptionalUserId` in clip-access.ts. That helper
 * exists for the public clip feed, where a resolved session only ever GRANTS
 * more (owner/admin previews) and never authorizes a write. A suspended member
 * watching their own clip back is not a security event, and adding a
 * service-role round trip to the guest playback path would cost every anonymous
 * viewer a query for nothing.
 */
async function assertNotSuspended(userId: string): Promise<void> {
  const { data, error } = await serviceRoleClient()
    .from("users")
    .select("status, deleted_at")
    .eq("id", userId)
    .maybeSingle<{ status: string; deleted_at: string | null }>();

  if (error) {
    throw new AppError(
      "INTERNAL",
      `Failed to check account status: ${error.message}`,
      500,
    );
  }

  // 0093. A deleted account keeps a valid access token until it expires, and
  // the token hook only refuses the NEXT refresh. This is the layer that shuts
  // every edge function on the very next request, the same reason suspension
  // is checked here rather than trusting the JWT claim. Checked first so the
  // caller is told the accurate reason.
  if (data?.deleted_at) {
    throw new AppError(
      "ACCOUNT_DELETED",
      "This account has been deleted.",
      403,
    );
  }

  // No row is normal: anonymous sessions have no `users` row until onboarding
  // writes one. Absence is not suspension.
  if (data?.status === "suspended") {
    throw new AppError(
      "ACCOUNT_SUSPENDED",
      "This account is suspended. Contact support.",
      403,
    );
  }
}
