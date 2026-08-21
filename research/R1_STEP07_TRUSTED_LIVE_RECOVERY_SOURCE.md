# R1 STEP07 — trusted live recovery source + source attestation

Status: PREPARE_ONLY / live workflow wiring  
Authority: cryptographic source provenance only; no durability authority

## Goal

Create the first workflow capable of producing one real encrypted recovery source from the managed Supabase database without publishing plaintext database content, and cryptographically verify where that ciphertext came from before it can be consumed by the two-domain provider plane.

STEP07 does **not** establish R2. A valid source attestation proves provenance of the encrypted source artifact. It does not prove that two independent provider versions exist or remain readable.

## Mandatory research before implementation

### Supabase logical backup contract

Current Supabase documentation states that a self-generated logical backup uses separate `supabase db dump` operations for roles, schema, and data. `db dump` wraps `pg_dump` with Supabase-specific filtering and excludes managed schemas by default. Current migration guidance also shows `--db-url` for direct remote dumps.

The project therefore uses:

- roles: `supabase db dump --role-only`;
- schema: `supabase db dump --schema destruktion_meta`;
- data: `supabase db dump --schema destruktion_meta --data-only --use-copy`.

The source intentionally narrows project-owned database coverage to `destruktion_meta`; the Supabase migration ledger is captured separately from `supabase_migrations.schema_migrations` and bound into the recovery manifest/predicate.

Supabase also explicitly states that database backups do **not** contain Storage API object bytes. Database rows contain only Storage metadata. STEP07 therefore records:

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

Current GitHub documentation is explicit: generating an artifact attestation by itself provides no security benefit; the consumer must verify the attestation and enforce an identity/predicate policy.

GitHub artifact attestations use Sigstore. For a public repository, the bundle is backed by the Sigstore Public Good Instance/transparency log. `actions/attest` supports custom in-toto predicates and exposes a portable `bundle-path`.

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

GitHub also warns that the custom predicate is workflow-controlled data. STEP07 therefore does not treat predicate contents alone as trusted; the verifier pins the workflow/source identity cryptographically and then validates that the predicate binds the exact ciphertext/envelope/control identity.

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

This avoids GitHub's behavior of implicitly creating an unprotected environment merely because a workflow references a missing environment.

### 2. `source-build`

Protected environment + DB credential, but deliberately **no** `id-token:write` and **no** `attestations:write`.

Before the logical dump it captures:

- semantic head;
- canonical roadmap digest;
- canonicalized migration-ledger digest/count/max version.

After the three logical dumps it captures the same fields again. Any drift rejects the source.

Within the same DB-secret-bearing shell step it then:

1. builds the explicit export metadata;
2. builds the deterministic STEP03 plaintext recovery bundle;
3. encrypts the bundle once using STEP04;
4. verifies the envelope receipt;
5. builds the source-attestation predicate;
6. removes the private plaintext workspace.

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

## Strict nonclaims

- PR CI performs no DB connection and no live source generation;
- no source environment/secret/variable is created by this step;
- no production dump has yet been taken;
- no plaintext DB data is uploaded as an artifact;
- no Storage API object bytes are claimed;
- no AWS/B2 provider object/readback is created;
- no Supabase continuity observation is inserted;
- no R2/R3 proof or persisted seal is created.

## Mandatory research after implementation before merge

After CI, re-check and record:

1. whether the three separate Supabase logical dump commands can be made more transactionally consistent without abandoning Supabase-specific filtering;
2. whether runner filesystem cleanup can be claimed as secure deletion or only best-effort cleanup on an ephemeral runner;
3. whether GitHub attestation verification needs an explicitly pinned trusted-root snapshot for the provider-consumer path;
4. whether the custom predicate should bind the source-environment readiness receipt/artifact ID explicitly;
5. whether the source-verification receipt must be carried as a required immutable artifact into STEP06 before provider credentials are issued;
6. whether public-repository artifact retention and workflow-run deletion create any evidence-availability requirement independent of provider durability.

Merge is forbidden until these findings are recorded and CI succeeds again on that exact head.
