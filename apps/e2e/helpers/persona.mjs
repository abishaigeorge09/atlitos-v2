// ATLITOS v2 — E2E persona auth helper.
//
// Money specs need a FRESH bearer token per persona to call edge functions
// and RPCs directly (the storage-state files auth.setup.ts writes are for
// the browser context; this is the same password-grant call, exposed to
// spec code that talks to Supabase over plain fetch/supabase-js instead of
// a Page). Mirrors auth.setup.ts's passwordLogin exactly, no separate login
// logic to drift out of sync.
//
// No E2E=1 guard here on purpose: this only ever does what the app's own
// login screen does (a password grant with the anon key), the same call
// every persona's browser session already makes. The service-role guard
// lives in helpers/sql.mjs, which is the thing that actually needs it.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

const PROJECT_REF = "syzzfgaudpifwvbpycyi";

export const SUPABASE_URL = process.env.SUPABASE_URL ?? `https://${PROJECT_REF}.supabase.co`;

const ATLITOS_PASSWORD = "AtlitosDemo!2026";
const EMPOWER_PASSWORD = "EmpowerDemo!2026";

/** Same 9 demo personas auth.setup.ts logs in, name -> {email, password}. */
export const PERSONA_CREDENTIALS = {
  player: { email: "player@atlitos.dev", password: ATLITOS_PASSWORD },
  coach1: { email: "coach1@atlitos.dev", password: ATLITOS_PASSWORD },
  coach2: { email: "coach2@atlitos.dev", password: ATLITOS_PASSWORD },
  partner: { email: "partner@atlitos.dev", password: ATLITOS_PASSWORD },
  "p2-verify-partner": { email: "p2-verify-partner@atlitos.dev", password: ATLITOS_PASSWORD },
  admin: { email: "admin@atlitos.dev", password: ATLITOS_PASSWORD },
  "upa-verified": { email: "upa.verified@atlitos.dev", password: EMPOWER_PASSWORD },
  "upa-tennis": { email: "upa.tennis@atlitos.dev", password: EMPOWER_PASSWORD },
  donor: { email: "donor@atlitos.dev", password: EMPOWER_PASSWORD },
};

export function anonKey() {
  const fromEnv = process.env.SUPABASE_ANON_KEY;
  if (fromEnv) return fromEnv;
  const envPath = join(REPO_ROOT, "apps", "mobile", ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^EXPO_PUBLIC_SUPABASE_ANON_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error("[e2e/persona] No anon key. Set SUPABASE_ANON_KEY or provide apps/mobile/.env");
}

// GoTrue's password-grant endpoint rate-limits repeated logins. Money specs
// across five files each sign in as the same handful of personas many times
// over one run, which trips that limit fast if every call is a fresh login.
// Memoized per (name) for this worker process's lifetime: one real login per
// persona, every subsequent call in the same process reuses the session. A
// worker process's lifetime is one Playwright run, well inside a Supabase
// access token's expiry, so there is no refresh path to build here.
const sessionCache = new Map();

async function loginFresh(name) {
  const creds = PERSONA_CREDENTIALS[name];
  const key = anonKey();
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(
      `[e2e/persona] Login failed for "${name}" (${creds.email}): ${res.status} ${JSON.stringify(json).slice(0, 200)}. ` +
        "If this is one of the Empower personas, scripts/seed-empower-upa-users.mjs may not have been run against this project. " +
        "If this is a 429 rate limit, other specs/workers are logging in concurrently; re-run with fewer workers (--workers=1).",
    );
  }
  const client = createClient(SUPABASE_URL, key, {
    global: { headers: { Authorization: `Bearer ${json.access_token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { token: json.access_token, userId: json.user.id, email: creds.email, client };
}

/**
 * Signs in as `name` (a key of PERSONA_CREDENTIALS) and returns a bearer
 * token, the user id, and a supabase-js client authenticated as that user
 * (RLS-scoped, not service-role) for direct PostgREST/RPC calls. Memoized
 * per persona per worker process (see sessionCache above); pass
 * `{ fresh: true }` to force a new login (e.g. after deliberately mutating
 * that user's role mid-spec, where a stale JWT would carry stale claims).
 */
export async function personaSession(name, opts = {}) {
  if (!PERSONA_CREDENTIALS[name]) {
    throw new Error(`[e2e/persona] Unknown persona "${name}". Known: ${Object.keys(PERSONA_CREDENTIALS).join(", ")}`);
  }
  if (!opts.fresh && sessionCache.has(name)) {
    return sessionCache.get(name);
  }
  const promise = loginFresh(name).catch((err) => {
    sessionCache.delete(name);
    throw err;
  });
  sessionCache.set(name, promise);
  return promise;
}
