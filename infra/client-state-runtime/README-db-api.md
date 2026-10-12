# Local PostgreSQL API

`db-api.mjs` serves the current Native Supervisor database operations from the client's PostgreSQL instance. The supervisor keeps its existing REST and RPC request format, so its signed device authentication, enrollment approval, nonce ledger, command leasing and completion checks continue to run the restored SQL functions.

The API binds only `127.0.0.1` and rejects requests with a different Host header or any browser Origin header. Every request requires the launcher-generated `apikey`. An optional `Authorization: Bearer` header must contain the same key. The key is random local service identity, not a Supabase token or JWT.

## Interface

Authenticated `GET /health` returns `mode: LOCAL_POSTGRES`, the launcher instance ID, the availability of all currently allowlisted RPC names and five table endpoints, and the actual `devos_runtime_capabilities_v1` attestation from the database. Missing objects or unreadable tables fail readiness.

`POST /rest/v1/rpc/<name>` accepts a JSON object with the function's named arguments. Argument names and exact PostgreSQL types come from `pg_catalog.pg_proc` and `pg_type`. The adapter quotes catalog identifiers and binds values, JSON and arrays as driver parameters. Missing required arguments, extra arguments and ambiguous overloads fail before execution. Default arguments may be omitted. RPC names are explicitly listed in `db-api-core.mjs`; the adapter provides no SQL endpoint.

`GET /rest/v1/<table>` supports only the projections, filters and ordering currently used by the Native Supervisor. Values are parameters. Row counts are bounded to 128. There are five table endpoints:

- Device enrollment requests.
- Device public identity and admin grant readback.
- Remote pairing token hash lookup.
- Supervisor state.
- Supervisor commands and result receipts.

`POST` is enabled only for enrollment requests. It accepts only the current enrollment insert fields and optionally `Prefer: return=representation`. Unused PATCH, DELETE, PUT, bulk inserts, wildcard projections, arbitrary relations and other PostgREST grammar are rejected.

## Database Identity

Create a fresh dedicated login with `provisionLocalApiLogin` from `db-api-grants.mjs`, or use its command-line entry with these environment variables:

- `LOCAL_STATE_ADMIN_DATABASE_URL`: local administrator connection, used only for provisioning.
- `LOCAL_STATE_API_DB_LOGIN`: new login name, default `local_state_api`.
- `LOCAL_STATE_API_DB_PASSWORD`: generated password of at least 32 characters.

The login has no superuser, role creation, database creation, replication or RLS bypass privileges. It does not inherit `service_role` automatically. API queries explicitly enter `SET LOCAL ROLE service_role` in a transaction and set transaction-local JWT claims with `role: service_role`. Schema search path and query, lock and idle transaction timeouts are set locally. Connection role privileges are validated at startup.

Provisioning adds grants on the allowed functions and tables. Existing restored `service_role` grants are preserved because other supervisor SQL paths may use them. The HTTP surface remains explicitly restricted regardless of those grants. The supervisor's separate read-only database inspection lane may require its own read-only login; it does not automatically enter the API transaction role.

Existing running clusters use [attached onboarding](README-attached-onboarding.md)
with `roleMode: 'direct'` instead. This new login has no memberships, receives
column SELECT/INSERT and RPC EXECUTE grants directly, and uses role-specific RLS
policies. `LOCAL_STATE_API_ROLE_MODE=direct` keeps API transactions under this
login while retaining the transaction-local JWT claims required by the signed
device protocol. Provisioning leaves shared `service_role` grants unchanged;
migrations can retain their own grants. PostgreSQL PUBLIC privileges still
apply, so these grants do not attest an exact SQL allowlist for the database.

## Runtime

