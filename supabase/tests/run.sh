#!/usr/bin/env bash
# Runs schema.sql and all behaviour tests against throwaway databases on a
# local Postgres (16+).
#   Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
# Checks, in order:
#   1. schema.sql installs on an empty database and can be run twice
#   2. original behaviour tests (security_and_flow.sql)
#   3. new-feature tests (features.sql)
#   4. a database built from the PREVIOUS schema (fixtures/schema_v1.sql, what
#      an existing project has) upgrades cleanly and still passes 2 and 3
set -euo pipefail
cd "$(dirname "$0")"

fresh() {  # fresh <db> [schema file to apply first]
  psql -qX -c "drop database if exists $1" -c "create database $1" >/dev/null
  psql -qX -d "$1" -f supabase_stubs.sql >/dev/null 2>&1 || true   # roles may already exist
  if [ -n "${2:-}" ]; then psql -qX -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null 2>&1; fi
  psql -qX -v ON_ERROR_STOP=1 -d "$1" -f ../schema.sql >/dev/null 2>&1
  psql -qX -v ON_ERROR_STOP=1 -d "$1" -f ../schema.sql >/dev/null 2>&1   # must be re-runnable
}
cleanup() { for d in mrtodo_t_a_$$ mrtodo_t_b_$$ mrtodo_t_c_$$; do psql -qX -c "drop database if exists $d" >/dev/null 2>&1 || true; done; }
trap cleanup EXIT

echo "== fresh install: original behaviour tests"
fresh mrtodo_t_a_$$
psql -qXAt -v ON_ERROR_STOP=1 -d mrtodo_t_a_$$ -f security_and_flow.sql | grep -v '^$' | grep "^ok"

echo "== fresh install: new-feature tests"
fresh mrtodo_t_b_$$
psql -qXAt -v ON_ERROR_STOP=1 -d mrtodo_t_b_$$ -f features.sql | grep -v '^$' | grep "^ok"

echo "== upgrade from the previous schema: both suites again"
fresh mrtodo_t_c_$$ fixtures/schema_v1.sql
psql -qXAt -v ON_ERROR_STOP=1 -d mrtodo_t_c_$$ -f security_and_flow.sql | grep -c "^ok"
fresh mrtodo_t_c_$$ fixtures/schema_v1.sql
psql -qXAt -v ON_ERROR_STOP=1 -d mrtodo_t_c_$$ -f features.sql | grep -c "^ok"
echo "ALL DATABASE TESTS PASSED"
