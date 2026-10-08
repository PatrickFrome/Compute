# Client-owned state runtime

`launcher.mjs` runs the current native supervisor with local PostgreSQL 17 and
the local `/rest/v1` API. GitHub stores source, tests and release artifacts; the
client owns the running processes and durable database. PostgreSQL functions,
device signatures, enrollment approvals, command authority and capability
attestation still govern requests.

## Configuration

Use a restored, initialized PostgreSQL 17 data directory and matching portable
PostgreSQL binaries. Keep database credentials and local data outside the Git
checkout and release archive. The launcher does not initialize, overwrite or
restore a database.

| Environment variable | Required value |
| --- | --- |
| `LOCAL_STATE_MODE` | `local` |
| `LOCAL_STATE_POSTGRES_MODE` | `owned` or `attached` |
| `LOCAL_STATE_DATABASE_URL` | `postgresql://user:password@127.0.0.1:15434/database` |
| `LOCAL_STATE_INSPECT_DATABASE_URL` | Optional administrative URL for the same loopback cluster |
| `LOCAL_STATE_PG_BIN_DIR` | Absolute PostgreSQL 17 `bin` directory |
| `LOCAL_STATE_PG_DATA_DIR` | Absolute initialized data directory |
| `LOCAL_STATE_DENO_PATH` | Absolute Deno executable path |
| `LOCAL_STATE_NODE_PATH` | Optional Node executable; defaults to current Node |
| `LOCAL_STATE_API_PORT` | Optional; defaults to `15432` |
| `LOCAL_STATE_EDGE_PORT` | Optional; defaults to `15433` |
| `LOCAL_STATE_STARTUP_TIMEOUT_MS` | Optional; defaults to `60000` |
| `LOCAL_STATE_DENO_LOCK_PATH` | Optional checked-in lock; defaults to runtime `deno.lock` |
| `LOCAL_STATE_STARTUP_MANIFEST_PATH` | Optional fresh absolute receipt outside checkout; defaults to a unique file in PGDATA |

Run `node infra/client-state-runtime/launcher.mjs` in the configured environment.
The ready event contains the local supervisor endpoint. It is safe to display
the event: passwords and the generated 256-bit API key are never included.
The API key is generated per launch and passed to owned child processes only.
Configure the browser's explicit local endpoint to the reported URL.

The API and Edge database login should use the locally provisioned `service_role`
membership. Identity inspection requires permission to read `data_directory`.
Supply a separate administrative `LOCAL_STATE_INSPECT_DATABASE_URL` when the API
login lacks that permission; the inspector URL is used only by bounded local
`psql` checks and is removed from the API and Edge child environments.

`owned` starts `postgres` directly as a child and shuts it down using `pg_ctl`
against the qualified data directory. `attached` verifies an existing local
server and leaves that server running when the launcher exits. In both modes,
the server must be PostgreSQL 17 on `127.0.0.1`; its actual data directory,
port, PID file and start time are checked. A different server is not adopted.

## Lifecycle

The launcher verifies available ports, qualifies PostgreSQL, starts the API and
waits for its authenticated database health check, then starts the current Deno
native-supervisor source. Both HTTP health responses must carry the launch's
instance ID. The Edge must also report `runtime_ready=true` and an `ATTESTED`
capability envelope from the database; HTTP liveness alone is insufficient.
Deno network permission is limited to the three loopback ports.
Its dependency graph is pinned by `deno.lock` and launched with
`--frozen-lockfile --cached-only`; a missing cached package or changed lock fails
startup. Prepare the cache during installation with
`deno cache --no-config --node-modules-dir=none --lock infra/client-state-runtime/deno.lock apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/index.ts`.
Inherited Supabase and local-state settings are replaced by the selected local
configuration; no hosted endpoint is used as a fallback.

Before child spawn and after successful health checks, the launcher hashes its
selected API/Edge source closure, relative side-effect/re-export imports, Node
and Deno PostgreSQL package files, lock files, Node/Deno binaries and qualified
PostgreSQL executables. It rejects changed bytes during startup. A fresh
`runtime-startup-<instance-id>.json` binds the stable source digest to the same
instance UUID, endpoint and owned child PIDs. The safe policy contains ports and
dependency flags, never API keys, database URLs, private configuration or
credential-derived hashes. The receipt is persisted outside the checkout with
exclusive creation; the ready event returns its path and source digest.

This provides source-at-startup evidence, not a cryptographic measurement of
loaded process memory. Dynamic PostgreSQL libraries and compiled Deno caches
are outside the file manifest; a change after readiness requires a fresh
comparison/restart to change the running candidate.

After readiness, child exits and failed health checks close the owned processes
in reverse order. SIGINT and SIGTERM request the same cleanup. No Windows service,
scheduled task, administrator action, firewall rule or security setting is
created. Keeping the client machine running is necessary for availability.

The launcher emits lifecycle JSON events, suppresses child stderr to avoid
accidental credential disclosure, and reports bounded startup failures with
codes. Inspect the individual API or Deno source during development when a
component's diagnostic detail is needed. A runtime restart uses a new instance
ID and a new API key; the PostgreSQL data persists in the configured directory.

## Verification

Run `node --test infra/client-state-runtime/launcher.test.mjs` for real child
process ownership, port collision, instance mismatch, child failure and database
incarnation fencing. These fixtures do not substitute for the independent
restored-database and current-Deno health smoke tests.

Set `LOCAL_STATE_TEST_PG_BIN_DIR` to the portable PostgreSQL 17 binaries and run
`node --test infra/client-state-runtime/launcher.pg.test.mjs` for the actual owned
database lifecycle. The test initializes a fresh temporary SCRAM-authenticated
cluster, verifies the postmaster PID, writes a row, cleanly stops and restarts
PostgreSQL, checks the row persists and removes the temporary cluster.
