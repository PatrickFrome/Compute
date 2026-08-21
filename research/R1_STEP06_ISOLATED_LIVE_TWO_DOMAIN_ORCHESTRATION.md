# R1 STEP06 — isolated live two-domain orchestration preparation

Status: PREPARE_ONLY / live execution wiring  
Authority: NON-AUTHORITATIVE provider candidate assembly only

## Research before implementation

### 1. GitHub environments must be verified before they are referenced

GitHub environment protection rules gate a job before the job is sent to a runner and before environment secrets become available. Required reviewers can be configured with `prevent_self_review` so the actor who initiated the workflow cannot approve their own protected job.

Current GitHub REST documentation allows anyone with repository read access to `GET /repos/{owner}/{repo}/environments/{environment_name}`; fine-grained tokens need only Actions read permission. The response exposes protection rules and deployment branch policy.

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

The existing W1 provider controller already establishes the project convention:

- separate protected environment;
- job-level `id-token: write` only where AWS credentials are needed;
- `aws-actions/configure-aws-credentials` pinned by immutable commit;
- account allowlist;
- 900-second role session;
- no long-lived AWS access keys in repository secrets.

STEP06 reuses the current pinned action commit:

`aws-actions/configure-aws-credentials@e6de054238d6b7531b4efff3b6587d9aade6a06c`

GitHub's current OIDC documentation binds environment-referencing jobs into the `sub` claim. The AWS trust policy must pin this repository's immutable owner/repository identity and the dedicated R1 environment, plus audience `sts.amazonaws.com`.

Sources:
- https://docs.github.com/en/actions/concepts/security/openid-connect
- https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws

### 3. B2 scope is verified from the provider, not inferred from a secret name

Backblaze `b2_authorize_account` v4 returns the actual application-key authorization surface, including:

- account ID;
- allowed bucket(s);
- capabilities;
- `namePrefix`;
- application-key expiration timestamp;
- S3 API endpoint.

STEP06 requires a single expected bucket, exact prefix:

`h205f22/r1/sha256/`

and at minimum:

- `readFiles`;
- `writeFiles`;
- `readFileRetentions`;
- `writeFileRetentions`.

Unexpected destructive/bucket-administration capabilities fail closed. The key must have more than ten minutes but no more than 24 hours remaining. Its account ID is hashed locally and compared to the configured account-scope digest. The raw authorization response, authorization token and application key are never uploaded as evidence.

Backblaze documents that the account master key is not valid for the S3-compatible API; a normal application key must be used.

Sources:
- https://www.backblaze.com/apidocs/b2-authorize-account
- https://www.backblaze.com/docs/cloud-storage-application-keys
- https://www.backblaze.com/apidocs/introduction-to-the-s3-compatible-api

### 4. GitHub artifact transfer is integrity-checked and commit-pinned

Current official action releases selected:

- `actions/upload-artifact` v7.0.1 at `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`;
- `actions/download-artifact` v8.0.1 at `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c`.

Upload v7 supports direct single-file artifacts with `archive:false` and exposes artifact ID + SHA-256 digest. Download v8 defaults digest mismatches to an error and supports immutable artifact-ID download and cross-run retrieval with repository/run binding.

Sources:
- https://github.com/actions/upload-artifact/tree/043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
- https://github.com/actions/download-artifact/tree/3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c

STEP06 never searches for an artifact by a loose name during provider execution. The caller supplies immutable source artifact IDs; preflight validates their names, digests, source workflow run, repository ID, branch and source SHA before any provider job becomes eligible.

Expected future source artifacts:

- `r1-recovery-ciphertext.age`
- `r1-recovery-envelope-receipt.json`

The trusted source workflow is intentionally fixed to:

`.github/workflows/r1-live-recovery-source.yml`

That workflow is a later semantic step and does not exist yet. Therefore merging STEP06 cannot itself perform a production provider replication.

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

Provider credentials are unavailable to artifact upload steps after the provider command. B2 secrets are scoped to the single authorization+replication step. AWS credentials are explicitly blanked for subsequent artifact-publication steps.

### 8. Live attempts are serialized by source artifact identity

Current GitHub Actions concurrency supports a workflow/job concurrency group with one active run and, using `queue: max`, up to 100 pending runs rather than replacing a previous pending run. Durable provider writes must not be canceled midway merely because another operator requested a retry.

Source:
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency

STEP06 live jobs share a concurrency group derived from the source run ID and immutable ciphertext artifact ID, with `queue: max` and no `cancel-in-progress:true`.

## Planned implementation

`controller/r1/live_two_domain_orchestration_guard.py` validates:

- source run and immutable source artifact binding;
- pre-existing protected environments;
- actual B2 application-key scope/expiry;
- STEP05A provider results, their self-hashes and STEP02 readback receipts;
- two independent provider/operator/failure domains;
- two strong COMPLIANCE retention domains;
- identical ciphertext SHA-256/bytes across providers.

`.github/workflows/r1-live-two-domain-orchestration.yml` provides:

- PR-only contract tests with no provider execution;
- explicit `workflow_dispatch` live preflight;
- separate AWS and B2 environment jobs;
- direct single-file provider result artifacts;
- a credential-free quorum job.

The resulting quorum is still a candidate. It does **not** establish source authenticity. The separate DSSE/in-toto/Sigstore source-attestation gate identified after STEP04 remains mandatory before any Supabase R2 authority.

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

## Mandatory post-step research

After implementation and CI, re-check:

- dynamic environment evaluation and approval behavior;
- whether direct-file artifact v7/v8 semantics preserve the exact file digest across jobs/runs as intended;
- AWS credential cleanup after `configure-aws-credentials`;
- B2 `b2_authorize_account` capability naming required by Object Lock operations;
- GitHub concurrency `queue:max` behavior for workflow_dispatch;
- whether preflight should additionally verify provider bucket lifecycle/configuration via read-only provider APIs before enabling writes.
