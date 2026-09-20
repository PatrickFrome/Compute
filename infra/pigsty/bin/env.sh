# Source this to get a psql environment against the local Pigsty cluster.
export PIGSTY_ROOT="${PIGSTY_ROOT:-/home/z/my-project/pigsty}"
export PGCLIENTBIN="${PGCLIENTBIN:-/home/z/my-project/pg17/usr/lib/postgresql/17/bin}"
export PATH="$PGCLIENTBIN:$PATH"
export PGHOST="$PIGSTY_ROOT/rootless/run"
export PGPORT=55432
export PGUSER=postgres
export PGDATABASE=postgres
