// ATLITOS v2 — scripts/lib/demo-credentials.mjs
//
// Single source of truth for the two shared demo-account passwords used by
// the seed scripts, the verify scripts and the Playwright e2e suite.
//
// No password is committed here any more (launch runbook, 2026-09-29). The
// previous literals were in the repo, and the same accounts exist in
// production, including the demo admin, so anyone who had read the repo could
// sign in as them. They were rotated with scripts/rotate-demo-passwords.mjs.
//
// Set both values in the shell that runs the scripts, the e2e suite or the
// Maestro flows (and as CI secrets for any job that targets a hosted project):
//   export ATLITOS_DEMO_PASSWORD='...'
//   export EMPOWER_DEMO_PASSWORD='...'
// Maestro cannot import JavaScript; pass the same names with
//   maestro test -e ATLITOS_DEMO_PASSWORD="$ATLITOS_DEMO_PASSWORD" <flow>
//
// Against a LOCAL stack only (SUPABASE_URL on 127.0.0.1 or localhost, or
// unset while DEMO_TARGET=local), a fixed local value is used when the
// variable is missing, so `supabase start` plus the seed scripts and CI keep
// working with no secret. Anything else without the variable stops with a
// clear error instead of guessing.

const LOCAL_FALLBACK = {
  ATLITOS_DEMO_PASSWORD: "LocalStackDemo!Atlitos",
  EMPOWER_DEMO_PASSWORD: "LocalStackDemo!Empower",
};

function targetsLocalStack() {
  const url = process.env.SUPABASE_URL ?? "";
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)) return true;
  return url === "" && process.env.DEMO_TARGET === "local";
}

function fromEnv(name) {
  const value = process.env[name];
  if (value && value.length > 0) return value;
  if (targetsLocalStack()) return LOCAL_FALLBACK[name];
  throw new Error(
    `${name} is not set. Demo account passwords are no longer committed. ` +
      `Export ${name} (ask a founder for the current value), or point SUPABASE_URL at a local stack.`,
  );
}

/**
 * Password for the six @atlitos.dev demo accounts: player, coach1, coach2,
 * partner, p2-verify-partner, admin. Created by scripts/seed-demo-users.mjs.
 */
export const ATLITOS_PASSWORD = fromEnv("ATLITOS_DEMO_PASSWORD");

/**
 * Password for the three Empower/UPA demo accounts: upa.verified, upa.tennis,
 * donor. Created by scripts/seed-empower-upa-users.mjs.
 */
export const EMPOWER_PASSWORD = fromEnv("EMPOWER_DEMO_PASSWORD");
