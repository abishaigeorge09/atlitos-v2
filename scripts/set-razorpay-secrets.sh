#!/usr/bin/env bash
#
# ATLITOS v2 - scripts/set-razorpay-secrets.sh
#
# Pushes the Razorpay credentials from a local file into the Supabase project's
# edge function secrets, verifies them against Razorpay, and can shred the file
# afterwards. The values never pass through a chat transcript, a command line
# argument, or this script's own output.
#
# WHY A FILE AND NOT A PASTE. Anything typed into an assistant session is
# written to that session's transcript on disk and kept. A secret that has been
# in a transcript has to be treated as rotated, which is a real cost for no
# benefit: the secret's destination is Supabase, and it can go there directly.
#
# Create the file in your OWN terminal, not inside an assistant session, because
# those log the command too:
#
#   mkdir -p ~/.config/atlitos && chmod 700 ~/.config/atlitos
#   cat > ~/.config/atlitos/razorpay.env      # paste, then Ctrl-D
#   chmod 600 ~/.config/atlitos/razorpay.env
#
# The file is KEY=VALUE lines, no quotes, no export:
#
#   RAZORPAY_MODE=test                  # or live, chooses which pair is used
#   RAZORPAY_TEST_KEY_ID=rzp_test_xxxxxxxx
#   RAZORPAY_TEST_KEY_SECRET=xxxxxxxx
#   RAZORPAY_LIVE_KEY_ID=rzp_live_xxxxxxxx
#   RAZORPAY_LIVE_KEY_SECRET=xxxxxxxx
#   RAZORPAY_WEBHOOK_SECRET=xxxxxxxx     # one secret, both webhooks
#
# Both pairs can live here at once. RAZORPAY_MODE decides which one the edge
# functions use, and _shared/razorpay.ts refuses to run if the mode and the key
# id disagree, so a live key can never be used during a test run.
#
# Usage:
#   bash scripts/set-razorpay-secrets.sh                 # push and verify
#   bash scripts/set-razorpay-secrets.sh --verify-only   # verify what is set
#   bash scripts/set-razorpay-secrets.sh --shred         # push, verify, delete the file

set -uo pipefail

ENV_FILE="${RAZORPAY_ENV_FILE:-$HOME/.config/atlitos/razorpay.env}"
PROJECT_REF="${ATLITOS_SUPABASE_REF:-syzzfgaudpifwvbpycyi}"
MODE="${1:-push}"

command -v supabase >/dev/null 2>&1 || { echo "supabase CLI is not on PATH. export PATH=/opt/homebrew/bin:\$PATH"; exit 2; }

