# Existing restored PostgreSQL provider

`restored-client-provider.mjs` is an explicit operator tool run from a reviewed
checkout. The installed Browser does not run it on first launch, and it is not
a runtime startup bundle entry. The operator supplies a private runtime-host
configuration and selects `LOCAL_POSTGRES` with the action
`USE_EXISTING_RESTORED_POSTGRES_17`.

`provisionRestoredClientProvider` requires the existing private state and PGDATA
paths, `privateConfigFile`, the immutable `bundleDirectory` and
`expectedBundleDigest`, an explicit `appDataDirectory` and its expected
`ownerFile`, plus `restoreReceiptFile` and `expectedRestoreReceiptSha256`.
`expectedDumpSha256` provides an additional independent archive pin. The
private configuration must use `compute.runtime-host-config.v1`; credentials
are read from that file and never passed through command arguments or returned
in the result.

The tool checks canonical local paths and physical boundaries, a PostgreSQL 17
control file, the existing protected Vault key, and the absence of a postmaster
PID file. It verifies the full pinned offline bundle, starts its managed host,
checks the current READY status and instance UUID, verifies the restricted API
login and service-role membership, all 40 permitted RPC grants, all five table
grants and the permitted enrollment INSERT columns, then independently fetches
the Supervisor health response. It stops the candidate and requires confirmed
cleanup, unchanged private configuration, unchanged Vault key and unchanged
restore receipt before reverifying the bundle and exclusively publishing the
durable owner descriptor. The next Browser startup starts the pinned host and
checks its new identity and health again.

No initialization, restore, DDL, grant changes, key generation, stale PID removal
or owner replacement is implemented. A missing key, an existing postmaster
file, a failed probe, uncertain cleanup or an existing owner blocks publication.
Inspect and qualify an existing cluster separately. For a stopped full-cluster
copy, retain its protected Vault key and independent source/copy evidence; do
not remove stale state from the original directory as part of provisioning.

The pinned restore report must use `metaengine.database-restore-report.v1`,
declare verified data and schema, have no recorded errors and bind a dump
SHA256. Declared provider/collation adaptations remain visible through
`source_schema_exact=false`. Pinning this report proves which prior restore
claim the operator selected; it does not bind an arbitrary PGDATA path to that
restore or prove the current contents still equal every source row. Preserve
an independently verified full-cluster copy receipt or run a separate private
row-digest comparison when that stronger evidence is required. The public
result reports `source_restore_receipt_verified` and
`existing_restored_database_selected`; it contains no connection URLs, private
paths, passwords, keys or row values.

Targeted contract checks: `node --test infra/client-state-runtime/restored-client-provider.test.mjs`. They exercise
publication order, failure cleanup, private input changes, source pins,
canonical paths and concurrent owner preservation. Real PostgreSQL/managed-host
qualification requires the separately selected private restored cluster.
