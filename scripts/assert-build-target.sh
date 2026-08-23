#!/bin/bash
# Asserts which Supabase project a built .app actually talks to.
#
# WHY THIS EXISTS. On 2026-08-23 a full afternoon of device QA ran against
# PRODUCTION while the operator believed it was running against the local
# stack. Nothing lied; nothing was checked. The bundle was grepped once with
#
#   grep -aoE "https://[a-z]+\.supabase\.co" main.jsbundle
#
# which CANNOT MATCH a real project ref, because refs contain digits and the
# character class does not. The grep returned nothing, the absence was read as
# proof of "local", and every run after that was pointed at production.
#
# No data was harmed: the flows were reads plus demo account sign ins, and the
# one destructive screen refused because its RPC is not deployed there. That
# was luck, not design. This script is the design.
#
# The lesson is the general one: A GREP THAT FINDS NOTHING IS NOT EVIDENCE OF
# ABSENCE UNTIL THE PATTERN HAS BEEN SHOWN TO MATCH SOMETHING. Negative test
# your checks.
#
#   bash scripts/assert-build-target.sh <path-to-.app> [expected]
#     expected: "local" (default) or "production"
set -u

APP="${1:-}"
EXPECT="${2:-local}"
PROD_REF="syzzfgaudpifwvbpycyi"

if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  echo "assert-build-target: usage: $0 <path-to-.app> [local|production]" >&2
  exit 2
fi

BUNDLE="$APP/main.jsbundle"
if [ ! -f "$BUNDLE" ]; then
  echo "FAIL: no main.jsbundle inside $APP." >&2
  echo "      A Release build embeds one. A Debug build does not, and 'no Metro" >&2
  echo "      running' is NOT proof, because expo run:ios starts its own." >&2
  exit 1
fi

# Self test the pattern FIRST. If the regex cannot match a known present
# string, the whole check is meaningless and must fail loudly rather than
# report a clean bill of health. This is the exact failure being prevented.
if ! grep -aqE "supabase" "$BUNDLE"; then
  echo "FAIL: the word 'supabase' does not appear in the bundle at all." >&2
  echo "      Either the bundle is not what it claims to be, or this check is" >&2
  echo "      broken. Refusing to report a target." >&2
  exit 1
fi

FOUND_PROD=0
FOUND_LOCAL=0
grep -aq "$PROD_REF" "$BUNDLE" && FOUND_PROD=1
grep -aqE "127\.0\.0\.1:54321|localhost:54321" "$BUNDLE" && FOUND_LOCAL=1

echo "build target report for $(basename "$APP")"
echo "  production ref ($PROD_REF): $([ $FOUND_PROD -eq 1 ] && echo PRESENT || echo absent)"
echo "  local stack (127.0.0.1:54321):        $([ $FOUND_LOCAL -eq 1 ] && echo PRESENT || echo absent)"

case "$EXPECT" in
  local)
    if [ $FOUND_PROD -eq 1 ]; then
      echo "FAIL: expected a LOCAL build, but the production project ref is embedded." >&2
      echo "      Do not run QA flows against this build. Rebuild with" >&2
      echo "      EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY set to the" >&2
      echo "      local stack, which take precedence over apps/mobile/.env." >&2
      exit 1
    fi
    if [ $FOUND_LOCAL -eq 0 ]; then
      echo "FAIL: expected a LOCAL build, but no local stack URL is embedded either." >&2
      exit 1
    fi
    echo "PASS: local build."
    ;;
  production)
    if [ $FOUND_PROD -eq 0 ]; then
      echo "FAIL: expected a PRODUCTION build, but the project ref is not embedded." >&2
      exit 1
    fi
    echo "PASS: production build."
    ;;
  *)
    echo "assert-build-target: expected must be 'local' or 'production'" >&2
    exit 2
    ;;
esac
