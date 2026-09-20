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
#   - pg_restore/psql warnings about roles and existing extensions are
#     EXPECTED on a stock stack; data restores are unaffected.
set -euo pipefail
SOURCE="${1:?usage: 03-restore-supabase-backup.sh <dump-or-sql> [manifest.json]}"
MANIFEST="${2:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT/bin/env.sh"
DB="host=$PGHOST port=$PGPORT user=$PGUSER dbname=$PGDATABASE"

echo "== [1/5] pre-create extensions =="
psql "$DB" -v ON_ERROR_STOP=0 <<'SQL' || true
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
[ -f "$ROLES" ] && psql "$DB" -v ON_ERROR_STOP=0 -f "$ROLES" || true

echo "== [3/5] restore =="
case "$SOURCE" in
  *.dump) pg_restore "$DB" --no-owner --no-privileges --if-exists -j 4 "$SOURCE" 2> "$HERE/restore-errors.log" || true ;;
  *.sql)  psql "$DB" -v ON_ERROR_STOP=0 -q -f "$SOURCE" 2> "$HERE/restore-errors.log" || true ;;
  *) echo "unknown source type: $SOURCE (want .dump or .sql)" >&2; exit 2 ;;
esac

echo "== [4/5] post-restore fixes (learned live 2026-09-20) =="
# 4a. wal_level=logical so supabase_realtime publication is publishable
psql "$DB" -c "ALTER SYSTEM SET wal_level = 'logical'" || true
# 4b. pgmq >= 1.5 renamed function signatures; rebind the dumped REVOKE ACLs
psql "$DB" <<'SQL' || true
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

echo "== [5/5] restart (apply wal_level) + verify =="
"$ROOT/bin/pg-restart"
for i in $(seq 1 30); do psql "$DB" -Atc "select 1" >/dev/null 2>&1 && break; sleep 1; done
if [ -n "$MANIFEST" ]; then
  python3 "$HERE/04-verify-restore.py" "$MANIFEST" "$DB"
else
  echo "restore done. Full diff: python3 $HERE/04-verify-restore.py <manifest.json> \"$DB\""
  psql "$DB" -c "select count(*) as supervisor_commands from public.compute_fabric_a2_browser_supervisor_command_h205f22;"
fi
