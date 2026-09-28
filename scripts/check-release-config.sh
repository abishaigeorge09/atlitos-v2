#!/usr/bin/env bash
# SEC-F6 (security audit 2026-09-04). Fails if a PRODUCTION build profile can
# ship with test-mode payment credentials.
#
# The finding: apps/mobile/eas.json's `build.production.env` block hardcoded
# EXPO_PUBLIC_RAZORPAY_KEY_ID to an `rzp_test_...` value. A production build
# made from that profile opens Razorpay's TEST environment, so either real
# customers cannot pay or real payments never reconcile against the live
# merchant account, the webhook secret and the ledger. It is a release defect
# with money consequences, and nothing in the repo would have caught it.
#
# The fix was to remove the hardcoded env block so EAS resolves those values
# from project secrets per environment. This script is the guard that keeps it
# removed: a well-meaning "just put the keys back so builds work" is exactly how
# this reappears.
#
# Deliberately grep-based and dependency-free, matching check-tokens.sh, and
# wired into the root `lint` script beside it so it runs wherever lint runs
# rather than needing its own pipeline.
set -euo pipefail

cd "$(dirname "$0")/.."

EAS="apps/mobile/eas.json"
failed=0

if [ ! -f "$EAS" ]; then
  echo "check-release-config: $EAS not found."
  exit 1
fi

# 1. No test-mode Razorpay key anywhere in the build configuration. Checked
#    across the whole file rather than only the production profile: a test key
#    in `preview` is fine in principle, but this repo builds preview artifacts
#    for founder review on real devices, and the audit's point is that the key
#    should come from EAS secrets in every profile, not be committed at all.
if grep -q 'rzp_test' "$EAS"; then
  echo "check-release-config: test-mode Razorpay key (rzp_test) found in $EAS."
  echo "  Razorpay keys must come from EAS project secrets, never the repo."
  grep -n 'rzp_test' "$EAS"
  failed=1
fi

# 2. A LIVE key committed is worse than a test one. Same rule, louder.
if grep -q 'rzp_live' "$EAS"; then
  echo "check-release-config: LIVE Razorpay key committed in $EAS. Remove it and rotate the key."
  failed=1
fi

# 3. The production profile must not carry a hardcoded env block at all. This is
#    what makes the guard hold for the Supabase values too, and it is the shape
#    the audit asked for: environment-specific EAS secrets, resolved at build
#    time, not literals in a versioned file.
if node -e '
  const eas = require("./apps/mobile/eas.json");
  const env = eas?.build?.production?.env;
  if (env && Object.keys(env).length > 0) {
    console.error("  keys present: " + Object.keys(env).join(", "));
    process.exit(1);
  }
' 2>&1 | grep -q "keys present"; then
  echo "check-release-config: apps/mobile/eas.json build.production.env is not empty."
  echo "  Production values must be set as EAS project secrets:"
  echo "    EXPO_PUBLIC_SUPABASE_URL"
  echo "    EXPO_PUBLIC_SUPABASE_ANON_KEY"
  echo "    EXPO_PUBLIC_RAZORPAY_KEY_ID  (live key, rzp_live_...)"
  echo "  Set them with: eas env:create --environment production"
  failed=1
fi

# 4. Launch runbook 3.8. apps/mobile/src/lib/supabase.ts only WARNS when the
#    Supabase URL is missing, and the app then crashes on first launch, which
#    a reviewer sees as a crash on open. So a production build refuses to start
#    without the three values. This runs where the values actually exist: inside
#    an EAS production build (EAS_BUILD_PROFILE=production, wired through the
#    eas-build-post-install hook in apps/mobile/package.json), or locally with
#    --require-env after exporting the production values. Plain `pnpm lint`
#    has no env and skips it.
if [ "${EAS_BUILD_PROFILE:-}" = "production" ] || [ "${1:-}" = "--require-env" ]; then
  for var in EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY EXPO_PUBLIC_SENTRY_DSN; do
    if [ -z "${!var:-}" ]; then
      echo "check-release-config: $var is not set for this production build."
      echo "  Set it with: eas env:create --environment production --name $var"
      failed=1
    fi
  done
fi

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "check-release-config: ok"
