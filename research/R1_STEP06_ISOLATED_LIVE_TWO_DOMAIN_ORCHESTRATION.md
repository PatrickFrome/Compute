# R1 STEP06 — isolated live two-domain orchestration preparation

Status: PREPARE_ONLY / live execution wiring  
Authority: NON-AUTHORITATIVE provider candidate assembly only

## Research before implementation

### 1. GitHub environments must be verified before they are referenced

GitHub environment protection rules gate a job before the job is sent to a runner and before environment secrets become available. Required reviewers can be configured with `prevent_self_review` so the actor who initiated the workflow cannot approve their own protected job.

Current GitHub REST documentation allows a repository token with Actions read permission to `GET /repos/{owner}/{repo}/environments/{environment_name}`. The response exposes protection rules and deployment branch policy.

Sources:
- https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments
- https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- https://docs.github.com/en/rest/deployments/environments

Critical design constraint: GitHub can create an environment automatically when a workflow references a previously nonexistent environment. A live recovery workflow therefore must not hard-code an unverified environment name directly into an executable provider job. STEP06 first fetches both existing environment resources, validates protection rules, then emits the already-verified names as `needs` outputs. Provider jobs reference only those outputs and cannot start after a failed preflight.

Required environments:

- `r1-aws-durability-proof`
- `r1-b2-durability-proof`

Required properties:

- one required-reviewers protection rule with at least one reviewer;
- `prevent_self_review=true`;
- a deployment branch policy / branch-policy protection rule;
- live dispatch itself is restricted to `refs/heads/main`.

The workflow never creates or modifies environments.

### 2. AWS credentials remain OIDC-only and environment-scoped

The existing W1 provider controller establishes the project convention:

- separate protected environment;
- job-level `id-token: write` only where AWS credentials are needed;
- `aws-actions/configure-aws-credentials` pinned by immutable commit;
- account allowlist;
- 900-second role session;
- no long-lived AWS access keys in repository secrets.

STEP06 reuses:

`aws-actions/configure-aws-credentials@e6de054238d6b7531b4efff3b6587d9aade6a06c`

The current action contract supports `output-env-credentials:false` plus `output-credentials:true`. STEP06 uses that stronger mode: temporary AWS credentials are not exported to the job environment and are supplied only to the single replication step from action outputs. Later validation and artifact-upload steps do not inherit them.

GitHub's current OIDC documentation binds environment-referencing jobs into the `sub` claim. The AWS trust policy must pin this repository's immutable owner/repository identity and the dedicated R1 environment, plus audience `sts.amazonaws.com`.

Sources:
- https://docs.github.com/en/actions/concepts/security/openid-connect
- https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws
- https://github.com/aws-actions/configure-aws-credentials/blob/e6de054238d6b7531b4efff3b6587d9aade6a06c/action.yml

### 3. B2 scope is verified from the provider, not inferred from a secret name

Backblaze `b2_authorize_account` v4 returns the actual application-key authorization surface, including account ID, allowed bucket(s), capabilities, `namePrefix`, application-key expiration timestamp and S3 API endpoint.

STEP06 requires a single expected bucket, exact prefix:

`h205f22/r1/sha256/`

and at minimum:

- `readFiles`;
- `writeFiles`;
- `readFileRetentions`;
- `writeFileRetentions`.

Unexpected destructive or broad bucket-administration capabilities fail closed. The key must have more than ten minutes but no more than 24 hours remaining. Its account ID is hashed locally and compared to the configured account-scope digest. The raw authorization token and application key are never uploaded as evidence.

Sources:
- https://www.backblaze.com/apidocs/b2-authorize-account
- https://www.backblaze.com/docs/cloud-storage-application-keys
- https://www.backblaze.com/docs/cloud-storage-application-key-capabilities
- https://www.backblaze.com/docs/cloud-storage-s3-compatible-app-keys

### 4. GitHub artifact transfer is integrity-checked and commit-pinned

Selected immutable action revisions:

- `actions/upload-artifact` v7.0.1 at `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`;
- `actions/download-artifact` v8.0.1 at `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c`.

