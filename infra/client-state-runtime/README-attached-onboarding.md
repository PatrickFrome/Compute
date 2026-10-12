# Existing local PostgreSQL onboarding

`attached-postgres-onboarding.mjs` configures a running PostgreSQL 17 cluster for
the client runtime without starting, stopping, initializing, restoring or
rewriting PGDATA. It requires the existing `client-vault.key`, `PG_VERSION`,
`global/pg_control` and `postmaster.pid`. The client state directory must be
physically separate from PGDATA, the reviewed bundle and the repository.
Symlinks, junction ancestors, hardlinked private inputs, existing runtime config
and existing runtime/setup ownership locks reject admission.

The operation binds the server to the owner's expected `pg_control_system()`
system identifier, exact postmaster startup timestamp, data directory, port and
database. It requires a separate local administrative login with migration
capabilities. This credential remains in `inspect_database_url` for the host's
read-only server identity checks; the runtime API and edge subprocesses receive
the new restricted login in `database_url` only.

The private options contract is:

```json
{
  "ownerAction": "ONBOARD_EXISTING_LOCAL_POSTGRES_17",
  "bundleDirectory": "C:/Private/ReviewedRuntimeBundle",
  "expectedBundleDigest": "<reviewed offline bundle sha256>",
  "stateDirectory": "C:/Private/METAENGINE-runtime",
  "pgDataDirectory": "C:/Private/Keeper-PG17",
  "runtimeConfigFile": "C:/Private/METAENGINE-runtime/attached-runtime.json",
  "adminDatabaseUrl": "postgresql://keeper_admin:<private-admin-password>@127.0.0.1:5432/postgres",
  "apiLogin": "metaengine_local_api",
  "apiPassword": "<a distinct private random password of at least 32 characters>",
  "expectedClusterSystemIdentifier": "<owner-confirmed pg_control_system system identifier>",
  "expectedPostmasterStartedAt": "<owner-confirmed ISO timestamp, including microseconds when present>",
  "expectedMigrationSourcesSha256": "<reviewed migration plan source_manifest_sha256>",
  "apiPort": 15432,
  "edgePort": 15433,
  "startupTimeoutMs": 60000
}
```

Place this file outside the repository, bundle, state directory and PGDATA.
On Windows, grant access only to the current owner, SYSTEM and optionally local
administrators; on other platforms use mode `0600`. CLI admission checks these
permissions before reading credentials. `secureAttachedPrivateFile(file)` is
available for a caller creating an empty private options file before filling it.
Do not paste credentials into command arguments or checked-in examples.

```powershell
node infra/client-state-runtime/attached-postgres-onboarding.mjs --options-file C:/Private/OwnerCredentials/onboarding.json
```

Read-only SQL to obtain the expected running server identity using the trusted
administrator connection:

```sql
SELECT (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS system_identifier,
       pg_catalog.to_char(pg_postmaster_start_time() AT TIME ZONE 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at,
       current_setting('data_directory') AS data_directory,
       host(inet_server_addr()) AS address, inet_server_port() AS port;
```

`loadLocalRuntimeMigrationPlan()` returns the reviewed migration source digest.
The source pin verifies the SQL files selected for installation, and does not
attest the bodies of functions already installed. Missing or partial migration
groups fail closed according to the migration module's catalog contract.

Onboarding runs migration application and creation of a new restricted login in
one database transaction, then connects independently with the new credentials.
The login is `NOINHERIT`, has no role memberships and receives direct RPC and
column grants. It does not receive permission to set `service_role`. Existing
`service_role` grants are not broadened by API login provisioning. The migration
SQL can retain its existing grants to shared roles. Role-specific RLS policies
allow the exposed relation operations; no RLS bypass flag is assigned.

The independent probe verifies all 50 RPC names, direct EXECUTE ACLs, the five
table contracts and direct SELECT/INSERT column ACLs. It rejects elevated role
flags, role memberships, database CREATE and UPDATE/DELETE/TRUNCATE/TRIGGER on
the exposed tables. An existing restrictive RLS policy applying to PUBLIC or
the login for an exposed operation requires review before config publication,
because permissive login policies cannot override it.
PostgreSQL PUBLIC grants may still grant access elsewhere;
the receipt explicitly does not attest an exact SQL privilege allowlist for the
whole database. Application rows and authority effects are not exercised by the
catalog/grant probe.

Standard PostgreSQL statement and parameter logging is disabled locally in the
provisioning transaction; an active `pgaudit.log` configuration rejects setup for
review. Driver notices and debug logging are suppressed. CLI output contains
only a sanitized receipt or fixed error code, never credentials or raw database
diagnostics. A new runtime config is staged with private ACL before credentials
are written, synced and atomically published without replacing another file.

Setup and the runtime host share `runtime-host-lock.json` for exclusive
ownership of the same state directory. This lock does not exclude another
attached runtime using a different state directory against the same Keeper
cluster. Database transaction and migration advisory locking handle installer
serialization; the state lock is not a cluster ownership claim.
A failed setup after any possible database effect retains the lock
and private state for operator review. It does not drop roles, rotate passwords,
retry migrations, delete partial state or infer ownership from a PID. A failed
independent reconnect or config publication can occur after the transaction has
committed; the retained lock signals this unresolved state. Successful setup
removes its own verified lock.

