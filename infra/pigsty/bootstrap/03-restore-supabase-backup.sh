#!/usr/bin/env bash
# 03-restore-supabase-backup.sh — restore the evacuated Supabase database into
# the local Pigsty cluster (or any PG17 with the extensions installed).
#
# Usage:
#   ./03-restore-supabase-backup.sh <dump-or-sql> [manifest.json]
#
#   <dump-or-sql>  evacuation kit pg_dump custom format (*.dump)
#                  OR plain SQL dump (*.sql)
#   [manifest]     row-count manifest for 04-verify-restore.py (optional)
#
# Notes:
#   - Use the DIRECT connection, not a transaction pooler.
#   - Steps 1-2 (extensions, roles) are best-effort pre-creation: duplicate /
#     already-present objects are tolerated and reported as WARNING.
#   - The restore itself (step 3) is STRICT: ON_ERROR_STOP=1 / checked
#     pg_restore exit code; any restore error aborts with the tail of
#     restore-errors.log. The script exits non-zero unless the post-restore
#     verification query passes, and prints "restore done" only on verified
#     success.
set -euo pipefail
SOURCE="${1:?usage: 03-restore-supabase-backup.sh <dump-or-sql> [manifest.json]}"
MANIFEST="${2:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT/bin/env.sh"
DB="host=$PGHOST port=$PGPORT user=$PGUSER dbname=$PGDATABASE"
RESTORE_LOG="$HERE/restore-errors.log"
CANARY_TABLE="public.compute_fabric_a2_browser_supervisor_command_h205f22"

echo "== [1/5] pre-create extensions =="
psql "$DB" -v ON_ERROR_STOP=0 <<'SQL' \
  || echo "WARNING: extension pre-creation reported errors (tolerated for optional extensions; details above)" >&2
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pgmq;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;
CREATE SCHEMA IF NOT EXISTS destruktion_meta;
SQL

echo "== [2/5] roles (tolerate duplicates) =="
ROLES="${ROLES_SQL:-$HERE/roles.sql}"
if [ -f "$ROLES" ]; then
  psql "$DB" -v ON_ERROR_STOP=0 -f "$ROLES" \
    || echo "WARNING: roles.sql reported errors (duplicates tolerated; details above)" >&2
fi

echo "== [3/5] restore (strict) =="
rm -f "$RESTORE_LOG"
case "$SOURCE" in
  *.dump)
    if ! pg_restore "$DB" --no-owner --no-privileges --if-exists -j 4 "$SOURCE" 2> "$RESTORE_LOG"; then
      echo "RESTORE FAILED: pg_restore exited non-zero; last errors from $RESTORE_LOG:" >&2
      tail -n 20 "$RESTORE_LOG" >&2 || true
      exit 1
    fi
    ;;
  *.sql)
    if ! psql "$DB" -v ON_ERROR_STOP=1 -q -f "$SOURCE" 2> "$RESTORE_LOG"; then
      echo "RESTORE FAILED: psql exited non-zero (ON_ERROR_STOP=1); last errors from $RESTORE_LOG:" >&2
      tail -n 20 "$RESTORE_LOG" >&2 || true
      exit 1
    fi
    ;;
  *) echo "unknown source type: $SOURCE (want .dump or .sql)" >&2; exit 2 ;;
esac

echo "== [4/5] post-restore fixes (learned live 2026-09-20) =="
# 4a. wal_level=logical so supabase_realtime publication is publishable
if ! psql "$DB" -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET wal_level = 'logical'"; then
  echo "POST-RESTORE FIX FAILED: could not set wal_level=logical (supabase_realtime publication will not be publishable)" >&2
  exit 1
fi
# 4b. pgmq >= 1.5 renamed function signatures; rebind the dumped REVOKE ACLs
if ! psql "$DB" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='pgmq' AND p.proname IN ('create_partitioned','pop','purge_queue','create_unlogged','create_non_partitioned')
  LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.f);
      RAISE NOTICE 'revoked %', r.f;
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'skip %: %', r.f, SQLERRM; END;
  END LOOP;
END $$;
SQL
then
  echo "POST-RESTORE FIX FAILED: could not rebind pgmq REVOKE ACLs" >&2
  exit 1
fi

echo "== [5/5] restart (apply wal_level) + verify =="
"$ROOT/bin/pg-restart"
ready=0
for i in $(seq 1 30); do
  if psql "$DB" -v ON_ERROR_STOP=1 -Atc "select 1" >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "VERIFY FAILED: cluster did not accept queries after restart" >&2
  exit 1
fi

# Post-restore verification: the restored catalog must expose the expected
# schema plane, the canary table from the original restore, and (optionally)
# match the row-count manifest.
restored_tables="$(psql "$DB" -v ON_ERROR_STOP=1 -Atc \
  "select count(*) from pg_catalog.pg_tables where schemaname in ('public','destruktion_meta')")" \
  || { echo "VERIFY FAILED: could not count restored tables in schemas public/destruktion_meta" >&2; exit 1; }
if [ "${restored_tables:-0}" -lt 1 ]; then
  echo "VERIFY FAILED: 0 restored tables in schemas public/destruktion_meta — restore did not populate the catalog (see $RESTORE_LOG)" >&2
  exit 1
fi
canary_rows="$(psql "$DB" -v ON_ERROR_STOP=1 -Atc "select count(*) from $CANARY_TABLE")" \
  || { echo "VERIFY FAILED: canary table $CANARY_TABLE missing or unreadable — restore is incomplete (see $RESTORE_LOG)" >&2; exit 1; }

if [ -n "$MANIFEST" ]; then
  if ! python3 "$HERE/04-verify-restore.py" "$MANIFEST" "$DB"; then
    echo "VERIFY FAILED: manifest row-count mismatch (see report above)" >&2
    exit 1
  fi
  echo "restore done (verified: ${restored_tables} tables in public/destruktion_meta, canary ${CANARY_TABLE} rows=${canary_rows}, manifest match)."
else
  echo "restore done (verified: ${restored_tables} tables in public/destruktion_meta, canary ${CANARY_TABLE} rows=${canary_rows})."
  echo "Full diff: python3 $HERE/04-verify-restore.py <manifest.json> \"$DB\""
fi
