# R1 STEP06 — isolated live two-domain orchestration preparation

Status: PREPARE_ONLY / live execution wiring  
Authority: NON-AUTHORITATIVE provider candidate assembly only

## Research before implementation

### GitHub protected environments

GitHub environment protection rules gate jobs before environment secrets become available. Required reviewers may use `prevent_self_review`; dynamic `jobs.<job_id>.environment.name` supports the `needs` context.

STEP06 therefore does not blindly reference provider environments. A metadata-only preflight first reads and validates the already-existing environments, then emits their fixed names for dependent provider jobs.

Required environments:
- `r1-aws-durability-proof`
- `r1-b2-durability-proof`

Required properties:
- required reviewers present;
- `prevent_self_review=true`;
- deployment branch policy present;
- live dispatch restricted to `refs/heads/main`.

The workflow never creates or modifies environments.

Sources:
- https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- https://docs.github.com/en/rest/deployments/environments
- https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/accessing-contextual-information-about-workflow-runs

### AWS credential isolation

STEP06 reuses the existing project OIDC pattern and pinned action:

`aws-actions/configure-aws-credentials@e6de054238d6b7531b4efff3b6587d9aade6a06c`

The action contract supports `output-env-credentials:false` and `output-credentials:true`. Temporary AWS credentials are therefore supplied only to the replication step from action outputs and are not exported into the job environment for later validation/artifact-publication steps.

The AWS job alone has `id-token: write`; B2 and quorum jobs do not.

Sources:
- https://docs.github.com/en/actions/concepts/security/openid-connect
- https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws
- https://github.com/aws-actions/configure-aws-credentials/blob/e6de054238d6b7531b4efff3b6587d9aade6a06c/action.yml

### B2 runtime-key scope

Backblaze `b2_authorize_account` v4 returns actual runtime authorization scope: account, bucket(s), capabilities, name prefix, application-key expiration and S3 endpoint. STEP06 validates this provider-returned scope instead of trusting a secret/variable name.

The execution key must be restricted to one expected bucket and prefix:

`h205f22/r1/sha256/`

Required file capabilities for STEP06:
- `readFiles`
- `writeFiles`
- `readFileRetentions`
- `writeFileRetentions`

The key must be short-lived, must not include `deleteFiles` or `bypassGovernance`, and must not include bucket-write administration capabilities. Raw key material and authorization tokens are not persisted as evidence.

Sources:
- https://www.backblaze.com/apidocs/b2-authorize-account
- https://www.backblaze.com/docs/cloud-storage-application-keys
- https://www.backblaze.com/docs/cloud-storage-application-key-capabilities
- https://www.backblaze.com/docs/cloud-storage-s3-compatible-app-keys

### Immutable artifact handoff

Selected immutable actions:
- `actions/upload-artifact` v7.0.1 at `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`
- `actions/download-artifact` v8.0.1 at `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c`

Upload uses direct single-file artifacts (`archive:false`). Download is pinned by immutable artifact ID, repository and source run, and uses fatal digest mismatch behavior.

Expected source artifacts:
- `r1-recovery-ciphertext.age`
- `r1-recovery-envelope-receipt.json`

Trusted source workflow path is fixed to:

`.github/workflows/r1-live-recovery-source.yml`

That workflow does not yet exist; STEP06 cannot create production provider bytes by itself.

### Source-run and retry safety

Preflight binds source evidence to repository ID `1341371143`, `PatrickFrome/Compute`, `main`, successful `workflow_dispatch`, exact workflow path, source SHA and immutable artifact IDs.

Provider execution consumes STEP05A `idempotent_exact_ciphertext_replication.py`, not raw STEP05. Existing versions are reusable only after version-pinned COMPLIANCE retention, provider metadata, full GET and local SHA-256 verification.

Live attempts are serialized by source-run + ciphertext-artifact identity with GitHub concurrency `queue: max`; in-progress provider writes are not cancelled by newer retry requests.

## Implemented STEP06 contract

`controller/r1/live_two_domain_orchestration_guard.py` validates:
- source run and immutable source artifact binding;
- pre-existing protected environments;
- B2 runtime key scope/expiry;
- STEP05A provider result self-hashes and STEP02 readback receipts;
- provider/operator/failure-domain independence;
- strong COMPLIANCE retention in both domains;
- exact ciphertext SHA-256/byte identity across providers.