The return state is `CONFIGURED_UNQUALIFIED`: runtime health, durable owner
profile publication and installed socket/UI smoke remain separate checks.
The generated config selects `postgres_mode: "attached"` and
`api_role_mode: "direct"`, and preserves `expected_cluster_system_identifier`
for every later host connection. The expected postmaster startup timestamp is
used only for setup; an intentional Keeper restart remains possible, and the
host verifies its current server incarnation. The existing restored-provider flow can perform its
candidate host/health/cleanup verification before publishing a client owner.

Targeted checks:

```powershell
node --test infra/client-state-runtime/attached-postgres-onboarding.test.mjs
```

The tests use temporary filesystem fixtures and an injected database driver;
they never modify the live Keeper database. Windows credential-file ACL and CLI
failure-output tests use real local PowerShell/.NET ACL handling.

The public synthetic migration/grants fixture needs no schema archive and can
run in CI with PostgreSQL 17:

```powershell
$env:LOCAL_STATE_TEST_PROJECT_PG_BIN_DIR = 'C:/Tools/PostgreSQL/17/bin'
npm --prefix infra/client-state-runtime run test:attached-onboarding
```

This check applies the checked-in managed-project/continuity migrations and
exercises their restricted direct grants. The remaining baseline RPC bodies are
synthetic. To additionally exercise actual bundle admission and full onboarding,
set `LOCAL_STATE_TEST_ATTACHED_BUNDLE_DIRECTORY` and
`LOCAL_STATE_TEST_ATTACHED_BUNDLE_SHA256`; PostgreSQL then comes from that
verified bundle. If `LOCAL_STATE_TEST_PROJECT_PG_BIN_DIR` is also set, it must
resolve to the same bundled PostgreSQL directory.

The physical bundled check is opt-in and requires all four pinned fixture inputs:

```powershell
$env:LOCAL_STATE_TEST_ATTACHED_BUNDLE_DIRECTORY = 'C:/Private/ReviewedRuntimeBundle'
$env:LOCAL_STATE_TEST_ATTACHED_BUNDLE_SHA256 = '<reviewed bundle sha256>'
$env:LOCAL_STATE_TEST_ATTACHED_SCHEMA_DUMP = 'C:/Private/Fixtures/schema-source.dump'
$env:LOCAL_STATE_TEST_ATTACHED_SCHEMA_DUMP_SHA256 = '<reviewed fixture archive sha256>'
node --test infra/client-state-runtime/attached-bundled-runtime.integration.test.mjs
```

With no schema archive inputs, this test skips, including public bundle-only CI
runs. Once a schema archive is selected, partial or invalid inputs fail; the
test accepts no external database connection. The fixture uses the verified bundle's PG17 tools
to initialize a temporary SCRAM cluster, restores only schema from the explicitly
pinned archive and verifies that every restored table is empty. Archive data,
sequence values, event triggers and external connectors are excluded. The
archive and bundle are rehashed after the run; no archive contents or credentials
enter the public evidence.

The test invokes the bundle's Node executable and onboarding CLI with a private
ACL-protected options file, without injection hooks or stubbed bundle admission.
It rejects a wrong cluster identifier before provisioning, independently
reconnects with the direct API login and then runs the bundled attached host
twice. Each run requires attested API/edge health, confirms that only API and
edge subprocesses are owned, checks their cleanup and verifies preservation of
the existing postmaster incarnation, PID file and Vault key. Cleanup can stop
only the test's verified synthetic postmaster; uncertain cleanup preserves the
fixture. This qualifies disposable bundled execution, while installed UI/socket
smoke and durable Owner publication remain separate checks.

For an isolated qualification of an installed candidate, point the same four
fixture pins at its exact `resources/client-state-runtime` bundle and additionally
select all of these inputs:

```powershell
$env:LOCAL_STATE_TEST_ATTACHED_INSTALL_ROOT = 'C:/Private/InstalledCandidate'
$env:LOCAL_STATE_TEST_ATTACHED_INSTALL_SOURCE_HEAD = '<exact 40-character source commit>'
$env:LOCAL_STATE_TEST_ATTACHED_INSTALL_VERSION = '<exact installed package version>'
$env:LOCAL_STATE_TEST_ATTACHED_INSTALL_EVIDENCE_DIRECTORY = 'C:/Private/QualificationEvidence'
node --test infra/client-state-runtime/attached-bundled-runtime.integration.test.mjs
```

The evidence directory must already exist. Partial candidate inputs fail rather
than skipping. The test creates an explicit disposable Owner fixture marker,
records the successful empty-schema restore and invokes the installed bundle's
real restored-provider CLI. Candidate runtime health, direct-role grants and
confirmed cleanup precede exclusive durable Owner publication in the isolated
profile. The installed launch qualifier then verifies source commit, version,
ASAR/source bytes, protected runtime bundle, visible first-run window and real
Owner UI boot. Its normal Owner run verifies API/edge health, OS listener
ownership, a second instance and Sentinel survival beyond startup grace.

On successful installed shutdown, the test requires the runtime STOPPED
receipt, released ownership lock, closed runtime ports and the unchanged
external postmaster and Vault key. An interrupted or unconfirmed candidate
cleanup preserves the private synthetic fixture and postmaster for explicit
review; it does not claim success or kill a process by an inferred PID. This
installed check still restores no archive rows and does not qualify an existing
production profile or publish a release.