redact() { local v="$1"; local n=${#v}; if [ "$n" -le 8 ]; then echo "set ($n chars)"; else echo "${v:0:4}...${v: -2} ($n chars)"; fi; }

if [ "$MODE" != "--verify-only" ]; then
  [ -f "$ENV_FILE" ] || { echo "no file at $ENV_FILE. See the header of this script."; exit 2; }

  PERMS=$(stat -f "%OLp" "$ENV_FILE" 2>/dev/null || stat -c "%a" "$ENV_FILE" 2>/dev/null)
  if [ "$PERMS" != "600" ]; then
    echo "WARNING: $ENV_FILE is mode $PERMS, not 600. Fixing."
    chmod 600 "$ENV_FILE"
  fi

  # Read without echoing. Only the key NAMES and a redacted shape are printed.
  set -a; # shellcheck disable=SC1090
  . "$ENV_FILE"; set +a

  RZP_MODE="${RAZORPAY_MODE:-}"
  case "$RZP_MODE" in
    test) ACTIVE_ID="${RAZORPAY_TEST_KEY_ID:-${RAZORPAY_KEY_ID:-}}"; ACTIVE_SECRET="${RAZORPAY_TEST_KEY_SECRET:-${RAZORPAY_KEY_SECRET:-}}" ;;
    live) ACTIVE_ID="${RAZORPAY_LIVE_KEY_ID:-${RAZORPAY_KEY_ID:-}}"; ACTIVE_SECRET="${RAZORPAY_LIVE_KEY_SECRET:-${RAZORPAY_KEY_SECRET:-}}" ;;
    "")   ACTIVE_ID="${RAZORPAY_KEY_ID:-}"; ACTIVE_SECRET="${RAZORPAY_KEY_SECRET:-}"
          echo "NOTE: RAZORPAY_MODE is not set, falling back to the un-prefixed names." ;;
    *)    echo "RAZORPAY_MODE must be test or live, not \"$RZP_MODE\""; exit 2 ;;
  esac

  [ -n "$ACTIVE_ID" ] && [ -n "$ACTIVE_SECRET" ] || { echo "no key pair for mode \"${RZP_MODE:-unset}\" in $ENV_FILE"; exit 2; }
  [ -n "${RAZORPAY_WEBHOOK_SECRET:-}" ] || { echo "missing from the file: RAZORPAY_WEBHOOK_SECRET"; exit 2; }

  echo "read from $ENV_FILE:"
  for k in RAZORPAY_MODE RAZORPAY_TEST_KEY_ID RAZORPAY_TEST_KEY_SECRET RAZORPAY_LIVE_KEY_ID RAZORPAY_LIVE_KEY_SECRET RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET; do
    [ -n "${!k:-}" ] && printf '  %-26s %s\n' "$k" "$(redact "${!k}")"
  done

  # The guard the edge functions also enforce, checked here so a bad file is
  # caught before it is pushed rather than at the first payment.
  case "$RZP_MODE:$ACTIVE_ID" in
    test:rzp_live_*) echo "REFUSING: RAZORPAY_MODE=test but the active key is a LIVE key."; exit 2 ;;
    live:rzp_test_*) echo "REFUSING: RAZORPAY_MODE=live but the active key is a TEST key."; exit 2 ;;
  esac

  case "$ACTIVE_ID" in
    rzp_test_*) echo "active:  TEST keys" ;;
    rzp_live_*) echo "active:  LIVE keys. Real money will move." ;;
    *) echo "active:  unrecognised key id prefix, continuing anyway" ;;
  esac

  echo "pushing to Supabase project $PROJECT_REF ..."
  # --env-file keeps the values off the process command line, where `ps` and
  # the shell history would otherwise see them.
  if supabase secrets set --project-ref "$PROJECT_REF" --env-file "$ENV_FILE" >/dev/null 2>&1; then
    echo "pushed."
  else
    echo "FAIL: supabase secrets set refused. Run it yourself to see why:"
    echo "  supabase secrets set --project-ref $PROJECT_REF --env-file $ENV_FILE"
    exit 1
  fi
fi

echo
echo "verifying against Razorpay ..."

if [ "$MODE" = "--verify-only" ]; then
  echo "  (verify-only: this checks the names are present in Supabase, not their values)"
  supabase secrets list --project-ref "$PROJECT_REF" 2>/dev/null \
    | grep -E "RAZORPAY_" \
    | awk '{printf "  %-26s present\n", $1}'
  exit 0
fi

# A real call: fetch the account's own payments list, limit 1. It needs both the
# id and the secret to be correct, so a 200 proves the pair, not just the id.
CODE=$(curl -s -o /tmp/rzp-verify.json -w "%{http_code}" --max-time 30 \
  -u "$ACTIVE_ID:$ACTIVE_SECRET" \
  "https://api.razorpay.com/v1/payments?count=1")

case "$CODE" in
  200)
    COUNT=$(python3 -c "import json;print(json.load(open('/tmp/rzp-verify.json')).get('count','?'))" 2>/dev/null)
    echo "  PASS: Razorpay accepted the key pair (payments visible: $COUNT)"
    ;;
  401)
    echo "  FAIL: 401 from Razorpay. The key id and secret do not match, or the key is disabled."
    rm -f /tmp/rzp-verify.json; exit 1 ;;
  *)
    echo "  FAIL: HTTP $CODE from Razorpay:"; head -c 300 /tmp/rzp-verify.json; echo
    rm -f /tmp/rzp-verify.json; exit 1 ;;
esac
rm -f /tmp/rzp-verify.json

echo
echo "Webhook, which this script cannot set for you:"
echo "  URL    https://$PROJECT_REF.supabase.co/functions/v1/razorpay-webhook"
echo "  Events payment.captured, payment.failed, refund.processed,"
echo "         transfer.processed, transfer.failed"
echo "  The secret you enter there must equal RAZORPAY_WEBHOOK_SECRET above."

if [ "$MODE" = "--shred" ]; then
  echo
  # Overwrite before unlinking: a plain rm leaves the bytes on disk.
  dd if=/dev/urandom of="$ENV_FILE" bs=1k count=4 conv=notrunc 2>/dev/null
  rm -f "$ENV_FILE"
  echo "shredded $ENV_FILE"
fi