`.github/workflows/r1-live-two-domain-orchestration.yml` provides four trust zones:
1. metadata-only preflight;
2. AWS protected environment + OIDC;
3. B2 protected environment + application key;
4. credential-free quorum evaluation.

The resulting quorum is still NON-AUTHORITATIVE. Source authenticity remains a separate mandatory DSSE/in-toto/Sigstore gate before any Supabase R2 authority.

## Mandatory post-step research — completed before merge

### 1. Dynamic environment behavior is supported

GitHub officially permits `needs` context in `environment.name`. Environment protection/approval occurs before environment secrets are released. The preflight-output pattern is therefore supported and retains the intended human approval boundary.

### 2. Artifact digests are defense in depth, not R2 authority

Direct upload/download supplies an additional GitHub-controlled handoff integrity check. It does not replace project content authority: STEP04 envelope validation still checks ciphertext before provider write; STEP05A still performs full provider GET and STEP02 local SHA-256 after write/reuse.

### 3. AWS output-only credentials are preferable to post-step cleanup

The pinned AWS action supports output-only credentials. STEP06 uses them only in the replication step. Subsequent validation and artifact upload have no AWS credentials in their environment.

### 4. B2 `writeFiles` necessarily includes native hide authority

Current Backblaze capability documentation explicitly maps `writeFiles` to upload operations **and `b2_hide_file`**. There is no separate “upload but never hide” capability.

Therefore STEP06 compensates with:
- exact bucket + prefix restriction;
- short key expiry;
- no `deleteFiles`;
- no `bypassGovernance`;
- no bucket-write administration;
- concrete COMPLIANCE-retained versions;
- version-pinned full readback;
- STEP05A semantics that never promote a hidden historical version by inference.

Sources:
- https://www.backblaze.com/docs/cloud-storage-application-key-capabilities
- https://www.backblaze.com/apidocs/b2-hide-file

### 5. Correction discovered by post-step research: there is no current `readBucketLifecycleRules` capability

Backblaze's current application-key capability set does **not** expose a capability named `readBucketLifecycleRules`. Lifecycle rules are part of bucket metadata returned by `b2_list_buckets`; a bucket-scoped read-only key can therefore use `listBuckets` to inspect lifecycle rules. Object Lock bucket configuration is separately readable with `readBucketRetentions`.

This correction is important for STEP06A: it must require/use `listBuckets` for B2 lifecycle inspection and `readBucketRetentions` for Object Lock inspection. It must not invent a nonexistent lifecycle capability.

Sources:
- https://www.backblaze.com/docs/cloud-storage-application-key-capabilities
- https://www.backblaze.com/apidocs/b2-create-key

### 6. Provider bucket configuration is the next mandatory gate

Before any first production replication, STEP06A must fail closed on provider configuration.

AWS readiness must verify at least:
- versioning enabled;
- Object Lock enabled;
- lifecycle policy reviewed for the recovery prefix;
- writer role/policy does not permit destructive delete, bypass or lifecycle mutation;
- conditional-write policy remains compatible with STEP05.

B2 readiness must verify at least:
- exact bucket/endpoint;
- Object Lock enabled (`readBucketRetentions`);
- lifecycle rules for the recovery prefix (`listBuckets` / bucket metadata);
- short-lived bucket+prefix-scoped writer key;
- no `deleteFiles`, `bypassGovernance`, or bucket-write capabilities.

### 7. Concurrency and retry semantics remain complementary

`queue: max` avoids replacing pending attempts, while STEP05A allows a partial-success retry to reuse a previously materialized provider version only after complete verification. Neither property weakens first-write safety.

## Strict nonclaims

- trusted source workflow does not yet exist;
- required provider environments/secrets/variables are not created by this PR;
- no production ciphertext is supplied;
- PR CI performs no AWS/B2 provider call;
- no provider object/readback is claimed;
- no source attestation is verified;
- no Supabase observation is inserted;
- no R2/R3 proof or H47C seal is created.

## Required next

`STEP06A_PROVIDER_CONFIGURATION_READINESS_PREFLIGHT` before any production replication dispatch.
