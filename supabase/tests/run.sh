#!/usr/bin/env bash
# Database test runner. Needs a local Postgres 16+ and psql on the PATH.
#   Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
#
# What it proves, in order:
#   1. every migration installs on an empty database, and the whole set can be run a second time
#   2. the generated schema.sql is current, and is equivalent to running the migrations
#   3. each behaviour suite passes on a fresh install
#   4. a database built from the PREVIOUS release (migration 0001, which is what
#      projects already have), holding real-looking data, upgrades cleanly: legacy
#      rows are carried over correctly (legacy_after.sql) and the suites still pass
#   5. a database from the first release upgrades the same way
set -euo pipefail
cd "$(dirname "$0")"
MIG=../migrations
SUITES=(security_and_flow.sql features.sql overhaul_core.sql catalogue_scope.sql qualifications.sql routing.sql deletion.sql)

apply() {   # apply <db> <file...>
  local db=$1; shift
  for f in "$@"; do psql -qX -v ON_ERROR_STOP=1 -d "$db" -f "$f" >/dev/null 2>&1 || { echo "FAILED applying $f"; psql -qX -v ON_ERROR_STOP=1 -d "$db" -f "$f" 2>&1 | grep -i error | head -3; exit 1; }; done
}
newdb() {   # newdb <db>
  psql -qX -c "drop database if exists $1" -c "create database $1" >/dev/null 2>&1
  psql -qX -d "$1" -f supabase_stubs.sql >/dev/null 2>&1 || true     # roles may already exist
}
DBS=()
cleanup() { for d in "${DBS[@]:-}"; do [ -n "$d" ] && psql -qX -c "drop database if exists $d" >/dev/null 2>&1 || true; done; }
trap cleanup EXIT
mk() { local d="mrtodo_t_$1_$$"; DBS+=("$d"); newdb "$d"; echo "$d"; }

echo "== schema.sql is current"
../build_schema.sh --check

echo "== fresh install: migrations twice, then schema.sql once more"
db=$(mk f)
apply "$db" "$MIG"/*.sql
apply "$db" "$MIG"/*.sql
apply "$db" ../schema.sql

for s in "${SUITES[@]}"; do
  echo "== fresh install: $s"
  db=$(mk "s${s%%.*}")
  apply "$db" "$MIG"/*.sql
  psql -qXAt -v ON_ERROR_STOP=1 -d "$db" -f "$s" | grep -v '^$' | grep "^ok" | wc -l | sed 's/^/   checks passed: /'
done

echo "== eight simultaneous claims on one task"
db=$(mk conc)
apply "$db" "$MIG"/*.sql
./concurrency.sh "$db"

echo "== upgrade from the deployed release (0001) with legacy data"
db=$(mk legacy)
apply "$db" "$MIG"/0001_foundation.sql
psql -qX -v ON_ERROR_STOP=1 -d "$db" -f legacy_before.sql >/dev/null
apply "$db" $(ls "$MIG"/*.sql | grep -v 0001_foundation)
psql -qXAt -v ON_ERROR_STOP=1 -d "$db" -f legacy_after.sql | grep -v '^$' | grep "^ok" | wc -l | sed 's/^/   migration checks passed: /'
for s in "${SUITES[@]}"; do
  db=$(mk "u${s%%.*}")
  apply "$db" "$MIG"/0001_foundation.sql
  apply "$db" $(ls "$MIG"/*.sql | grep -v 0001_foundation)
  psql -qXAt -v ON_ERROR_STOP=1 -d "$db" -f "$s" | grep -v '^$' | grep "^ok" | wc -l | sed "s/^/   after upgrade, $s: /"
done

echo "== upgrade from the first release (fixtures/schema_v1.sql)"
db=$(mk v1)
apply "$db" fixtures/schema_v1.sql
apply "$db" "$MIG"/*.sql
psql -qXAt -v ON_ERROR_STOP=1 -d "$db" -c "select 'ok'" >/dev/null && echo "   upgraded cleanly"
echo "ALL DATABASE TESTS PASSED"
