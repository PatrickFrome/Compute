# R1 STEP07 — trusted live recovery source + source attestation

Status: PREPARE_ONLY / live workflow wiring  
Authority: cryptographic source provenance only; no durability authority

## Goal

Create the first workflow capable of producing one real encrypted recovery source from the managed Supabase database without publishing plaintext database content, and cryptographically verify where that ciphertext came from before it can be consumed by the two-domain provider plane.

STEP07 does **not** establish R2. A valid source attestation proves provenance of the encrypted source artifact. It does not prove that two independent provider versions exist or remain readable.

## Mandatory research before implementation

### Supabase logical backup contract

Current Supabase documentation describes self-generated logical backup through `supabase db dump`, with separate roles/schema/data concerns. `db dump` wraps PostgreSQL tooling with Supabase-specific filtering and excludes managed schemas by default. Current migration guidance also documents direct remote export through `--db-url`.

The project-owned recovery scope is deliberately narrow:

- roles are exported with Supabase CLI `--role-only`;
- project-owned schema/data are restricted to `destruktion_meta`;
- the Supabase migration ledger is captured separately from `supabase_migrations.schema_migrations` and bound into the recovery manifest/predicate.

Supabase explicitly states that database backups do **not** contain Storage API object bytes. Database rows contain Storage metadata only. STEP07 therefore records:

- `physical_backup_export_claim=false`;
- `supabase_managed_schemas_complete_claim=false`;
- `storage_api_objects_included=false`.

Sources:
- https://supabase.com/docs/guides/deployment/ci/backups
- https://supabase.com/docs/reference/cli/supabase-orgs-list#supabase-db-dump
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore

### Fixed Supabase CLI supply-chain input

`supabase/setup-cli` v3.0.0 is pinned to immutable commit:

`46f7f98c7f948ad727d22c1e67fab04c223a0520`

The source workflow fixes the CLI to `2.111.0`, rather than `latest`, to keep the logical export tool identity reproducible. The workflow checks the observed CLI version before accessing the DB secret.

Source:
- https://github.com/supabase/setup-cli/releases/tag/v3.0.0

### age remains the reviewed encryption boundary

STEP07 reuses the already verified STEP04 contract:

- age v1.3.1;
- exact release archive SHA-256;
- exact Sigsum proof SHA-256;
- Sigsum transparency verification;
- production profile requires at least two native `age1pq1...` hybrid recipients;
- encrypt exactly once;
- provider copies must preserve identical ciphertext bytes.

The public recovery recipients are supplied through the protected source environment variable `R1_RECOVERY_AGE_RECIPIENTS`; no private age identity belongs in CI.

### GitHub artifact attestations must be verified, not merely generated

GitHub documentation is explicit that generating an artifact attestation by itself provides no security benefit; a consumer must verify the attestation and enforce identity/predicate policy.

GitHub artifact attestations use Sigstore. For a public repository, the bundle is backed by the Sigstore public infrastructure/transparency log. `actions/attest` supports custom in-toto predicates and exposes a portable `bundle-path`.

Pinned action:

`actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6`

Current `gh attestation verify` supports:

- local `--bundle` verification;
- exact `--repo`;
- `--signer-workflow`;
- `--signer-digest`;
- `--source-ref`;
- `--source-digest`;
- `--cert-oidc-issuer`;
- custom `--predicate-type`;
- `--deny-self-hosted-runners`;
- JSON verification output for an additional fail-closed policy layer.

GitHub also warns that a custom predicate is workflow-controlled data. STEP07 therefore does not trust predicate contents merely because they are present; the verifier first pins workflow/source identity cryptographically and then validates that the predicate binds the exact ciphertext/envelope/control identity.

Sources:
- https://docs.github.com/en/actions/concepts/security/artifact-attestations
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations
- https://cli.github.com/manual/gh_attestation_verify
- https://github.com/actions/attest

## Trust-zone design

### 1. `preflight-source`

No database secret and no signing identity.

It verifies that `r1-recovery-source` already exists and has:

- required reviewers;
- `prevent_self_review=true`;
- branch policy protection.

This avoids relying on an implicitly created unprotected environment.

### 2. `source-build`

Protected environment + DB credential, but deliberately **no** `id-token:write` and **no** `attestations:write`.

Before export it captures:

- semantic head;
- canonical roadmap digest;
- canonicalized migration-ledger digest/count/max version.

