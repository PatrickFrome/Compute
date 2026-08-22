# R1 STEP10 — live R2 execution orchestration

Status: IMPLEMENTED / PREPARE_ONLY pending mandatory research-after and final exact-head CI  
Authority: a future explicitly approved live run may execute STEP09B and derive continuity-table R2; this workflow does **not** promote canonical roadmap R2, seal R1, prove R3, or create a persisted seal.

## Goal

Connect the already-separated R1 evidence planes into one fail-closed execution chain without collapsing their credentials into one trust zone:

1. successful trusted source workflow evidence;
2. successful independent AWS + Backblaze provider readback evidence;
3. credential-free STEP08 final evidence package;
4. a **fresh exact-version provider materialization** for the ciphertext that STEP09A will cryptographically reverify;
5. a **fresh online trusted-root fetch** immediately before STEP09A;
6. a separate DB-only protected job invoking STEP09B.

The workflow is intentionally not a new authority implementation. It composes the existing STEP07/STEP08/STEP09A/STEP09B contracts and adds only run/artifact/environment preflight plus provider-materialization binding.

## Mandatory research before implementation

### 1. Existing repo contracts already provide the source and two-provider halves

`r1-live-recovery-source.yml` already separates:

- protected DB-secret-bearing source export/encryption;
- environment approval evidence;
- Sigstore attestation generation;
- credential-free cryptographic source verification.

`r1-live-two-domain-orchestration.yml` already separates:

- AWS protected OIDC job;
- Backblaze protected application-key job;
- credential-free two-domain quorum evaluation.

The provider workflow deliberately ends with a non-authoritative quorum candidate. It does not perform STEP08, STEP09A, database ingestion, canonical promotion, or sealing.

Therefore STEP10 should compose those artifacts instead of teaching one job how to perform all operations.

### 2. STEP09A must verify bytes materialized from a provider object, not merely the GitHub source artifact

STEP08 explicitly omits ciphertext bytes and records only their identity. STEP09A requires a separately materialized ciphertext and recomputes its exact SHA-256/byte count before source-attestation verification.

For an authority-bearing live path, the strongest available binding is therefore:

- take the already validated AWS provider result;
- bind to its exact content-addressed object key and exact `VersionId`;
- fetch that exact version again;
- recheck COMPLIANCE retention;
- recompute SHA-256 locally;
- pass those freshly materialized bytes to STEP09A.

Using the old GitHub source artifact would prove the source artifact again but would not prove that the bytes being admitted to continuity authority were freshly read from the immutable provider object.

### 3. AWS exact-version read needs only version-read + retention-read permissions for the S3 object

Amazon S3 documents that a `GetObject` request with a `versionId` requires `s3:GetObjectVersion` rather than ordinary `s3:GetObject`. `GetObjectRetention` is a separate read permission. `x-amz-expected-bucket-owner` makes the request fail when the bucket is owned by a different account.

The STEP10 AWS session policy is therefore generated from the validated provider result and protected environment identity and is scoped to one exact object ARN. It:

- ALLOWs `s3:GetObjectVersion` and `s3:GetObjectRetention` on that object;
- explicitly DENYs `PutObject`, object/version deletion, retention mutation and legal-hold mutation on that object;
- uses 15-minute OIDC credentials;
- checks `sts get-caller-identity` against the protected expected AWS account.

Sources:
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html

### 4. SSE-KMS is deliberately not granted implicitly

AWS documents that a `GetObject` of an object encrypted with a customer-managed KMS key may additionally require `kms:Decrypt`.

The existing R1 AWS provider readiness/session-policy contract does not grant KMS actions, while the provider workflow itself performs a full version-pinned GET and local SHA-256 before emitting a valid provider result. Therefore a provider result usable by STEP10 already came through an AWS read path that did not require permissions outside the existing contract.

STEP10 does **not** introduce a wildcard or unbound `kms:Decrypt` permission. If future provider configuration adopts SSE-KMS and binds a specific KMS key identity, that requires a separate reviewed extension of the provider-readiness and STEP10 materialization contracts.

### 5. Fresh Sigstore trusted root must be fetched immediately before STEP09A

GitHub CLI documents `gh attestation trusted-root` as the mechanism for obtaining a `trusted_root.jsonl` suitable for offline verification with `gh attestation verify --custom-trusted-root`.

STEP08 may package a trusted-root snapshot as evidence, but STEP09A explicitly treats packaged-root freshness as non-authoritative. STEP10 therefore performs two distinct operations:

- evidence assembly obtains a root snapshot for the STEP08 package;
- authority-gate job obtains a **new fresh trusted root**, captures `acquired_at`, builds the STEP09A root context, and uses only that root for the authority gate.

