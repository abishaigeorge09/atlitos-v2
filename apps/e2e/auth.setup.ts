// ATLITOS v2 — E2E auth setup project.
//
// Logs in every persona with the Supabase password grant (the same call the
// apps make) and writes a Playwright storage state to state/<persona>.json
// that authenticates ALL FOUR web surfaces at once:
//
//   - athlete-web (Expo web, supabase-js + AsyncStorage web adapter) and
//     admin (Vite SPA, supabase-js) both persist the session in localStorage
//     under the default key `sb-<ref>-auth-token` as plain JSON.
//   - portal-court and portal-life (Next.js, @supabase/ssr) persist it in
//     cookies under the same name, encoded `base64-<base64url(JSON)>` and
//     chunked into `.0`, `.1`, ... suffixes above ~3180 chars.
//
// Personas that fail to log in are recorded in state/_auth-report.json and
// their state file is NOT written; fixtures/auth.ts throws a pointed error if
// a spec later asks for one of them. Set E2E_AUTH_STRICT=1 to make any login
// failure fail the setup project itself (blocking all dependent projects).
// Known at scaffold time: the three Empower personas (upa-verified,
// upa-tennis, donor) get invalid_credentials on the live DB because
// scripts/seed-empower-upa-users.mjs (service role) has not been run there.

import { expect, test as setup } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const STATE_DIR = join(HERE, "state");

const PROJECT_REF = "syzzfgaudpifwvbpycyi";
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? `https://${PROJECT_REF}.supabase.co`;

const ATLITOS_PASSWORD = "AtlitosDemo!2026";
const EMPOWER_PASSWORD = "EmpowerDemo!2026";

// The 9 demo personas. File-safe names map 1:1 to state/<name>.json and to
// the `persona` option in fixtures/auth.ts.
export const PERSONAS: ReadonlyArray<{
  name: string;
  email: string;
  password: string;
}> = [
  { name: "player", email: "player@atlitos.dev", password: ATLITOS_PASSWORD },
  { name: "coach1", email: "coach1@atlitos.dev", password: ATLITOS_PASSWORD },
  { name: "coach2", email: "coach2@atlitos.dev", password: ATLITOS_PASSWORD },
  { name: "partner", email: "partner@atlitos.dev", password: ATLITOS_PASSWORD },
  {
    name: "p2-verify-partner",
    email: "p2-verify-partner@atlitos.dev",
    password: ATLITOS_PASSWORD,
  },
  { name: "admin", email: "admin@atlitos.dev", password: ATLITOS_PASSWORD },
  {
    name: "upa-verified",
    email: "upa.verified@atlitos.dev",
    password: EMPOWER_PASSWORD,
  },
  {
    name: "upa-tennis",
    email: "upa.tennis@atlitos.dev",
    password: EMPOWER_PASSWORD,
  },
  { name: "donor", email: "donor@atlitos.dev", password: EMPOWER_PASSWORD },
];

// Surfaces that keep the session in localStorage (supabase-js default).
const LOCALSTORAGE_ORIGINS = [
  "https://atlitos-app.vercel.app",
  "https://atlitos-admin.vercel.app",
];

// Surfaces that keep the session in @supabase/ssr cookies.
const COOKIE_DOMAINS = [
  "atlitos-portal-court.vercel.app",
  "atlitos-portal-life.vercel.app",
];

const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

/** Anon key: env first, else the same apps/mobile/.env the verify scripts read. */
function anonKey(): string {
  const fromEnv = process.env.SUPABASE_ANON_KEY;
  if (fromEnv) return fromEnv;
  const envPath = join(REPO_ROOT, "apps", "mobile", ".env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(
      /^EXPO_PUBLIC_SUPABASE_ANON_KEY=(.+)$/m,
    );
    if (m) return m[1].trim();
  }
  throw new Error(
    "[e2e] No anon key. Set SUPABASE_ANON_KEY or provide apps/mobile/.env",
  );
}

type Session = Record<string, unknown> & { expires_at?: number };

async function passwordLogin(
  email: string,
  password: string,
  key: string,
): Promise<{ ok: true; session: Session } | { ok: false; error: string }> {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
  );
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || !json.access_token) {
    return {
      ok: false,
      error: `${res.status} ${JSON.stringify(json).slice(0, 200)}`,
    };
  }
  return { ok: true, session: json as Session };
}

/** @supabase/ssr cookie encoding: "base64-" + base64url(JSON), chunked. */
function ssrCookieChunks(sessionJson: string): Array<{ name: string; value: string }> {
  const encoded =
    "base64-" +
    Buffer.from(sessionJson, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const MAX_CHUNK = 3180;
  if (encoded.length <= MAX_CHUNK) {
    return [{ name: STORAGE_KEY, value: encoded }];
  }
  const chunks: Array<{ name: string; value: string }> = [];
  for (let i = 0; i * MAX_CHUNK < encoded.length; i++) {
    chunks.push({
      name: `${STORAGE_KEY}.${i}`,
      value: encoded.slice(i * MAX_CHUNK, (i + 1) * MAX_CHUNK),
    });
  }
  return chunks;
}

function storageStateFor(session: Session) {
  const sessionJson = JSON.stringify(session);
  const cookieExpiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
  return {
    cookies: COOKIE_DOMAINS.flatMap((domain) =>
      ssrCookieChunks(sessionJson).map((c) => ({
        name: c.name,
        value: c.value,
        domain,
        path: "/",
        expires: cookieExpiry,
        httpOnly: false,
        secure: true,
        sameSite: "Lax" as const,
      })),
    ),
    origins: LOCALSTORAGE_ORIGINS.map((origin) => ({
      origin,
      localStorage: [{ name: STORAGE_KEY, value: sessionJson }],
    })),
  };
}

setup("log in all personas and write storage states", async () => {
  mkdirSync(STATE_DIR, { recursive: true });
  const key = anonKey();
  const report: Record<string, { ok: boolean; email: string; error?: string }> =
    {};

  for (const persona of PERSONAS) {
    const result = await passwordLogin(persona.email, persona.password, key);
    if (result.ok) {
      writeFileSync(
        join(STATE_DIR, `${persona.name}.json`),
        JSON.stringify(storageStateFor(result.session), null, 2),
      );
      report[persona.name] = { ok: true, email: persona.email };
    } else {
      report[persona.name] = {
        ok: false,
        email: persona.email,
        error: result.error,
      };
    }
  }

  writeFileSync(
    join(STATE_DIR, "_auth-report.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2),
  );

  const failed = Object.entries(report).filter(([, r]) => !r.ok);
  for (const [name, r] of failed) {
    console.warn(`[e2e setup] persona ${name} (${r.email}) login FAILED: ${r.error}`);
  }

  // At least one persona must work or the whole harness is pointless.
  expect(
    Object.values(report).some((r) => r.ok),
    "no persona could log in at all; check anon key and Supabase availability",
  ).toBe(true);

  if (process.env.E2E_AUTH_STRICT === "1") {
    expect(
      failed.map(([name]) => name),
      "E2E_AUTH_STRICT=1: every persona must log in",
    ).toEqual([]);
  }
});
