#!/usr/bin/env bash
# 02-build-extensions.sh — build the Supabase-bundled extensions that are NOT
# in the Debian archive: pgmq, pg_net, supabase_vault.
# (pg_cron and wal2json come from apt as postgresql-17-cron / -wal2json.)
#
# Requires: build-essential present (or gcc/make), network to fetch sources.
set -euo pipefail
PIGSTY_ROOT="${PIGSTY_ROOT:-/home/z/my-project/pigsty}"
PGROOT="$PIGSTY_ROOT/rootless/pgroot"
PG_CONFIG="$PGROOT/usr/lib/postgresql/17/bin/pg_config"
SRCDIR="$PIGSTY_ROOT/src"
mkdir -p "$SRCDIR"

fetch_zip () { # <owner/repo> <outfile>
  curl -sL "https://github.com/$1/archive/refs/heads/main.zip" -o "$2"
}

echo "== [1/3] pgmq =="
[ -d "$SRCDIR/pgmq" ] || { curl -sL https://github.com/pgmq/pgmq/releases/latest/download/pgmq-release.zip -o "$SRCDIR/pgmq-release.zip"; unzip -q "$SRCDIR/pgmq-release.zip" -d "$SRCDIR/pgmq"; }
make -C "$SRCDIR/pgmq" PG_CONFIG="$PG_CONFIG" install

echo "== [2/3] pg_net =="
[ -d "$SRCDIR/pg_net" ] || fetch_zip supabase/pg_net "$SRCDIR/pg_net.zip" && { [ -d "$SRCDIR/pg_net" ] || unzip -q "$SRCDIR/pg_net.zip" -d "$SRCDIR"; }
make -C "$SRCDIR/pg_net" PG_CONFIG="$PG_CONFIG" install

echo "== [3/3] supabase_vault =="
[ -d "$SRCDIR/supabase_vault" ] || fetch_zip supabase/supabase "$SRCDIR/supabase_vault.zip" || true
if [ -d "$SRCDIR/supabase_vault" ]; then
  make -C "$SRCDIR/supabase_vault" PG_CONFIG="$PG_CONFIG" install
else
  echo "supabase_vault source layout differs upstream — clone supabase/supabase and build 'vault' extension; the sandbox used the packaged sources under $SRCDIR"
fi

echo "== enable (after restore or on a fresh db) =="
echo "psql -c \"CREATE EXTENSION pgmq; CREATE EXTENSION pg_net; CREATE EXTENSION supabase_vault;\""
echo "pg_cron: shared_preload_libraries (already in pigsty-tuning.conf) + CREATE EXTENSION pg_cron;"
echo "  jobs must be scheduled from cron.database_name (postgres)."