Source:
- https://cli.github.com/manual/gh_attestation_trusted-root

### 6. GitHub protected environments are appropriate credential boundaries

GitHub documents that environment protection rules must pass before a referenced job proceeds and that environment secrets are not available to the job until the configured approval rules pass. Required reviewers can be combined with Prevent self-review and deployment branch restrictions.

STEP10 therefore requires runtime REST preflight of two existing/dedicated environments before publishing their names into downstream `environment:` expressions:

- `r1-aws-durability-proof` for provider materialization;
- `r1-supervisor-r2-db-ingestion` for the final DB-only transaction.

Both must have:

- a required-reviewers protection rule;
- at least one reviewer;
- Prevent self-review enabled;
- a branch-policy protection rule.

The connected GitHub tool available during implementation does not expose the repository-environment settings endpoint. Attempts to enumerate environment/workflow-dispatch state through unsupported connector endpoints were rejected. Consequently this research record does **not** claim that the dedicated DB environment or its secrets currently exist. Runtime REST preflight is the source of truth and fails closed when they do not.

Sources:
- https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
- https://docs.github.com/en/rest/deployments/environments

### 7. Direct artifacts give stable filenames and immutable cross-run identities

The current `actions/upload-artifact` v7 contract states that `archive: false` accepts one file and uses the file name as the artifact name, ignoring `name`. Current toolkit documentation also describes direct artifacts as immutable after upload. The existing R1 source/provider workflows already upload their evidence this way.

STEP10 preflight therefore validates exactly one non-expired artifact of every required name, including the artifact digest and workflow-run binding. Cross-run downloads use the pinned download action plus exact run ID and `digest-mismatch: error`.

Sources:
- https://github.com/actions/upload-artifact/blob/main/action.yml
- https://github.com/actions/upload-artifact
- https://github.com/actions/toolkit/blob/main/packages/artifact/RELEASES.md

### 8. DB credentials must never share a job with provider or GitHub attestation credentials

STEP09B's runner already rejects GitHub/OIDC/AWS/B2 credential variables and copies only an explicit libpq allowlist to its `psql` child.

STEP10 preserves this boundary:

- evidence assembly: GitHub Actions artifact read only; no provider or DB credential;
- AWS materialization: AWS OIDC only; no DB credential;
- STEP09A: no provider credential and no DB credential;
- STEP09B: DB environment only; no OIDC, AWS/B2 credential or `gh attestation` invocation.

The DB job downloads only three exact current-run artifacts:

1. `r1-final-r2-evidence-package.tar`;
2. `r1-final-r2-evidence-package-receipt.json`;
3. `r1-step09a-authority-gate.json`.

The provider-materialized ciphertext is deliberately not downloaded into the DB trust zone.

## Implementation

### `controller/r1/live_r2_execution_guard.py`

The guard performs no external calls. It provides two narrow contracts.

#### Live-run preflight

It validates:

- exact repository ID/name for source and provider runs;
- exact workflow path;
- `workflow_dispatch` event;
- `main` branch;
- completed/successful run state;
- exact non-expired required artifacts with SHA-256 artifact digest and workflow-run binding;
- AWS + DB protected-environment reviewer/self-review/branch protection shape.

The emitted preflight remains non-authoritative and explicitly records that fresh provider materialization and fresh trusted root are still required.

#### AWS authority materialization

Before AWS credentials are obtained the guard:

- revalidates the persisted AWS provider result;
- binds domain/account/bucket to protected environment variables;
- requires the exact object key `h205f22/r1/sha256/<ciphertext_sha256>.age`;
- rejects control characters in key/version/CLI-facing values;
- requires a syntactically valid AWS account and region;
- builds an exact-object read-only session policy with explicit mutation denies.

After the exact-version GET, the guard requires:

- returned `VersionId` equals the provider result;
- content length equals the provider result;
- exact expected object metadata;
- COMPLIANCE retention still active and not shortened relative to the provider result;
- locally recomputed ciphertext SHA-256 and byte count match exactly.

The resulting materialization receipt is still non-authoritative. STEP09A is the next authority gate.

### `.github/workflows/r1-live-r2-execution.yml`

The workflow has a PR-only contract path plus an explicit manual live path.

Manual inputs:

- trusted source run ID;
- trusted provider-orchestration run ID;
- `execute_ingestion` boolean;
- exact confirmation token `INGEST_R1_TWO_DOMAIN_EVIDENCE_TO_CONTINUITY_DB` when ingestion is requested.

Jobs:

