#!/usr/bin/env bash
#
# ATLITOS v2 - scripts/verify-play-credentials.sh
#
# Answers one question in seconds: can the service account EAS submits with
# actually talk to Google Play for com.atlitos.app?
#
# WHY THIS EXISTS. `eas submit --platform android` authenticates only at the
# very end, after a full Android build has been produced and uploaded. A
# service account that cannot reach the Android Publisher API therefore costs
# a whole build cycle to discover. On 2026-09-24 this check found exactly
# that: eas.json pointed at a FIREBASE admin key, which mints a token happily
# and then gets 403 PERMISSION_DENIED from Play.
#
# A 403 here means one of two things, and the message cannot tell them apart:
#   1. the app record com.atlitos.app does not exist under the developer
#      account yet (an edits call on a missing app is 403, not 404), or
#   2. the service account has no Play Console access, or release-only
#      permissions. It needs BOTH "Edit and delete draft apps" and "Manage
#      store presence" (the BelieversDiary trap, reference_believersdiary_play).
#
# Usage:  bash scripts/verify-play-credentials.sh [path/to/key.json] [package]
# Exit 0 only when Play answers 200 and an edit id comes back.

set -uo pipefail

KEY="${1:-apps/mobile/google-service-account.json}"
PKG="${2:-com.atlitos.app}"

command -v openssl >/dev/null 2>&1 || { echo "openssl is not on PATH"; exit 2; }
[ -f "$KEY" ] || { echo "no service account key at $KEY"; exit 2; }

EMAIL=$(python3 -c "import json,sys;print(json.load(open('$KEY')).get('client_email',''))")
TYPE=$(python3 -c "import json,sys;print(json.load(open('$KEY')).get('type',''))")
[ -n "$EMAIL" ] || { echo "no client_email in $KEY, is it a service account key?"; exit 2; }

echo "key:     $KEY"
echo "account: $EMAIL"
echo "type:    $TYPE"
case "$EMAIL" in
  firebase-adminsdk*)
    echo "NOTE: this is a Firebase admin key. Firebase and Play are different"
    echo "      products; a Firebase key is not a Play publisher credential"
    echo "      unless this same account was invited in the Play Console." ;;
esac

PEM=$(mktemp); trap 'rm -f "$PEM"' EXIT
python3 -c "import json;open('$PEM','w').write(json.load(open('$KEY'))['private_key'])"

b64() { openssl base64 -e -A | tr '+/' '-_' | tr -d '='; }
NOW=$(date +%s); EXP=$((NOW + 3600))
HDR=$(printf '{"alg":"RS256","typ":"JWT"}' | b64)
CLAIM=$(printf '{"iss":"%s","scope":"https://www.googleapis.com/auth/androidpublisher","aud":"https://oauth2.googleapis.com/token","exp":%s,"iat":%s}' "$EMAIL" "$EXP" "$NOW" | b64)
SIG=$(printf '%s.%s' "$HDR" "$CLAIM" | openssl dgst -sha256 -sign "$PEM" | b64)

TOKEN=$(curl -s --max-time 30 -X POST https://oauth2.googleapis.com/token \
  -d grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer \
  -d assertion="$HDR.$CLAIM.$SIG" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))")

if [ -z "$TOKEN" ]; then
  echo "FAIL: could not mint an OAuth token. The key itself is bad or revoked."
  exit 1
fi
echo "token:   minted"

BODY=$(mktemp); trap 'rm -f "$PEM" "$BODY"' EXIT
CODE=$(curl -s --max-time 30 -o "$BODY" -w "%{http_code}" -X POST -H "Content-Length: 0" \
  -H "Authorization: Bearer $TOKEN" \
  "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/$PKG/edits")

echo "play:    HTTP $CODE for $PKG"
if [ "$CODE" = "200" ]; then
  EDIT=$(python3 -c "import sys,json;print(json.load(open('$BODY')).get('id',''))")
  echo "PASS: an edit opened (id $EDIT). eas submit can authenticate."
  # Leave no dangling edit behind.
  curl -s -o /dev/null -X DELETE -H "Authorization: Bearer $TOKEN" \
    "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/$PKG/edits/$EDIT"
  exit 0
fi

echo "FAIL: Play refused. Response:"
head -c 400 "$BODY"; echo
echo
echo "Fix, in this order:"
echo "  1. Confirm the app record $PKG exists in the Play Console under"
echo "     developer 8696807675061268676 (account /u/3)."
echo "  2. Play Console, Users and permissions, invite $EMAIL"
echo "     with BOTH 'Edit and delete draft apps' AND 'Manage store presence'."
echo "  3. Re run this script. Do not spend a build until it prints PASS."
exit 1