After export it captures the same fields again. Any control/schema-plane drift rejects the source.

Within the same DB-secret-bearing shell step it then:

1. exports roles;
2. creates the project-owned schema/data recovery snapshot;
3. builds explicit export metadata;
4. builds the deterministic STEP03 plaintext recovery bundle;
5. encrypts the bundle once using STEP04;
6. verifies the envelope receipt;
7. builds the source-attestation predicate;
8. removes the private plaintext workspace.

Only the ciphertext, envelope receipt, and non-secret predicate survive to artifact upload.

### 3. `attest-source`

No protected environment and no DB secret. This is the only job with GitHub OIDC/attestation write permission.

It downloads the immutable ciphertext/predicate artifact IDs and generates the custom Sigstore/in-toto attestation.

### 4. `verify-source`

No environment, no DB secret, no OIDC signing permission.

It verifies the portable attestation bundle against:

- `PatrickFrome/Compute`;
- `.github/workflows/r1-live-recovery-source.yml`;
- exact source/signer digest = source run `GITHUB_SHA`;
- `refs/heads/main`;
- GitHub Actions OIDC issuer;
- project custom predicate type;
- GitHub-hosted runner policy.

Then `live_recovery_source_attestation.py` validates the verified statement and emits a self-hashed `CRYPTOGRAPHICALLY_VERIFIED_RECOVERY_SOURCE_NONAUTHORITATIVE` receipt.

## Implementation files

- `controller/r1/live_recovery_source_attestation.py`
- `tests/test_r1_live_recovery_source_attestation.py`
- `.github/workflows/r1-live-recovery-source.yml`

The controller contains no DB, provider, HTTP, Supabase SDK, signing, or secret client. It only validates already captured JSON/files.

## Mandatory research after implementation — completed

### 1. Schema/data snapshot consistency: initial design was insufficient and was amended

The first implementation used separate schema and data export sessions. PostgreSQL snapshot semantics show that independent connections are not guaranteed to observe the same database state; synchronized/exported snapshots are required when multiple dump connections must see one dataset.

A before/after semantic-head or migration-ledger fence catches control-plane/migration drift, but it does **not** catch arbitrary application DML committed between separate dump sessions. Treating that fence as data-snapshot consistency would therefore be a false claim.

Implementation amendment before merge:

- roles remain exported with the Supabase-filtered `supabase db dump --role-only` path;
- schema + data now originate from **one** PostgreSQL custom-format archive restricted to `destruktion_meta`;
- `pg_restore --schema-only` and `pg_restore --data-only` derive both SQL files from that one archive;
- the live project reports PostgreSQL 17.6;
- the client is pinned to `postgres:17.6-bookworm@sha256:f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3`.

The resulting live export identity is:

- roles tool: Supabase CLI 2.111.0;
- schema/data tool: PostgreSQL pg_dump/pg_restore 17.6;
- schema/data snapshot: `SINGLE_PG_DUMP_CUSTOM_ARCHIVE`;
- scope: `destruktion_meta` only.

This amendment removes the DML race without broadening raw pg_dump into Supabase-managed schemas.

Sources:
- https://www.postgresql.org/docs/current/app-pgdump.html
- https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION

### 2. Plaintext cleanup is best-effort, not secure erasure

The workflow keeps plaintext SQL, migration metadata, custom dump archive, plaintext recovery tar and bundle receipt under `$RUNNER_TEMP` and removes them before any artifact upload.

`shred -u` plus `rm -rf` is treated only as exposure reduction. Modern virtual/cloud-backed storage does not give this workflow a defensible cryptographic secure-delete guarantee.

Explicit semantics:

- `plaintext_secure_erasure_claim=false`;
- `best_effort_plaintext_cleanup=true`;
- `github_hosted_ephemeral_runner_isolation=true`;
- no plaintext file is selected for GitHub artifact upload.

If future policy requires a cryptographic erasure property rather than ephemeral-runner isolation, source generation must move to a controlled execution substrate with an explicit encrypted scratch-volume lifecycle.

### 3. Sigstore trusted-root policy: online freshness now, explicit root snapshot for offline restore later

GitHub attestation verification supports trusted-root export/import for offline verification. Trusted-root material can rotate, and an offline verifier cannot learn revocations or new roots after its snapshot.

STEP07 therefore deliberately does **not** freeze a static long-lived root snapshot into the online GitHub Actions verifier. The source verifier uses the current online trust state plus the portable attestation bundle.