1. `contract-tests` — unit/adversarial tests and STEP08/09A/09B regressions only.
2. `preflight-live` — GitHub REST metadata validation, no provider/DB secrets.
3. `evidence-assembly` — reconstructs provider result and builds STEP08.
4. `aws-materialize` — protected 15-minute OIDC read-only exact-version materialization.
5. `authority-gate` — obtains a new fresh trusted root and runs production STEP09A.
6. `db-ingestion` — separate protected DB-only environment and STEP09B runner.

`execute_ingestion=false` permits only preflight + STEP08 evidence assembly. Provider rematerialization, STEP09A authority generation and DB mutation are gated behind `execute_ingestion=true` plus the exact confirmation token and both protected environments.

## Live prerequisites — intentionally not assumed

A real STEP10 ingestion can succeed only if all of the following are actually present at dispatch time:

1. a successful `R1 Trusted Live Recovery Source` workflow-dispatch run on `main` with every required direct artifact;
2. a successful `R1 Live Two-Domain Readback Orchestration` workflow-dispatch run on `main` whose evidence is bound to that source;
3. `r1-aws-durability-proof` remains correctly protected and exposes the already-established AWS variables;
4. a dedicated `r1-supervisor-r2-db-ingestion` protected environment exists with required reviewers, Prevent self-review and main/protected branch restrictions;
5. that DB environment supplies:
   - vars `R1_PGHOST`, `R1_PGPORT`, `R1_PGDATABASE`, `R1_PGUSER`;
   - secrets `R1_PGPASSWORD`, `R1_PGSSLROOTCERT_PEM`;
6. the DB endpoint accepts TLS verification with `PGSSLMODE=verify-full` and that CA certificate;
7. both provider readbacks are still inside STEP09A's seven-day freshness window;
8. the fresh trusted-root context remains inside the fifteen-minute STEP09A/STEP09B window.

Absence or mismatch of any prerequisite is a workflow failure, not a reason to weaken the gate.

## Tests implemented before first PR CI

The STEP10 guard suite covers:

- successful exact run/artifact/environment preflight;
- wrong provider workflow rejection;
- duplicate required artifact rejection;
- missing self-review protection rejection;
- exact AWS read-only allow actions + explicit mutation denies;
- successful exact-version materialization with local SHA-256 recomputation;
- wrong version rejection;
- corrupt materialized bytes rejection;
- shortened COMPLIANCE retention rejection;
- environment/domain mismatch rejection;
- rehashed but non-content-addressed provider key rejection;
- control-character `VersionId` rejection before shell transport.

The workflow CI also reruns STEP08, STEP09A and STEP09B regression suites.

## Strict nonclaims before research-after

At this point:

- the new workflow has **not** been manually dispatched;
- no AWS read was performed by STEP10;
- no provider object was created, modified or deleted by STEP10;
- no fresh STEP09A authority receipt was produced by STEP10;
- no STEP09B live database ingestion was performed;
- production continuity is not claimed to contain any new row;
- continuity-table R2 is not claimed from live evidence;
- canonical roadmap R2 is not promoted;
- R1 is not sealed;
- R3 is not proven;
- no persisted seal was created;
- current existence/configuration of the dedicated DB environment and successful upstream live runs is deliberately **unknown**, because the connected tool cannot enumerate those unsupported endpoints and no runtime dispatch has been executed.

## Mandatory research after implementation before merge

After the first independent PR CI run, merge remains forbidden until the following are rechecked and recorded:

1. inspect every CI failure and distinguish workflow/static-test defects from production contract defects;
2. confirm exact final action pins and current `archive:false` / cross-run download behavior;
3. confirm the fresh trusted-root job can remain credential-free with local bundle + custom root verification; if GitHub CLI unexpectedly requires an API credential, do not combine it with DB credentials — redesign the authority job instead;
4. re-audit AWS exact-version permissions, `expected-bucket-owner`, checksum mode, and SSE-KMS boundary;
5. confirm the exact-object inline session policy cannot permit provider mutation and that its control-character/content-addressed locator guards are sufficient for shell transport;
6. review whether AWS materialization is enough for STEP09A or whether a second fresh B2 materialization adds meaningful authority rather than redundant complexity;
7. inspect DB job inputs and prove it receives no provider ciphertext/provider credential/GitHub attestation credential;
8. re-check current production continuity counts and ensure implementation/PR CI created no rows;
9. re-check STEP09B production ACL/function boundary remains postgres-only `SECURITY INVOKER`;
10. document the inability or ability to verify actual protected environment configuration without running the live preflight; do not invent secrets or environment state;
11. re-run STEP10 + STEP08/09A/09B regressions and Compute Fabric Governance on the exact final head after all research-after fixes.

Only an exact-final-head green result may be used as the merge signal. Merge of STEP10 still means **PREPARE_ONLY**; a later explicitly approved live dispatch is what could create real continuity evidence.
