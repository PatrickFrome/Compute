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
\n## First-run preflight boundary (successor)\n\n\`first-run-preflight.mjs\` is a strictly read-only, local-only inventory step for a\nreviewed future first-run provisioner. It checks canonical physical directory\nseparation, all existing symlink/junction ancestors, whether an owner profile,\nPGDATA or private runtime config already exists, and unexpected state contents.\nIt never creates PGDATA, starts PostgreSQL, generates a Vault key, changes an\nowner file, uses the network, or grants initialization authority.\nA result of \`PREPARATION_REVIEW_REQUIRED\` is **not** permission to call initdb.\nExisting data yields \`HOLD_EXISTING_PRIVATE_STATE\` and must follow a\nseparate owner-authorized migration/reconciliation path. Packaging must first\nprove the independently pinned offline bundle; this inventory does not verify\nsource or publisher integrity.\n