The portable bundle is retained because future offline R3 restore verification may need it. R3 must explicitly capture/import a fresh trusted-root snapshot appropriate to the restore drill rather than assuming a permanently valid root embedded at STEP07 time.

Source:
- https://cli.github.com/manual/gh_attestation_trusted-root

### 4. Source-environment evidence is not directly asserted by the signing certificate

The source DB credential is deliberately isolated in `source-build`, while `attest-source` deliberately has no protected environment. This prevents one job from simultaneously possessing the production DB credential and the GitHub OIDC signing identity.

Consequence: the Sigstore signing certificate proves the exact source workflow/source digest, but does not directly prove that the signing job itself ran inside `r1-recovery-source`.

The exact workflow logic cryptographically bound by source digest requires protected-environment preflight and dynamic source-build environment admission, and the custom predicate records the expected environment. This is sufficient for a **non-authoritative source provenance candidate**, but it is not enough to let the environment field become an authority claim by itself.

Decision:

- do not claim certificate-level source-environment proof;
- final R2 evidence binding must include the source-environment readiness evidence/hash in addition to the verified source-attestation receipt;
- a later evidence-binding step may promote this to an explicit immutable artifact dependency.

### 5. Verified source receipt is a mandatory predecessor of provider credentials

The existing STEP06 orchestration validates source run/artifact metadata and envelope integrity but was written before STEP07 existed. Therefore provider execution must **not** be run merely because STEP07 can now produce a verified source receipt.

Required next semantic step:

`STEP07A_BIND_VERIFIED_SOURCE_RECEIPT_INTO_STEP06_BEFORE_PROVIDER_CREDENTIALS`

STEP07A must make the immutable `r1-recovery-source-verification.json` artifact a required input and validate at least:

- exact source run/head;
- exact ciphertext SHA-256/bytes;
- exact envelope receipt SHA-256;
- `source_attestation_verified=true`;
- self-hash integrity;
- `authority_effect=false`;
- `r2_proven=false`;
- `persisted_seal_allowed=false`.

AWS/B2 protected-environment jobs must depend on this credential-free verification gate. **No live STEP06 provider replication is permitted before STEP07A is merged and verified.**

### 6. GitHub artifacts are handoff transport, not a durability domain

GitHub Actions artifact retention is finite/configurable, and deleting a workflow run removes its associated artifacts. STEP07 intentionally uses short retention because GitHub is not one of the independent continuity domains.

Therefore:

- `github_artifact_durability_domain=false`;
- GitHub artifact IDs/digests are immutable handoff identifiers while available;
- successful AWS/B2 materialized versions, not GitHub artifacts, are the durability evidence;
- the source-attestation bundle and source-verification receipt hashes must be included in final continuity evidence before GitHub artifact expiry/deletion can matter;
- deleting a GitHub run must not be allowed to erase the only copy of authority-relevant evidence after final binding.

Sources:
- https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/removing-workflow-artifacts
- https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts

## Post-research implementation/test consequences

The post-research phase already caused two concrete amendments before merge:

1. schema/data changed from independent dump sessions to one custom pg_dump archive and derived schema/data outputs;
2. the adversarial forged-predicate test now distinguishes raw self-hash tampering from a forged predicate whose self-hash was recomputed, proving the independent source binding still rejects it.

The workflow metadata also explicitly records the mixed export implementation (`Supabase roles + PostgreSQL single-snapshot schema/data`) before the deterministic packager consumes it. The attestation predicate binds the resulting metadata and ciphertext.

## Strict nonclaims

- PR CI performs no DB connection and no live source generation;
- no source environment/secret/variable is created by this step;
- no production dump has yet been taken;
- no plaintext DB data is uploaded as an artifact;
- secure plaintext erasure is not claimed;
- no Storage API object bytes are claimed;
- no AWS/B2 provider object/readback is created;
- source verification does not establish provider durability;
- no Supabase continuity observation is inserted;
- no R2/R3 proof or persisted seal is created;
- stale R1 worker claim state is not mutated.

## Merge gate

STEP07 may merge only after both of these succeed on the exact head containing this completed post-research record:

1. `R1 Trusted Live Recovery Source` contract CI;
2. `Compute Fabric Governance`.

All workflow-dispatch live jobs must remain skipped on PR.

After merge, the next allowed implementation step is STEP07A. A real source-generation run and provider execution remain separate explicit live actions and are not implied by this source-only merge.
