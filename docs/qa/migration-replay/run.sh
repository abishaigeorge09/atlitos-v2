#!/usr/bin/env bash
# Replay the entire supabase/migrations history, in order, against a throwaway
# local Postgres cluster. Proves the history parses and applies from a clean
# checkout. Never touches any Supabase project.
#
# Usage: bash docs/qa/migration-replay/run.sh
set -euo pipefail

export PATH=/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HERE="$REPO_ROOT/docs/qa/migration-replay"
WORK="${TMPDIR:-/tmp}/atlitos-migration-replay"
PGDATA="$WORK/pgdata"
SOCKET="$WORK/sock"
DB=atlitos_replay
PORT=54329

EXTDIR="$(pg_config --sharedir)/extension"

cleanup() {
  if [ -d "$PGDATA" ]; then
    pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -f "$EXTDIR/pg_cron.control" "$EXTDIR/pg_cron--1.6.sql"
}
trap cleanup EXIT

# pg_cron is a Supabase managed extension and is not shippable into a plain
# Homebrew cluster. Install a no-op stub control file so that migration 0038's
# "create extension if not exists pg_cron" resolves. The real cron.schedule and
# cron.job_run_details shapes come from stub_supabase.sql. Both files are
# removed again by cleanup.
install_pg_cron_stub() {
  cat >"$EXTDIR/pg_cron.control" <<'CTL'
comment = 'pg_cron stub for offline migration replay, not the real extension'
default_version = '1.6'
module_pathname = ''
relocatable = false
schema = 'cron'
superuser = true
CTL
  cat >"$EXTDIR/pg_cron--1.6.sql" <<'EXT'
-- Stub. Real cron objects are created by stub_supabase.sql before this runs.
select 1;
EXT
}

rm -rf "$WORK"
mkdir -p "$PGDATA" "$SOCKET"
install_pg_cron_stub

echo "== postgres version =="
postgres --version

echo "== initdb =="
initdb -D "$PGDATA" -U postgres --encoding=UTF8 --locale=C >"$WORK/initdb.log" 2>&1

echo "== start cluster on port $PORT =="
pg_ctl -D "$PGDATA" -o "-p $PORT -k $SOCKET -c listen_addresses=''" \
  -l "$WORK/postgres.log" start >/dev/null

export PGHOST="$SOCKET" PGPORT="$PORT" PGUSER=postgres

psql -v ON_ERROR_STOP=1 -q -c "create database $DB;" postgres

PSQL=(psql -v ON_ERROR_STOP=1 -q -X -d "$DB")

echo "== apply supabase platform stubs =="
"${PSQL[@]}" -f "$HERE/stub_supabase.sql" >/dev/null

echo "== replay migrations in order =="
count=0
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  if ! "${PSQL[@]}" -f "$f" >"$WORK/last.log" 2>&1; then
    echo "FAIL $name"
    cat "$WORK/last.log"
    exit 1
  fi
  count=$((count + 1))
  printf 'ok   %s\n' "$name"
done

echo
echo "== replayed $count migrations with no error =="
"${PSQL[@]}" -c "select count(*) as public_tables from pg_tables where schemaname = 'public';"
"${PSQL[@]}" -c "select count(*) as public_functions from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';"
"${PSQL[@]}" -c "select count(*) as rls_policies from pg_policies where schemaname = 'public';"
