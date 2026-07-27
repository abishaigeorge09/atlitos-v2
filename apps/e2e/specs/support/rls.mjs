// ATLITOS v2 — E2E support: real (anon-key, signed-in) clients for RLS/SQL
// lane assertions in the social partition specs (auth/clutch/follows/chat).
//
// Deliberately NOT service-role. helpers/sql.mjs's serviceClient() bypasses
// RLS entirely, which is right for fixture bookkeeping (finding two distinct
// ids, cleaning up scratch rows) but WRONG for an isolation assertion: a
// "coach1 cannot read player's X" claim proven with a service-role client
// proves nothing, because service role never hits the policy at all. Every
// RLS-adjacent assertion in these specs signs in as a real user with the
// anon key first (the same password grant auth.setup.ts and
// scripts/verify-realtime.mjs use) and reads/writes through THAT client.
//
// PROJECT_REF/host guard is the same one helpers/sql.mjs enforces; imported
// from there rather than re-declared so there is exactly one allowed host.

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertTestDb, PROJECT_REF } from "../../helpers/sql.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..", "..");

export const DEMO_PASSWORD = "AtlitosDemo!2026";

/** The 6 Atlitos-password personas this partition's specs use. Emails only;
 * auth.setup.ts already proved these log in (state/_auth-report.json). */
export const EMAIL = {
  player: "player@atlitos.dev",
  coach1: "coach1@atlitos.dev",
  coach2: "coach2@atlitos.dev",
  partner: "partner@atlitos.dev",
  p2VerifyPartner: "p2-verify-partner@atlitos.dev",
  admin: "admin@atlitos.dev",
};

function supabaseUrl() {
  return process.env.SUPABASE_URL ?? `https://${PROJECT_REF}.supabase.co`;
}

/** Same fallback chain as auth.setup.ts's anonKey(): env var first, else the
 * apps/mobile/.env the app itself reads. Never the service role key.
 * Exported so callers that shell out to a script needing SUPABASE_ANON_KEY
 * in its own env (e.g. chat.spec.ts's scripts/verify-realtime.mjs
 * invocation) can resolve the same key without duplicating this chain. */
export function anonKey() {
  const fromEnv = process.env.SUPABASE_ANON_KEY;
  if (fromEnv) return fromEnv;
  const envPath = join(REPO_ROOT, "apps", "mobile", ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^EXPO_PUBLIC_SUPABASE_ANON_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error("[e2e/support/rls] No anon key. Set SUPABASE_ANON_KEY or provide apps/mobile/.env");
}

// Memoized per (email) for the lifetime of this worker process. Supabase's
// password-grant endpoint is rate limited (observed: "Request rate limit
// reached" once this partition's specs, the setup project, and other
// concurrently-running QA agents against the SAME test project all sign in
// as the same handful of demo accounts repeatedly). Every case in this
// partition that needs "player@'s own authenticated client" is functionally
// asking for the SAME session, not a fresh login each time, so caching it
// here is correct, not a test-isolation compromise: RLS is evaluated per
// request against the JWT, not per login call, so a reused session proves
// exactly the same thing a fresh one would, at a fraction of the auth load.
const sessionCache = new Map();

/** Signs in as a real user with the anon key (the password grant, same call
 * the apps make). Returns an authenticated client scoped by THAT user's RLS,
 * plus their user id (read from the real sign-in response, never guessed).
 * Cached per email; call signInAs.reset() to force a fresh login. */
export async function signInAs(email, password = DEMO_PASSWORD) {
  const cached = sessionCache.get(email);
  if (cached) return cached;

  const promise = (async () => {
    assertTestDb();
    const client = createClient(supabaseUrl(), anonKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      sessionCache.delete(email);
      throw new Error(`[e2e/support/rls] sign in failed for ${email}: ${error?.message ?? "no user"}`);
    }
    return { client, userId: data.user.id, email };
  })();

  sessionCache.set(email, promise);
  try {
    return await promise;
  } catch (err) {
    sessionCache.delete(email);
    throw err;
  }
}

signInAs.reset = () => sessionCache.clear();
