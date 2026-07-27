// ATLITOS v2 — E2E seed/reset wrapper.
//
// Thin wrapper over the existing scripts/seed-*.mjs at the repo root. It does
// not duplicate any seeding logic; it shells out to the scripts the phases
// already trust, with the process env passed through (so
// SUPABASE_SERVICE_ROLE_KEY, where a script needs it, comes from the caller's
// environment, never from this repo).
//
// Idempotency: the underlying scripts are ensure-style (they check for
// existing users/fixtures and skip creation), so calling these repeatedly is
// safe. Within one process each reset additionally memoizes its in-flight
// promise, so parallel specs sharing a worker trigger each script at most
// once per run.
//
// Guard: every entry point calls assertTestDb() from helpers/sql.mjs first,
// so a reset can never run unarmed (E2E=1) or against a foreign project.
//
// Key requirements per script:
//   - seed-demo-users.mjs, seed-empower-upa-users.mjs: SUPABASE_SERVICE_ROLE_KEY
//   - seed-coaching-fixtures.mjs, seed-groups-demo.mjs, seed-onboarding-demo.mjs:
//     anon-key sign-in as demo users (no service role needed)

import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { assertTestDb } from "../helpers/sql.mjs";

const execFileAsync = promisify(execFile);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const inflight = new Map();

function runScript(scriptName) {
  assertTestDb();
  const existing = inflight.get(scriptName);
  if (existing) return existing;

  const promise = execFileAsync(
    process.execPath,
    [join(REPO_ROOT, "scripts", scriptName)],
    {
      cwd: REPO_ROOT,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    },
  )
    .then(({ stdout, stderr }) => {
      if (stdout.trim()) console.log(`[e2e/seed ${scriptName}]\n${stdout.trim()}`);
      if (stderr.trim()) console.warn(`[e2e/seed ${scriptName}] stderr:\n${stderr.trim()}`);
    })
    .catch((err) => {
      inflight.delete(scriptName);
      throw new Error(
        `[e2e/seed] ${scriptName} failed: ${err.message}\n` +
          `${err.stdout ?? ""}\n${err.stderr ?? ""}`,
      );
    });

  inflight.set(scriptName, promise);
  return promise;
}

/** Demo auth users (player, coaches, partner, admin). Needs service role key. */
export function resetDemoUsers() {
  return runScript("seed-demo-users.mjs");
}

/** Empower UPA + donor auth users. Needs service role key. */
export function resetEmpowerUpaUsers() {
  return runScript("seed-empower-upa-users.mjs");
}

/** Coaching domain fixtures (sessions, availability). Anon-key based. */
export function resetCoachingFixtures() {
  return runScript("seed-coaching-fixtures.mjs");
}

/** Groups domain demo data. Anon-key based. */
export function resetGroupsDemo() {
  return runScript("seed-groups-demo.mjs");
}

/** Onboarding demo data. Anon-key based. */
export function resetOnboardingDemo() {
  return runScript("seed-onboarding-demo.mjs");
}

/** Everything, users first (fixture scripts sign in as the demo users). */
export async function resetAll() {
  await resetDemoUsers();
  await resetEmpowerUpaUsers();
  await resetCoachingFixtures();
  await resetGroupsDemo();
  await resetOnboardingDemo();
}