Upload v7 supports direct single-file artifacts with `archive:false` and exposes artifact ID + SHA-256 digest. Download v8 validates the stored artifact digest by default and treats mismatch as an error; STEP06 sets `digest-mismatch:error` explicitly. Immutable artifact IDs plus repository/run binding are used for cross-run retrieval.

Sources:
- https://github.com/actions/upload-artifact/tree/043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
- https://github.com/actions/download-artifact/tree/3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c

STEP06 never searches for a source artifact by a loose name during provider execution. The caller supplies immutable source artifact IDs; preflight validates their names, digests, source workflow run, repository ID, branch and source SHA before any provider job becomes eligible.

Expected future source artifacts:

- `r1-recovery-ciphertext.age`
- `r1-recovery-envelope-receipt.json`

The trusted source workflow is fixed to:

`.github/workflows/r1-live-recovery-source.yml`

That workflow is a later semantic step and does not yet exist. Therefore merging STEP06 cannot itself perform production provider replication.

### 5. Source-run trust is stronger than “artifact exists”

Preflight requires the source workflow run to be:

- repository ID `1341371143`, `PatrickFrome/Compute`;
- head repository identical to the canonical repository;
- branch `main`;
- event `workflow_dispatch`;
- status completed / conclusion success;
- exact workflow path `.github/workflows/r1-live-recovery-source.yml`;
- each selected artifact bound by GitHub metadata to the same run/repository/branch/head SHA.

This prevents a PR artifact, fork artifact, failed source run or similarly named artifact from being written into COMPLIANCE storage.

### 6. Partial-run retries consume STEP05A

STEP06 calls `idempotent_exact_ciphertext_replication.py`, not raw STEP05. A prior successful provider version is reused only after metadata, version-specific COMPLIANCE retention, full GET and local SHA-256 verification. First creation still follows STEP05's conditional-write contract.

### 7. Provider credentials are isolated into separate trust zones

The execution graph deliberately has four credential surfaces:

1. **preflight** — GitHub Actions read + repository contents read only; no provider environment;
2. **AWS job** — only AWS environment and OIDC role; never B2 secrets;
3. **B2 job** — only B2 environment application key; no OIDC token and no AWS environment;
4. **quorum job** — GitHub artifact/content read only; no environment, no provider credentials, no id-token permission.

B2 secrets are step-scoped to authorization+replication. AWS credentials are output-only and step-scoped to the replication step. Provider-result validation and artifact publication execute without provider credentials in their environment.

### 8. Live attempts are serialized by source artifact identity

Current GitHub Actions concurrency supports `queue: max`, retaining pending workflow attempts rather than replacing a prior pending run. Durable provider writes must not be canceled midway merely because another operator requested a retry.

Source:
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency

STEP06 live attempts share a concurrency group derived from the source run ID and immutable ciphertext artifact ID, with `queue: max` and no cancellation of in-progress work.

## Implemented contract

`controller/r1/live_two_domain_orchestration_guard.py` validates:

- source run and immutable source artifact binding;
- pre-existing protected environments;
- actual B2 application-key scope/expiry;
- STEP05A provider results, their self-hashes and STEP02 readback receipts;
- independent provider/operator/failure domains;
- two strong COMPLIANCE retention domains;
- identical ciphertext SHA-256/bytes across providers.

`.github/workflows/r1-live-two-domain-orchestration.yml` provides:

- PR-only contract tests with no provider execution;
- explicit `workflow_dispatch` live preflight;
- separate AWS and B2 protected-environment jobs;
- direct single-file provider-result artifacts;
- a credential-free quorum job.

The resulting quorum is still a candidate. It does **not** establish source authenticity. The separate DSSE/in-toto/Sigstore source-attestation gate identified after STEP04 remains mandatory before any Supabase R2 authority.

## Mandatory post-step research — completed before merge

### A. Dynamic environment evaluation is a supported contract

GitHub permits the `needs` context in `jobs.<job_id>.environment.name`. Therefore STEP06's pattern — metadata-only preflight validates the existing environment, emits its fixed name, provider job consumes that name through `needs` — is supported workflow syntax rather than an accidental parser behavior.

