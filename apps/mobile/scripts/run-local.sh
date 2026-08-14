#!/usr/bin/env bash
# Run the mobile app against the LOCAL Supabase stack instead of production,
# without ever touching apps/mobile/.env (which stays untouched, permission
# rules on this repo forbid reading or writing it, and it should never be
# the thing that decides local vs production).
#
# HOW THIS WORKS
# Expo's env loader (`@expo/env`) only fills a variable from a .env file if
# it is not ALREADY present in the process environment. This script exports
# EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY / RAZORPAY test
# key directly into the shell that then execs `expo run:ios`, so those three
# values win over whatever apps/mobile/.env contains for this one process
# tree only. No file on disk changes, gitignored or otherwise.
#
# WHY THIS CANNOT LEAK INTO A SHIPPED BUILD
#   1. It is a plain script, versioned and reviewable, never invoked by
#      `eas build`, `pnpm build`, or any CI/release path in this repo. Only
#      a developer running it BY NAME on their own machine triggers it.
#   2. `eas build`'s production profile (apps/mobile/eas.json) sets its own
#      EXPO_PUBLIC_* values under `build.production.env`, which is a
#      completely separate code path from this script and is not affected
#      by it in any way, since EAS builds run in EAS's own cloud checkout
#      with its own fresh process environment.
#   3. The values are hardcoded to 127.0.0.1, which is not reachable outside
#      the machine running the simulator, so even a mistaken run produces an
#      app that can obviously not talk to anything, not a silent prod point.
#
# USAGE
#   supabase start                      # from repo root, once
#   apps/mobile/scripts/run-local.sh    # from repo root or apps/mobile
#
# Regenerate the anon key below if you ever recreate the local project
# (`supabase status` prints the current one under "Publishable").

set -euo pipefail

export EXPO_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
export EXPO_PUBLIC_RAZORPAY_KEY_ID="${EXPO_PUBLIC_RAZORPAY_KEY_ID:-rzp_test_TCwxkMaUz54BPH}"

# The Release build phase's "Upload Debug Symbols to Sentry" script shells
# out to sentry-cli, which needs an authenticated org (SENTRY_ORG or an
# org-scoped token) to upload. That is a CI/release concern, not a local dev
# one, and no such auth exists on this machine, so the upload fails the
# whole xcodebuild step (exit 65) with no product code involved. Disabling
# the auto upload for local runs only, per sentry-cli's own suggested fix.
export SENTRY_DISABLE_AUTO_UPLOAD=true

echo "Running mobile app against LOCAL Supabase: $EXPO_PUBLIC_SUPABASE_URL"
echo "This is NOT production. apps/mobile/.env is untouched."

cd "$(dirname "$0")/.."
exec ./node_modules/.bin/expo run:ios --device "${LOCAL_IOS_UDID:-8AF6A5E2-F889-4477-8634-97B4AB5D5453}" --configuration Release "$@"