The launcher passes `LOCAL_STATE_DATABASE_URL`, `LOCAL_STATE_API_KEY`, `LOCAL_STATE_INSTANCE_ID`, `LOCAL_STATE_API_HOST=127.0.0.1` and `LOCAL_STATE_API_PORT` (default 15432). Database connection host must be local. The body limit is 1 MiB, including chunked requests; at most six requests are admitted simultaneously. SQL statements have a 10-second timeout and lock acquisition a 3-second timeout. Connection failures expose only a generic error.

`npm test` runs the adapter and HTTP security tests. `npm run test:integration` uses `LOCAL_STATE_TEST_DATABASE_URL` and `LOCAL_STATE_TEST_ADMIN_DATABASE_URL` to check a restored local PostgreSQL database. It creates one uniquely identified enrollment fixture and removes only that fixture, and verifies SQL/JSON parity, named JSON/array casts, transaction rollback, runtime capability parity, and table reads. Neither integration connection may point to a remote database.

`npm run test:managed-project-authority` uses only `LOCAL_STATE_TEST_PROJECT_PG_BIN_DIR`, the absolute directory containing PostgreSQL 17 `postgres`, `initdb` and `pg_ctl` binaries. It creates its own temporary loopback PostgreSQL cluster, installs the exact checked-in task/claim definitions, state normalizer, workspace binding registry and managed-project migration, then verifies device grant, current claim/task lease, fresh same-client fleet identity and trusted repository roots. It composes the route and SQL adapters with the real project host, platform storage protection, loopback bearer authentication, CLI and a real Git repository: CREATE makes one locked worktree and records DB READY and SQLite PROVEN; OPEN after host restart reuses that receipt even with a different caller key. It stops and removes only that generated cluster; it does not use an existing database URL. Other control-plane tables, environment state and the remote post-authentication device identity are synthetic fixtures, so this test does not prove the deployed supervisor's signed HTTP authentication or installed client behavior. The Windows package smoke workflow runs it against the same pinned PostgreSQL binaries staged for the offline package.

## Fresh PG17 read-only schema readiness inventory

`npm run test:project-continuity` also uses only `LOCAL_STATE_TEST_PROJECT_PG_BIN_DIR` and its own disposable PostgreSQL 17 cluster. It applies the checked-in task/claim/event/goal definitions, enqueue/lease/complete functions and project continuity migration, then exercises the signed-device route boundary with a synthetic post-authentication identity. It verifies project registration without changing the root task digest, recursive children and grandchildren, preserved budget waits and later admission, exact replay after the original lease closed, task lookup outside a paginated task list, an independent digest-bound critic for each result, guarded parent completion, a bounded device-scoped reconciliation sweep, filtered history pagination, concurrent commit-ordered cursors, rollback without a history gap, RPC grants and device revocation. `CODER` and `INTEGRATOR` proposals map to the existing fleet roles `IMPLEMENTER` and `SYNTHESIZER`. Logical READY tasks are demand for the existing fleet governor; this API allocates no physical leases and introduces no scheduler. Model text and history events keep `verified_evidence=false`; a verified database receipt reference is a separate integrity flag. The test proves database coordination with synthetic origin/result receipts, not real agent competence, remote signature verification or an installed-client useful coding task.

The source-controlled `inspectLocalApiSchemaCatalog({sql})` in db-api-core.mjs queries the local PostgreSQL catalogs under an explicitly privileged local connection. It compares the currently permitted Native Supervisor RPC names, the five allowlisted public tables and their required columns, plus `service_role` and `pgcrypto`. It never runs DDL or DML or returns private connection strings. An empty new PG17 cluster returns `BASELINE_SCHEMA_MISSING`; the physical Windows cold-restart test proves this. Even a matching catalog returns **only** `CATALOG_PRESENT_UNATTESTED` with `runtime_ready=false` and `initialization_authorized=false`: role grants, RLS, migration source hashes, function bodies and the native Supervisor's real health checks must be proved separately before the installed client may publish an owner READY profile. Never use this inventory as permission to restore, migrate or overwrite a user-owned cluster.