The required-reviewer and prevent-self-review protections are applied before the provider job gains access to environment secrets. This remains the principal human-approval boundary for live replication.

Sources:
- https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/accessing-contextual-information-about-workflow-runs
- https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments

### B. Direct artifact integrity remains an additional handoff gate, not R2 content authority

`upload-artifact` direct-file mode stores one file without ZIP packaging and returns an artifact digest. `download-artifact` v8 checks the artifact digest and errors on mismatch. STEP06 therefore gets a GitHub-controlled integrity check during inter-job/inter-run handoff.

That digest is not promoted to R2 content authority. The provider controller still validates the STEP04 envelope and ciphertext SHA-256 before upload; STEP05A still performs full provider GET and STEP02 local SHA-256 after upload/reuse. The GitHub artifact digest is defense in depth only.

### C. AWS output-only OIDC credentials reduce credential lifetime inside the job

The pinned `configure-aws-credentials` action explicitly supports output-only credentials. With `output-env-credentials:false`, credentials are not exported globally into subsequent job steps. STEP06 supplies the action outputs only to the provider step. The later provider-result validation and GitHub artifact upload therefore execute without AWS credentials in their environment.

### D. B2 Object Lock capability names are confirmed, but `writeFiles` includes native hide authority

Backblaze documents:

- `readFileRetentions` → read object retention / S3 Get Object Retention;
- `writeFileRetentions` → set/update object retention / S3 Put Object Retention;
- `readBucketRetentions` → read bucket Object Lock configuration;
- `readBucketLifecycleRules` / lifecycle-readable bucket metadata should be used by the next provider-configuration readiness step where available;
- `writeFiles` is necessary for upload **and also includes native `b2_hide_file`**.

Consequently it is impossible to express “may upload but may never create a hide marker” using only the B2 `writeFiles` capability. STEP06 compensates by requiring a single bucket, exact recovery prefix, short expiry, no `deleteFiles`, no `bypassGovernance`, COMPLIANCE-retained concrete versions and version-pinned full readback. A hide marker is never interpreted as proof that retained bytes disappeared, and STEP05A never promotes a hidden historical version without an explicit verified version path.

Sources:
- https://www.backblaze.com/docs/cloud-storage-application-key-capabilities
- https://www.backblaze.com/docs/cloud-storage-s3-compatible-app-keys
- https://www.backblaze.com/apidocs/b2-hide-file

### E. Provider bucket configuration must become a separate read-only readiness gate before first live write

Object-level retention is not enough to validate the provider domain's surrounding configuration. Before first live replication, the execution plane should read and fail closed on provider configuration:

AWS:
- bucket versioning enabled;
- Object Lock configuration enabled;
- lifecycle policy does not undermine the dedicated recovery prefix;
- writer role has no delete/object-lock-bypass/lifecycle-mutation permissions;
- conditional-write policy remains compatible with STEP05 first-write semantics.

Backblaze B2:
- expected bucket and endpoint;
- Object Lock enabled;
- lifecycle rules reviewed for the recovery prefix;
- runtime application key remains bucket+prefix scoped, short-lived and without `deleteFiles` / `bypassGovernance` / bucket-write capabilities.

This becomes **STEP06A — provider configuration readiness preflight** and is a prerequisite for enabling the first production provider write. STEP06 itself remains PREPARE_ONLY.

### F. Concurrency remains serialized and retry-safe

`queue: max` prevents a newer orchestration request from silently replacing a pending one. STEP05A makes provider execution idempotent after partial success. Together these properties avoid both unsafe mid-write cancellation and duplicate-content dead ends during retries.

## Strict nonclaims

- the trusted source workflow does not yet exist;
- the required AWS/B2 protected environments are not created by this PR;
- no environment secrets or variables are created by this PR;
- no production recovery ciphertext is supplied by this PR;
- no production AWS or B2 call is made by PR CI;
- no provider object or readback is claimed;
- no source attestation is verified;
- no Supabase observation is inserted;
- no R2/R3 proof or H47C seal is created.

## Required next

`STEP06A_PROVIDER_CONFIGURATION_READINESS_PREFLIGHT` before any production replication dispatch.
