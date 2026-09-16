// ATLITOS v2 — scripts/lib/demo-credentials.mjs
//
// Single source of truth for the two shared demo-account passwords used by
// the seed scripts, the verify scripts and the Playwright e2e suite.
//
// Why this file exists: the same two literals were pasted into 34 tracked
// files (auth and deployment audit, 2026-09-12). Rotating either one meant a
// 34 file change, and any file missed would keep the old value and fail at
// run time with a confusing auth error rather than an obvious one.
//
// Zero dependencies on purpose. Every consumer is either a script run with
// plain `node scripts/<name>.mjs` from the repo root or a Playwright file in
// apps/e2e, and both must be able to import this without an install step, a
// workspace link, or a bundler.
//
// ROTATION PROCEDURE
//   1. Rotate the passwords on the accounts themselves in Supabase Auth.
//      Nothing in this repo does that, and nothing in this repo should.
//   2. Export the new values in whatever shell runs the scripts and the e2e
//      suite, and set the same two names as CI secrets:
//        export ATLITOS_DEMO_PASSWORD='...'
//        export EMPOWER_DEMO_PASSWORD='...'
//      That is the whole change. No file in the repo needs editing.
//   3. Only if you deliberately want a new committed default, edit the two
//      fallback literals below. They are the only two places either password
//      appears in JavaScript. Committing a live credential is what the audit
//      flagged, so prefer step 2.
//
//   The .maestro/*.yaml flows cannot import JavaScript. They read the same
//   two variable names through Maestro's shell environment injection, with
//   the current literals as per-flow defaults in each flow's `env:` block.
//   Step 2 covers those flows too. Step 3 would mean editing their defaults
//   as well, so it is a 3 file change there rather than 1.
//
// Precedence: the environment variable wins whenever it is set and non-empty;
// otherwise the literal below applies, so an unconfigured checkout behaves
// exactly as it did before this module existed.

function fromEnv(name, fallback) {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

/**
 * Password for the six @atlitos.dev demo accounts: player, coach1, coach2,
 * partner, p2-verify-partner, admin. Created by scripts/seed-demo-users.mjs.
 */
export const ATLITOS_PASSWORD = fromEnv("ATLITOS_DEMO_PASSWORD", "AtlitosDemo!2026");

/**
 * Password for the three Empower/UPA demo accounts: upa.verified, upa.tennis,
 * donor. Created by scripts/seed-empower-upa-users.mjs.
 */
export const EMPOWER_PASSWORD = fromEnv("EMPOWER_DEMO_PASSWORD", "EmpowerDemo!2026");
