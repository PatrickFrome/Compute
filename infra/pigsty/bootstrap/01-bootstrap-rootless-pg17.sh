#!/usr/bin/env bash
# 01-bootstrap-rootless-pg17.sh — stand up a rootless PostgreSQL 17 appliance
# from Debian packages WITHOUT root. Reproduces the sandbox deployment used
# for the 2026-09-20 Supabase evacuation.
#
# Requires: apt-get download works (network + apt lists), ~200 MB free disk.
set -euo pipefail
PIGSTY_ROOT="${PIGSTY_ROOT:-/home/z/my-project/pigsty}"
PGROOT="$PIGSTY_ROOT/rootless/pgroot"
PGDATA="$PIGSTY_ROOT/rootless/PGDATA"
HERE="$(cd "$(dirname "$0")" && pwd)"
CONF="$HERE/../conf"

mkdir -p "$PIGSTY_ROOT/debs" "$PGROOT"

echo "== [1/5] download packages (no root needed) =="
cd "$PIGSTY_ROOT/debs"
apt-get download \
  postgresql-17 postgresql-client-17 postgresql-common libpq5 \
  postgresql-17-cron postgresql-17-wal2json libsodium-dev

echo "== [2/5] extract into a user tree =="
for deb in ./*.deb; do dpkg-deb -x "$deb" "$PGROOT"; done

echo "== [3/5] initdb =="
SRVBIN="$PGROOT/usr/lib/postgresql/17/bin"
mkdir -p "$PIGSTY_ROOT/rootless/run" "$PIGSTY_ROOT/rootless/log"
LC_ALL=C.UTF-8 "$SRVBIN/initdb" -D "$PGDATA" \
  --auth-local=trust --auth-host=trust --encoding=UTF8

echo "== [4/5] install canonical conf =="
cp "$CONF/pigsty-tuning.conf" "$PGDATA/pigsty-tuning.conf"
cp "$CONF/pg_hba.conf" "$PGDATA/pg_hba.conf"
printf "\n# CUSTOMIZED OPTIONS\ninclude = 'pigsty-tuning.conf'\n" >> "$PGDATA/postgresql.conf"

echo "== [5/5] first start =="
"$HERE/../bin/pg-start"
"$HERE/../bin/pg-status"
echo "Next: 02-build-extensions.sh, then 03-restore-supabase-backup.sh"
