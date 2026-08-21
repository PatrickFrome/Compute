# R1 STEP03 — Managed Supabase Logical Recovery Bundle

Date: 2026-08-21  
Milestone: `R1_CONTINUITY_PLANE_ADOPTION`  
Mode: `PREPARE_ONLY / NON-AUTHORITATIVE`  
Semantic head reviewed: `metaengine-h205f22-recovery-dev-20260821-cp072`

## Goal

Define one deterministic **local plaintext inner recovery artifact** for the current managed Supabase project, so a later reviewed encryption step can encrypt it once and replicate the exact ciphertext to two independent durability domains.

This step does not export production data, does not create external provider objects, does not store plaintext outside the local execution boundary, does not write continuity observations, and does not claim R2/R3.

## Current production scope observed

A live schema inventory of `METAENGINE_H205F22_RECOVERY` showed:

- `destruktion_meta`: 159 tables;
- `public`: 0 tables;
- `supabase_migrations`: 1 table;
- `cron`: 2 tables, treated as extension/runtime configuration rather than silently claimed project-owned data.

The first project-owned logical recovery focus is therefore the current custom `destruktion_meta` state plus an explicit migration-ledger export. This is a scope decision, not a claim that all Supabase-managed state is represented.

## Why the first R2 artifact is logical, not pgBackRest physical backup

Supabase currently uses physical backups by default for eligible platform projects and manages restore/PITR at the platform layer. Physical backups are not generally downloadable. Supabase explicitly documents `supabase db dump` / `pg_dump` as the way to create your own logical backup artifact.

For the currently managed project, the first portable continuity object must therefore be a logical recovery artifact. pgBackRest remains a preferred amplifier for a future self-managed PostgreSQL/WAL plane, but it is not the correct first source of truth for this managed project.

## Supabase logical-export semantics that must be preserved

Current Supabase CLI documentation states that `supabase db dump`:

- runs `pg_dump` in a container;
- excludes Supabase-managed schemas such as `auth`, `storage`, and extension-created schemas;
- does not include data or custom roles in the default dump;
- requires explicit `--data-only` and `--role-only` exports for those components.

Current Supabase backup guidance shows the corresponding three-part pattern:

1. roles export;
2. schema export;
3. data-only export using COPY.

Therefore the inner H205F22 bundle requires separate files:

- `database/roles.sql`;
- `database/schema.sql`;
- `database/data.sql`.

The packager also requires:

- `control/migration-ledger.json`;
- `control/export-metadata.json`.

The export runner that eventually creates these inputs must pin a reviewed Supabase CLI/Postgres toolchain version rather than use an unbounded `latest` identity in canonical evidence.

## Managed schemas are an explicit coverage dimension

A Supabase CLI logical dump is not automatically equivalent to every managed service surface. `auth`, `storage`, extension schemas, platform settings, Edge Functions, Realtime configuration, API keys, domains, and other service configuration can require separate recovery handling depending on the recovery target.

The bundle manifest therefore sets:

- `supabase_managed_schemas_complete_claim=false`;
- `physical_backup_export_claim=false`.

That flag must remain false unless a later, separately reviewed recovery path proves broader coverage.

## Storage API objects are not database backup bytes

Supabase explicitly documents that database backups contain Storage metadata but **not the actual objects stored through the Storage API**. Restoring a database backup does not restore deleted object bytes.

Consequently, H205F22 refuses to infer Storage coverage from database coverage.

Without an explicit Storage inventory plus object archive, the bundle records:

- `storage_api_objects_included=false`;
- `coverage=NOT_INCLUDED`;
- warning `SUPABASE_DATABASE_BACKUP_DOES_NOT_INCLUDE_STORAGE_API_OBJECT_BYTES`.

If a later Storage exporter supplies both:

- `storage/storage-inventory.json`;
- `storage/storage-objects.tar`;

then both artifacts are independently hashed and included in the deterministic inner bundle. Inventory without object bytes, or object bytes without inventory, is rejected.

## Deterministic inner bundle

`controller/r1/recovery_artifact_packager.py` produces an **uncompressed USTAR** archive to minimize implementation-dependent compression variance.

Determinism contract:

- fixed archive path names;
- lexicographically controlled input order;
- `mtime=0`;
- uid/gid `0`;
- empty uname/gname;
- mode `0600`;
- canonical JSON encoding for the manifest;
- per-entry SHA-256 and byte count;
- manifest self-digest;
- final bundle SHA-256 and exact byte count.

The same input bytes plus the same semantic metadata must generate the same bundle bytes regardless of temporary source directory.

Changing one input byte must change the final bundle SHA-256.

## Security boundary: plaintext is LOCAL ONLY

Database dumps can contain credentials, user data, tokens, configuration and other sensitive state. The inner bundle is intentionally classified:

