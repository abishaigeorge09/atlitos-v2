#!/usr/bin/env bash
#
# Atlitos Definition of Done.
#
# WHY THIS FILE EXISTS
# --------------------
# `.git/hooks/pre-push` has called `./scripts/dod.sh` since 11 August 2026
# behind an `[ -x scripts/dod.sh ]` guard. The file did not exist and never had,
# in any commit, so the guard turned its absence into a silent exit 0 and the
# push went through unchecked. See docs/qa/verify/VERIFICATION-WAVE-1.md P1-6.
#
# WHAT DONE MEANS HERE
#   1. the security and house-rule invariants hold
#   2. every workspace typechecks
#   3. every workspace lints
#   4. every workspace builds
#
# Order is deliberate. The invariants are seconds and catch the failures that
# cost the most; the build is minutes and catches the least. Nothing is skipped
# on a failure though: all four run and the summary lists every red one, because
# a script that stops at the first error trains people to fix one thing, push,
# and wait to find the next.
#
# USAGE
#   scripts/dod.sh                 the full gate
#   scripts/dod.sh --fast          invariants, typecheck and lint, no build
#   scripts/dod.sh --force         defeat the turbo cache
#
# ON CACHED GREENS. Turbo hashes tracked source, so a cached green for an
# unchanged input is a real green. It is NOT real when the thing you changed is
# untracked or generated, which is how a stale
# `apps/mobile/.expo/types/router.d.ts` once replayed a verdict reached before
# the change existed (docs/qa/CURRENT-STATE.md). Use --force after touching
# anything gitignored.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
ROOT=$(pwd)

# Homebrew first: nvm's default node on this machine is too old for the
# toolchain, and the resulting failure looks like a code error rather than an
# environment one.
export PATH=/opt/homebrew/bin:$PATH

FAST=0
FORCE_ARGS=""
for arg in "$@"; do
  case "$arg" in
    --fast) FAST=1 ;;
    --force) FORCE_ARGS="--force" ;;
    -h|--help) sed -n '1,35p' "$0"; exit 0 ;;
    *) echo "dod: unknown argument '$arg'" >&2; exit 2 ;;
  esac
done

if ! command -v pnpm >/dev/null 2>&1; then
  echo "dod: pnpm is not on PATH. Nothing can be verified, so this is a FAILURE," >&2
  echo "     not a skip." >&2
  exit 2
fi

FAILED_STEPS=""
LOGDIR=$(mktemp -d) || exit 2
trap 'rm -rf "$LOGDIR"' EXIT

step() {
  local name="$1"; shift
  echo
  echo "=============================================================="
  echo "dod: $name"
  echo "     $*"
  echo "=============================================================="
  if "$@" 2>&1 | tee "$LOGDIR/$name.log"; then
    echo "dod: $name OK"
  else
    echo "dod: $name FAILED"
    FAILED_STEPS="$FAILED_STEPS $name"
  fi
}

echo "Atlitos Definition of Done"
echo "root  $ROOT"
echo "node  $(node --version 2>/dev/null || echo 'not found')"
echo "pnpm  $(pnpm --version 2>/dev/null || echo 'not found')"

# 1. Invariants. Passed --offline unless a database connection string is
#    present, because CI has no route to 5432. What that leaves uncovered is
#    printed by the script itself and is recorded in docs/DEBT.md.
if [ -n "${ATLITOS_DB_URL:-${SUPABASE_DB_URL:-}}" ]; then
  step invariants ./scripts/security-invariants.sh
else
  step invariants ./scripts/security-invariants.sh --offline
fi

# 2, 3, 4. The workspace. `lint` at the root is `turbo lint && check-tokens.sh`,
# so the radius token check rides along with it.
step typecheck pnpm turbo typecheck $FORCE_ARGS
step lint pnpm run lint
if [ "$FAST" = 0 ]; then
  step build pnpm turbo build $FORCE_ARGS
else
  echo
  echo "dod: build SKIPPED because --fast was passed. This run is NOT a full"
  echo "     Definition of Done and must not be reported as one."
fi

echo
echo "=============================================================="
if [ -n "$FAILED_STEPS" ]; then
  echo "dod: RED.  Failed steps:$FAILED_STEPS"
  echo "     Scroll up for the output of each. Nothing here is advisory."
  exit 1
fi
if [ "$FAST" = 1 ]; then
  echo "dod: partial green (--fast, build not run)."
  exit 0
fi
echo "dod: GREEN. Invariants, typecheck, lint and build all passed."
exit 0
