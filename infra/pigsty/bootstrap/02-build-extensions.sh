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

# GitHub zipballs (and some release zips) extract into a single top-level
# subdirectory named after the ref: pg_net-main/, pgmq-0.35.0/, <sha>/ — the
# layout is NOT stable, so resolve the actual source dir after extraction
# instead of assuming a fixed path.
resolve_srcdir () { # <extract_root> <label> — prints the source dir, fails fast
  local root="$1" label="$2" dirs count
  if [ ! -d "$root" ]; then
    echo "ERROR: $label: extract root $root does not exist" >&2
    return 1
  fi
  dirs=$(find "$root" -mindepth 1 -maxdepth 1 -type d | sort)
  if [ -z "$dirs" ]; then
    # flat layout: sources extracted directly into the root
    if [ -f "$root/Makefile" ]; then
      printf '%s\n' "$root"
      return 0
    fi
    echo "ERROR: $label: no extracted source directory (and no Makefile) found under $root" >&2
    return 1
  fi
  count=$(printf '%s\n' "$dirs" | wc -l)
  if [ "$count" -gt 1 ]; then
    echo "ERROR: $label: ambiguous extraction layout under $root ($count top-level dirs):" >&2
    printf '%s\n' "$dirs" | sed 's/^/  /' >&2
    return 1
  fi
  printf '%s\n' "$dirs"
}

echo "== [1/3] pgmq =="
if [ ! -d "$SRCDIR/pgmq" ]; then
  curl -sL https://github.com/pgmq/pgmq/releases/latest/download/pgmq-release.zip -o "$SRCDIR/pgmq-release.zip"
  unzip -q "$SRCDIR/pgmq-release.zip" -d "$SRCDIR/pgmq"
fi
PGMQ_SRC="$(resolve_srcdir "$SRCDIR/pgmq" pgmq)"
make -C "$PGMQ_SRC" PG_CONFIG="$PG_CONFIG" install

echo "== [2/3] pg_net =="
if [ ! -d "$SRCDIR/pg_net" ]; then
  fetch_zip supabase/pg_net "$SRCDIR/pg_net.zip"
  unzip -q "$SRCDIR/pg_net.zip" -d "$SRCDIR/pg_net"
fi
PGNET_SRC="$(resolve_srcdir "$SRCDIR/pg_net" pg_net)"
make -C "$PGNET_SRC" PG_CONFIG="$PG_CONFIG" install

echo "== [3/3] supabase_vault =="
VAULT_NOTE="supabase_vault source layout differs upstream — clone supabase/vault and build 'vault' extension; the sandbox used the packaged sources under $SRCDIR"
if [ ! -d "$SRCDIR/supabase_vault" ]; then
  fetch_zip supabase/supabase "$SRCDIR/supabase_vault.zip" || true
fi
if [ -f "$SRCDIR/supabase_vault.zip" ] && [ ! -d "$SRCDIR/supabase_vault" ]; then
  unzip -q "$SRCDIR/supabase_vault.zip" -d "$SRCDIR/supabase_vault" 2>/dev/null || true
fi
if [ -d "$SRCDIR/supabase_vault" ]; then
  if VAULT_SRC="$(resolve_srcdir "$SRCDIR/supabase_vault" supabase_vault)" && [ -f "$VAULT_SRC/Makefile" ]; then
    make -C "$VAULT_SRC" PG_CONFIG="$PG_CONFIG" install
  else
    echo "$VAULT_NOTE"
  fi
else
  echo "$VAULT_NOTE"
fi

echo "== enable (after restore or on a fresh db) =="
echo "psql -c \"CREATE EXTENSION pgmq; CREATE EXTENSION pg_net; CREATE EXTENSION supabase_vault;\""
echo "pg_cron: shared_preload_libraries (already in pigsty-tuning.conf) + CREATE EXTENSION pg_cron;"
echo "  jobs must be scheduled from cron.database_name (postgres)."