`SENSITIVE_RECOVERY_BUNDLE_PLAINTEXT_LOCAL_ONLY`

and explicitly states:

- `plaintext=true`;
- `external_storage_ready=false`;
- `required_next=ENCRYPT_ONCE_TO_RECOVERY_RECIPIENTS_THEN_REPLICATE_IDENTICAL_CIPHERTEXT`.

No external upload controller should accept this plaintext classification.

## Why encryption happens once before two-domain replication

The reviewed next step is an age/X25519 (or equivalently reviewed) encryption envelope. The age format uses a randomly generated file key and recipient wrapping; independently encrypting the same plaintext twice intentionally yields different ciphertexts.

For H205F22 cross-domain identity we instead want one immutable object identity:

1. build deterministic plaintext inner bundle locally;
2. validate manifest and bundle SHA-256;
3. encrypt **once** to the reviewed recovery-recipient set;
4. hash that exact ciphertext;
5. upload the exact same ciphertext bytes to provider A and provider B;
6. independently GET/materialize those ciphertext bytes from each provider;
7. locally verify the same ciphertext SHA-256 and byte count in both domains;
8. only then decrypt in an isolated restore drill and verify the inner manifest/database state.

This keeps confidentiality and makes the two-domain content identity exact.

## Relationship to STEP02 readback verifier

STEP02's `materialized_readback_verifier.py` remains the provider-neutral outer evidence gate. After encryption, its expected object SHA-256 should be the ciphertext SHA-256, not a provider ETag and not the plaintext digest.

The inner plaintext manifest digest remains useful after decryption during R3 restore verification.

Thus:

- R2 proves independent persistence of identical encrypted bytes;
- R3 proves those bytes decrypt and restore to the expected recovery state.

## pgBackRest research correction

pgBackRest remains valuable for self-managed PostgreSQL and WAL:

- current multi-repository support;
- current `verify --set=<backup-label>` repository validation;
- repository time-target/version-recovery mechanisms for object stores.

But two cautions matter:

1. a pgBackRest `backup` runs against a selected repository; multi-repository configuration does not mean one backup command automatically produces one identical backup set in every repository;
2. blanket object-retention policies can conflict with mutable repository metadata on some backends, so the working backup repository and immutable continuity artifact should be treated as separate layers unless provider-specific compatibility is proven.

For the managed Supabase recovery project, the logical bundle path is therefore the correct first executable R2 artifact design.

## Required future export evidence

A real export execution must record at least:

- exact Supabase CLI version;
- exact Postgres/pg_dump version used by that CLI execution;
- project ref;
- semantic checkpoint;
- source Git SHA;
- export timestamp;
- exact command classes used for roles/schema/data;
- schema inclusion/exclusion policy;
- migration-ledger row count and digest;
- whether Storage object bytes were separately exported;
- per-file digest/bytes before packaging;
- final deterministic bundle digest/bytes.

Raw database URLs, passwords, service-role keys, Storage secrets, provider keys and other credentials must not enter the manifest.

## Current implementation/tests

The STEP03 packager is offline and credential-free. Tests require:

- identical inputs in different directories -> identical bundle SHA/bytes;
- normalized tar metadata/member ordering;
- local-only plaintext/non-authority flags;
- explicit Storage omission warning;
- storage inventory/archive pair requirement;
- included Storage artifacts independently hashed;
- malformed migration ledger rejected;
- invalid project ref/Git SHA/time rejected;
- one-byte input change -> different bundle digest.

CI additionally rejects network/provider/Supabase SDK imports, credential-token names, and home-grown cryptography libraries in the packager. Encryption is intentionally delegated to the next separately reviewed envelope step.

## Primary sources reviewed

- Supabase Database Backups: https://supabase.com/docs/guides/platform/backups
- Supabase CLI `db dump`: https://supabase.com/docs/reference/cli/supabase-projects
- Supabase automated backup example: https://supabase.com/docs/guides/deployment/ci/backups
- Supabase CLI backup/restore: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- Supabase Storage downloads: https://supabase.com/docs/guides/storage/management/download-objects
- Supabase restore/clone coverage notes: https://supabase.com/docs/guides/platform/clone-project
- age encrypted file format specification: https://c2sp.org/age@main
- pgBackRest current documentation: https://pgbackrest.org/

## Strict nonclaims

- production logical dump created: **NO**
- plaintext recovery data uploaded externally: **NO**
- encryption envelope implemented by this step: **NO**
- Storage API object bytes exported: **NO**
- provider A/B objects created: **NO**
- continuity observations inserted: **NO**
- production R2 proven: **NO**
- H47C persisted seal created: **NO**
- production R3 proven: **NO**
- active R1 worker claim #16 modified: **NO**
