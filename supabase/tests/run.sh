#!/usr/bin/env bash
# Runs schema.sql + the behaviour tests against a throwaway database on a local
# Postgres (16+). Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=mrtodo_test_$$
psql -qX -c "create database $DB" >/dev/null
trap 'psql -qX -c "drop database if exists $DB" >/dev/null' EXIT
psql -qX -d "$DB" -f supabase_stubs.sql >/dev/null 2>&1 || true   # roles may already exist
psql -qX -v ON_ERROR_STOP=1 -d "$DB" -f ../schema.sql >/dev/null 2>&1
psql -qX -v ON_ERROR_STOP=1 -d "$DB" -f ../schema.sql >/dev/null 2>&1   # must be re-runnable
psql -qXAt -v ON_ERROR_STOP=1 -d "$DB" -f security_and_flow.sql | grep -v '^$'
