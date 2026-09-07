#!/usr/bin/env bash
# ATLITOS v2 — scripts/verify-migrations-local.sh
#
# Applies the ENTIRE migration chain to a throwaway local Postgres and then runs
# scripts/verify-security-fixes.sql against it. No Supabase project, no
# service-role key, no Docker: the only requirement is a local postgres
# installation (brew install postgresql@17).
#
# Why this exists. Before it, nothing in the repo could execute a migration
# without the live project's credentials, so a migration could be committed and
# never parsed by anything. That is not hypothetical: this harness immediately
# caught 0027_session_transition_service_role_gate.sql ending with stray
# `</content></invoke>` tool output, which made the chain unreplayable from
# scratch while the live database, already migrated, looked fine.
#
#   ./scripts/verify-migrations-local.sh
#
# Exit 0 means every migration applied in order and every security assertion
# passed. See scripts/local-supabase-shim.sql for what is and is not simulated.
set -euo pipefail

cd "$(dirname "$0")/.."

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
export PATH="$PGBIN:$PATH"
# Homebrew postgres refuses to start under some locales ("postmaster became
# multithreaded during startup"), and C is always available.
export LC_ALL=C LANG=C

command -v initdb >/dev/null 2>&1 || {
  echo "verify-migrations-local: postgres not found. Install it (brew install postgresql@17) or set PGBIN."
  exit 1
}

PORT="${PGPORT_LOCAL:-55432}"
WORKDIR="$(mktemp -d)"
DATADIR="$WORKDIR/pgdata"
# The unix socket path has a 103 byte ceiling, which a mktemp dir under
# /var/folders can exceed. Keep it short and out of the data directory.
SOCKDIR="$(mktemp -d /tmp/atlpg.XXXXXX)"

cleanup() {
  pg_ctl -D "$DATADIR" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORKDIR" "$SOCKDIR"
}
trap cleanup EXIT

echo "verify-migrations-local: initialising a scratch cluster..."
initdb -D "$DATADIR" -U postgres --auth=trust >/dev/null 2>&1
pg_ctl -D "$DATADIR" -o "-p $PORT -k $SOCKDIR -c listen_addresses=127.0.0.1" -l "$WORKDIR/pg.log" -w start >/dev/null 2>&1

PSQL="psql -h 127.0.0.1 -p $PORT -U postgres -d atl -v ON_ERROR_STOP=1 -q"
createdb -h 127.0.0.1 -p "$PORT" -U postgres atl

echo "verify-migrations-local: applying the platform shim..."
$PSQL -f scripts/local-supabase-shim.sql
# Realtime's publication is created by the platform, not by a migration.
$PSQL -c "create publication supabase_realtime;" >/dev/null 2>&1

echo "verify-migrations-local: applying $(ls supabase/migrations/*.sql | wc -l | tr -d ' ') migrations..."
STAGE="$WORKDIR/mig"
mkdir -p "$STAGE"
for f in supabase/migrations/*.sql; do
  # pg_cron is an extension the platform provides; cron.schedule() itself is
  # stubbed in the shim, so only the CREATE EXTENSION line has to go.
  sed -e '/create extension if not exists pg_cron/d' "$f" > "$STAGE/$(basename "$f")"
done

for f in "$STAGE"/*.sql; do
  if ! $PSQL -f "$f" > "$WORKDIR/out.log" 2>&1; then
    echo "verify-migrations-local: FAILED applying $(basename "$f")"
    head -20 "$WORKDIR/out.log"
    exit 1
  fi
done

echo "verify-migrations-local: running scripts/verify-security-fixes.sql..."
psql -h 127.0.0.1 -p "$PORT" -U postgres -d atl -v ON_ERROR_STOP=1 \
  -f scripts/verify-security-fixes.sql 2>&1 | grep -E "NOTICE:|ERROR:" | sed 's/^psql:[^ ]* //'

echo "verify-migrations-local: ok"
