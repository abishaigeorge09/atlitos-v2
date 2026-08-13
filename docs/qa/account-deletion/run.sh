#!/bin/bash
# Replays the ENTIRE Atlitos migration history into a scratch Postgres and runs
# the account deletion proof suite against it. Never touches a hosted project.
#
# Why this exists: `supabase start` needs Docker, which was not installed on the
# build machine, and the production write gate forbids testing deletion against
# syzzfgaudpifwvbpycyi. This runs the real migrations against a real Postgres
# with the Supabase-specific schemas stubbed in 00-supabase-shim.sql.
#
#   bash docs/qa/account-deletion/run.sh
#
# Requires Homebrew postgresql@17 (or any PG16+). Two migrations need local
# edits that are made in a scratch copy, never in the repo:
#   - 0027 has stray `</content>` / `</invoke>` lines committed into it and does
#     not parse at all. See BUG-P6-01 in docs/qa/BUG-LEDGER.md.
#   - 0038 creates the pg_cron extension, which is not installable here; the
#     shim provides a cron schema that records schedules instead.

set -u

BIN="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
PORT="${PG_PORT:-55432}"
DATA="${PG_DATA:-/tmp/atl_pg}"
SOCK=/tmp
DB=atl
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
STAGE=/tmp/atl_migs_run

if [ ! -x "$BIN/psql" ]; then
  echo "postgres not found at $BIN. Set PG_BIN."
  exit 1
fi

# --- cluster ---------------------------------------------------------------
if [ ! -d "$DATA" ]; then
  "$BIN/initdb" -D "$DATA" -U postgres --auth=trust > /dev/null || exit 1
fi
"$BIN/pg_isready" -h "$SOCK" -p "$PORT" > /dev/null 2>&1 || \
  "$BIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $SOCK" -l /tmp/atl_pg.log start > /dev/null

for _ in $(seq 1 20); do
  "$BIN/pg_isready" -h "$SOCK" -p "$PORT" > /dev/null 2>&1 && break
  sleep 1
done

PSQL_ADMIN="$BIN/psql -h $SOCK -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
PSQL="$BIN/psql -h $SOCK -p $PORT -U postgres -d $DB -v ON_ERROR_STOP=1 -q"

# Roles are cluster wide, so create them once and strip them from the per-db shim.
$PSQL_ADMIN -c "do \$\$ begin
  create role anon nologin noinherit;             exception when duplicate_object then null; end \$\$;" > /dev/null 2>&1
for r in authenticated service_role authenticator supabase_auth_admin supabase_storage_admin supabase_realtime_admin dashboard_user supabase_admin; do
  $PSQL_ADMIN -c "create role $r" > /dev/null 2>&1
done
$PSQL_ADMIN -c "alter role service_role bypassrls" > /dev/null 2>&1

# --- scratch copy of the migrations ---------------------------------------
rm -rf "$STAGE"; mkdir -p "$STAGE"
cp "$REPO"/supabase/migrations/*.sql "$STAGE"/
# BUG-P6-01: strip the committed tool-call XML so the file parses.
for f in "$STAGE"/*.sql; do
  grep -v -E '^</(content|invoke)>$' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done
# pg_cron is not installable on a plain cluster; the shim supplies cron.schedule.
sed -i '' 's|^create extension if not exists pg_cron;|-- local shim: pg_cron unavailable|' \
  "$STAGE"/0038_order_placement_and_expiry_sweep.sql 2>/dev/null || \
sed -i 's|^create extension if not exists pg_cron;|-- local shim: pg_cron unavailable|' \
  "$STAGE"/0038_order_placement_and_expiry_sweep.sql

# --- rebuild ---------------------------------------------------------------
$PSQL_ADMIN -c "drop database if exists $DB;" > /dev/null
$PSQL_ADMIN -c "create database $DB;"        > /dev/null

grep -v '^create role' "$HERE/00-supabase-shim.sql" \
  | grep -v '^grant anon, authenticated, service_role to authenticator' > /tmp/atl_shim_norole.sql
$PSQL -f /tmp/atl_shim_norole.sql > /dev/null || { echo "SHIM FAILED"; exit 1; }
$PSQL -c "create publication supabase_realtime;" > /dev/null 2>&1

# Drops the database and replays shim + every migration + the fixture, so each
# proof below starts from an identical, known state.
reset_db() {
  $PSQL_ADMIN -c "drop database if exists $DB;" > /dev/null
  $PSQL_ADMIN -c "create database $DB;"         > /dev/null
  $PSQL -f /tmp/atl_shim_norole.sql > /dev/null || { echo "SHIM FAILED"; exit 1; }
  $PSQL -c "create publication supabase_realtime;" > /dev/null 2>&1
  for f in $(ls "$STAGE"/*.sql | sort); do
    if ! out=$($PSQL -f "$f" 2>&1); then
      echo "MIGRATION FAILED: $(basename "$f")"
      echo "$out" | head -25
      exit 1
    fi
  done
  $PSQL -f "$HERE/01-fixture.sql" > /dev/null 2>&1
}

run() {
  echo
  echo "################ $1 ################"
  $BIN/psql -h "$SOCK" -p "$PORT" -U postgres -d "$DB" -f "$HERE/$1" 2>&1
}

reset_db
echo "ALL MIGRATIONS APPLIED"

# 02 is the RED proof: it destroys the fixture on purpose, so nothing may run
# after it without a reset.
run 02-red-naive-cascade.sql

reset_db
run 03-green-deletion.sql
run 04-green-other-party-reads.sql

reset_db
run 05-edge-cases.sql

reset_db
run 06-edge-groups-and-controls.sql
