# Client State Runtime

The client owns PostgreSQL, the local supervisor and private evidence. GitHub
owns source, automated checks and reviewed distribution packages, not live
transactions. The runtime uses the existing SQL functions and device-signature
protocol; it does not create a second scheduler or bypass admission.

## Components

- [Launcher](README-launcher.md): PostgreSQL process ownership, local API/Edge
  startup, database identity, capability readiness and failure cleanup.
- [Database API](README-db-api.md): the explicit Native Supervisor REST/RPC
  subset, SQL role isolation and parameterized queries.
- [Vault](README-vault.md): the declared local pgcrypto adaptation with a
  private, persistent encryption key.
- [Client provider](README-client-local-provider.md): verified loopback
  endpoint, runtime identity and normal cold-start environment.
- [Private evidence](README-evidence.md): immutable, hash-verified objects and
  source-bound receipts, without treating hashes as execution authority.
- [Backup verification](README-backup.md): original archive hashes, storage
  completeness and measured restoration, including schema caveats.
- [Runtime verification](README-verification.md): selected source-at-startup,
  instance and probe evidence without treating hashes as process attestation.

Data directories, database dumps, credentials, encryption keys and test reports
containing private state must stay outside this checkout and GitHub artifacts.
The launcher needs an already restored PostgreSQL 17 cluster. It never restores
over a running database or changes a hosted Supabase project.

## Checks

Install frozen dependencies with `npm ci --ignore-scripts --no-audit --no-fund`
and run `npm test` in this directory. The GitHub workflow runs these contracts
on Windows and Linux, plus the focused Browser provider/compatibility tests.
Integration tests require explicitly configured local PostgreSQL and supervisor
fixtures; see the component documentation. Skipped integration tests are not a
live qualification result.

## Replacement Boundary

The native client path can use its own PostgreSQL without hosted Supabase.
The provider is explicitly pinned; invalid local configuration must fail closed,
not select a hosted fallback. The installed release is not changed by editing
source or starting this runtime. Normal reviewed packaging and a cold client
restart remain necessary before claiming that a particular installation uses it.
The persistent client provisioner writes only an explicitly selected external
owner profile; the awaited startup bootstrap loads it before endpoint imports.
It does not install the server stack or silently register Windows services.

The legacy GoTrue, Storage/outbox, SQL mirror, old console and coordination
readers are separate consumers. This limited API is not a universal PostgREST,
GoTrue or Realtime implementation. Those consumers need concrete adapters or
verified exclusion from the selected profile. A local health response or unit
test alone does not establish complete project-wide replacement or autonomous
coding readiness. If the client machine is off, GitHub cannot serve its live
database transactions.

## First-run preflight boundary (successor)

`first-run-preflight.mjs` is a strictly read-only, local-only inventory step for a
reviewed future first-run provisioner. It checks canonical physical directory
separation, all existing symlink/junction ancestors, whether an owner profile,
PGDATA or private runtime config already exists, and unexpected state contents.
It never creates PGDATA, starts PostgreSQL, generates a Vault key, changes an
owner file, uses the network, or grants initialization authority.
A result of `PREPARATION_REVIEW_REQUIRED` is **not** permission to call initdb.
Existing data yields `HOLD_EXISTING_PRIVATE_STATE` and must follow a
separate owner-authorized migration/reconciliation path. Packaging must first
prove the independently pinned offline bundle; this inventory does not verify
source or publisher integrity.

## Experimental explicit fresh-PG17 initdb transaction

`fresh-pg17-initdb.mjs` is an **opt-in, separate development-stage action**, never called by normal Browser startup. It requires explicit owner action, an independently pinned fully verified offline runtime bundle, a private existing SCRAM password file, read-only first-run inventory, and an exclusive PGDATA creation lock. It invokes only the verified `initdb` with fixed SHA-256 data checksums, SCRAM and UTF8/no-locale parameters and a restricted environment. Errors retain the review lock and partial cluster; there is no destructive auto-retry or deletion. After success it proves `PG_VERSION=17`, `postgresql.conf` and `base/` and reports `PG17_INITIALIZED_UNPROVISIONED`, not runtime readiness. It does **not** grant SQL roles, apply source schema, create/recover a Vault key, publish an owner profile or launch the Browser. Synthetic unit fixtures do not count as physical PostgreSQL integration; independent real-initdb and installed-first-run qualification remain required.

## Physical PG17 qualification (Windows package producer)

After the frozen offline runtime is staged, `browser-windows-package-smoke.yml` now invokes `fresh-pg17-initdb.integration.test.mjs` using that exact bundle and manifest digest. The test verifies every offline resource byte, executes the real bundled PostgreSQL 17 `initdb.exe` against a new random synthetic CI directory with a fresh SCRAM password, verifies `PG_VERSION=17`/`pg_hba.conf`, refuses a second attempt, and confirms that owner/Vault/config was not created. It cleans only a confirmed-success, isolated synthetic cluster. Missing explicit bundle/digest skips the integration test in ordinary unit runs; a failed package-workflow qualification is **not** a success or proof of installed Browser provisioning. The test never uses an existing main cluster, installed profile, external network state backend, or real owner credentials.

## Optional atomic fresh Vault stage

The fresh `initdb` transaction supports an additional *explicit* action,
`INITIALIZE_FRESH_LOCAL_POSTGRES_17_WITH_VAULT`. Unlike a standalone
key-initializer on an existing cluster, this mode creates a new Vault key
only **after newly owned initdb** has passed PostgreSQL 17 structural checks,
but **before** its exclusive owner lock is released. The key resides at
`PGDATA/client-vault.key` with the existing Windows owner+SYSTEM/Unix 0600
protection. Any ACL/key/postcondition uncertainty leaves the owner lock and
partial cluster for manual reconciliation, never automatic deletion or retry.
The result reports only `vault_key_created`; no secret or private path is
returned. The separate physical Windows package gate tests real initdb and
real Vault key creation on one disposable CI-only cluster. This still does
NOT apply SQL schema, grant service_role, create the Browser owner profile
or start the installed API.
