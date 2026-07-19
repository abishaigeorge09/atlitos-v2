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

  return { id: data.user.id, email: data.user.email ?? undefined };
}
