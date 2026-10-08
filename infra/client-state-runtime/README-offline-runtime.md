# Reviewed offline runtime resources

`offline-runtime-bundle.mjs` stages a deterministic Windows x64 resource tree
with the reviewed source closure, Node 24, Deno 2, PostgreSQL 17 `bin/lib/share`,
the locked `postgres@3.4.7` npm cache and component licenses. Inputs have recorded
download origins and archive digests. Recorded origins do not attest publisher
signatures or qualify the distribution for another machine.

The public build API is `captureRuntimeBuildInventory` followed by
`stageRuntimeSourceBundle`, with `includeRuntimeHost: true`. The resulting source
bundle feeds `captureOfflineRuntimeInventory`, `stageOfflineRuntimeBundle` and
`verifyOfflineRuntimeBundle`. Inventory and bundle digests must be supplied
explicitly. Verification rejects byte drift, extra files, aliases, hardlinks,
private paths and a missing source/runtime binding. A fresh frozen exact-version
Deno cache may omit `registry.json`; registry metadata is copied only when it
exists and is recorded in the inventory.

The executable entry is `source/infra/client-state-runtime/runtime-host.mjs`.
Launch it with the bundle's `runtime/node/node.exe`, and pass a canonical private
JSON configuration path only through `COMPUTE_RUNTIME_HOST_CONFIG`. The complete
configuration contract is `validateRuntimeHostConfig` in `runtime-host.mjs`.
The state directory, restored PostgreSQL 17 cluster and configuration must be
outside both the checkout and resource bundle. The cluster must already have
its vault key and required schema/grants; this host does not restore a database
or initialize a replacement key.

At startup the host verifies its bundle and its own executable/module paths,
copies only the pinned Deno dependency bytes into the private state's writable
`deno-cache`, and holds one exclusive ownership file. The launcher independently
checks the selected source/dependency/binary file digest, including the runtime
host's import closure, before spawning PostgreSQL, API and Deno. Resources stay
unchanged while Deno writes generated cache files to the private directory.

Readiness is a public nine-field `compute.runtime-host-provider.v1` IPC
descriptor, bound to the status file and attested service instance. The parent
sends `{schema:'compute.runtime-host-control.v1', command:'stop'}` to stop owned
children. A confirmed stop closes all three ports, records STOPPED and releases
ownership. An unconfirmed stop retains the ownership file and FAILED status;
startup never adopts or kills a process based on a stale PID alone.

`npm test` includes host, offline bundle and source-binding contracts.
`bundled-host.integration.test.mjs` additionally exercises two complete bundled
host startup/stop cycles against the schema-only fixture described in
`README-goal-verification.md`. Alongside its explicit backup/digest/runtime
settings, set `LOCAL_STATE_TEST_OFFLINE_BUNDLE_DIRECTORY` and
`LOCAL_STATE_TEST_OFFLINE_BUNDLE_SHA256`. Supply a separate writable
`LOCAL_STATE_TEST_DENO_DIR` for fixture preparation; never point it at the
immutable bundle cache. The test checks exact IPC/status identity, service
attestation, fresh child PIDs and instance ID, preserved vault key, closed ports,
released ownership and unchanged resource bytes after restart. This evidence
qualifies a disposable schema fixture, not an installed Electron profile,
production database, complete user-goal execution or operating-system network
disconnection.

## Physical first-run cold-restart evidence

The opt-in Windows NSIS package producer now tests **the real bundled PostgreSQL 17 postmaster** after independently verified fresh initdb and local Vault setup. The isolated CI test pins the offline bundle SHA256, generates its own SCRAM credentials, binds only loopback, writes one synthetic row into its own newly initialized database, stops its exact postmaster via PID+PGDATA+port identity, checks the port is closed, cold-restarts it, and checks exact persisted row bytes and unchanged private Vault key. It expressly verifies the clean cluster has **no Browser schema** (no device table) and refuses a second initdb. A failed/unknown shutdown prevents synthetic PGDATA deletion. This test does NOT provision service_role, the 40 RPC functions, Browser owner, API or agent execution; no installed user database or external Supabase is involved.
