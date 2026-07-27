// ATLITOS v2 — E2E service-role SQL helper with a HARD test-DB guard.
//
// Why the guard exists: a service-role client bypasses RLS entirely. The only
// database this harness is ever allowed to point at is the Atlitos test
// project syzzfgaudpifwvbpycyi. Both conditions are checked on every client
// creation, no caching of a pre-guard client:
//
//   1. The resolved Supabase URL host must be exactly
//      `syzzfgaudpifwvbpycyi.supabase.co`.
//   2. process.env.E2E must be the literal string "1" (the arming switch;
//      playwright.config.ts enforces the same).
//
// The service role key is NEVER hardcoded and never read from a repo file.
// It comes only from process.env.SUPABASE_SERVICE_ROLE_KEY, the same contract
// scripts/seed-demo-users.mjs and scripts/seed-empower-upa-users.mjs use.

import { createClient } from "@supabase/supabase-js";

export const PROJECT_REF = "syzzfgaudpifwvbpycyi";
const EXPECTED_HOST = `${PROJECT_REF}.supabase.co`;

/**
 * Throws unless this process is armed (E2E=1) and pointed at the one allowed
 * test project. Exported so seed/reset.mjs can enforce the same gate before
 * shelling out to seed scripts.
 */
export function assertTestDb() {
  if (process.env.E2E !== "1") {
    throw new Error(
      "[e2e/sql] Refusing service-role access: E2E is not '1'. " +
        "This guard is deliberate; arm the harness with E2E=1.",
    );
  }
  const url = process.env.SUPABASE_URL ?? `https://${EXPECTED_HOST}`;
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`[e2e/sql] SUPABASE_URL is not a valid URL: ${url}`);
  }
  if (host !== EXPECTED_HOST) {
    throw new Error(
      `[e2e/sql] Refusing service-role access to ${host}. ` +
        `Only ${EXPECTED_HOST} (project ${PROJECT_REF}) is allowed.`,
    );
  }
  return url;
}

/**
 * Service-role Supabase client for direct DB assertions in specs.
 * Guarded by assertTestDb() on every call.
 */
export function serviceClient() {
  const url = assertTestDb();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "[e2e/sql] SUPABASE_SERVICE_ROLE_KEY is not set. The harness never " +
        "hardcodes or vendors this key; export it in the environment " +
        "(same contract as scripts/seed-demo-users.mjs).",
    );
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Codifies the AT-62 lesson: an isolation assertion between two parties is
 * VACUOUS if both sides are actually the same party. Call this on the two
 * owner ids BEFORE trusting any cross-party isolation result.
 *
 * Throws if either id is missing or if they are equal.
 */
export function assertIsolation(idA, idB, label = "isolation parties") {
  if (idA == null || idA === "" || idB == null || idB === "") {
    throw new Error(
      `[e2e/sql] ${label}: got a missing id (a=${String(idA)}, b=${String(idB)}). ` +
        "An isolation check against a missing party proves nothing.",
    );
  }
  if (idA === idB) {
    throw new Error(
      `[e2e/sql] ${label}: both sides are the SAME id (${String(idA)}). ` +
        "The isolation assertion would pass vacuously (see AT-62). Pick two " +
        "genuinely different owners before asserting isolation.",
    );
  }
}
