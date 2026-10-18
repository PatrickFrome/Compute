# Source this to get a psql environment against the local Pigsty cluster.
export PIGSTY_ROOT="${PIGSTY_ROOT:-/home/z/my-project/pigsty}"

# Resolve the PostgreSQL 17 client binary directory. Priority:
#   1. explicit $PGCLIENTBIN override (must contain psql)
#   2. the rootless pgroot extracted by 01-bootstrap-rootless-pg17.sh
#   3. the standard PGDG/RHEL paths (/usr/pgsql-17/bin, /usr/lib/postgresql/17/bin)
#   4. whatever `command -v psql` finds on PATH
_pigsty_find_psql_bin () {
  local cand
  if [ -n "${PGCLIENTBIN:-}" ]; then
    if [ -x "$PGCLIENTBIN/psql" ]; then
      printf '%s\n' "$PGCLIENTBIN"
      return 0
    fi
    echo "env.sh: PGCLIENTBIN=$PGCLIENTBIN is set but $PGCLIENTBIN/psql is missing" >&2
    return 1
  fi
  for cand in \
    "$PIGSTY_ROOT/rootless/pgroot/usr/lib/postgresql/17/bin" \
    "/usr/pgsql-17/bin" \
    "/usr/lib/postgresql/17/bin"; do
    [ -x "$cand/psql" ] && { printf '%s\n' "$cand"; return 0; }
  done
  cand="$(command -v psql 2>/dev/null || true)"
  if [ -n "$cand" ]; then
    printf '%s\n' "$(dirname "$cand")"
    return 0
  fi
  return 1
}

if ! PGCLIENTBIN="$(_pigsty_find_psql_bin)"; then
  echo "env.sh: no PostgreSQL client found. Install postgresql-client-17, run bootstrap/01-bootstrap-rootless-pg17.sh, or set PGCLIENTBIN to the psql binary directory." >&2
  exit 1
fi
export PGCLIENTBIN
export PATH="$PGCLIENTBIN:$PATH"
export PGHOST="$PIGSTY_ROOT/rootless/run"
export PGPORT=55432
export PGUSER=postgres
export PGDATABASE=postgres
