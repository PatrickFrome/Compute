#!/usr/bin/env bash
# smoke.sh — quick health check of the local Pigsty cluster.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
. "$HERE/bin/env.sh"
DB="host=$PGHOST port=$PGPORT user=$PGUSER dbname=$PGDATABASE"
FAIL=0
chk () { # <label> <expected-substring> <sql>
  local got
  got="$(psql "$DB" -X -Atc "$3" 2>&1 | tr -d '\n')"
  if [[ "$got" == *"$2"* ]]; then
    echo "PASS  $1 ($got)"
  else
    echo "FAIL  $1 — expected '$2', got '$got'"; FAIL=1
  fi
}
chk "server version"      "PostgreSQL 17"              "select version()"
chk "wal_level logical"   "logical"                     "show wal_level"
chk "cron bgworkers"      "on"                          "show cron.use_background_workers"
chk "pgmq installed"      "pgmq"                        "select extname from pg_extension where extname='pgmq'"
chk "pg_net installed"    "pg_net"                      "select extname from pg_extension where extname='pg_net'"
chk "vault installed"     "supabase_vault"              "select extname from pg_extension where extname='supabase_vault'"
chk "pg_cron installed"   "pg_cron"                     "select extname from pg_extension where extname='pg_cron'"
chk "publication"         "supabase_realtime"           "select pubname from pg_publication"
chk "storage objects"     "1831"                        "select count(*) from storage.objects"
chk "auth users present"  "1"                           "select count(*) from auth.users"
chk "fabric cron jobs"    "5"                           "select count(*) from cron.job"
chk "recent cron ok"      "succeeded"                   "select status from cron.job_run_details order by runid desc limit 1"
chk "user tables"         "250"                         "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema') and schemaname not like 'pg_%'"
exit $FAIL
