# R1 STEP06A — provider configuration readiness preflight

Status: PREPARE_ONLY / mandatory gate before STEP05A provider write  
Authority: NON-AUTHORITATIVE readiness only

## Goal

STEP06 isolated provider credentials and provider execution, but object-level COMPLIANCE retention alone does not prove the surrounding provider bucket is configured safely. STEP06A makes bucket configuration a mandatory fail-closed gate immediately before provider replication/reuse.

No readiness receipt establishes R2. It only permits STEP05A to attempt a non-authoritative provider candidate.

## Mandatory research before implementation

### AWS Object Lock does not neutralize lifecycle/delete-marker behavior

Amazon S3 documents that Object Lock protects concrete object versions. Lifecycle policies continue to function on protected objects and can place delete markers. A simple delete likewise creates a current delete marker even when the underlying version is COMPLIANCE-locked.

Therefore `ObjectLockEnabled=Enabled` alone is insufficient for the recovery prefix. STEP06A requires:

- bucket versioning `Enabled`;
- bucket Object Lock `Enabled`;
- no enabled lifecycle rule that may apply to `h205f22/r1/sha256/` and performs current/noncurrent expiration or transition actions.

Rules with uncertain/tag-only/size-only filters are treated conservatively as potentially applicable. A rule that affects only incomplete multipart uploads is not considered a completed-object durability conflict.

Sources:
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html

### AWS session policy is a stronger destructive-permission ceiling than simulator-only evidence

AWS IAM policy simulation is useful but AWS explicitly warns that simulation results can differ from the live environment and do not model every control plane identically. It is therefore not used as the sole proof that a live recovery writer lacks destructive permissions.

`aws-actions/configure-aws-credentials` v6.2.3 supports an inline session policy that further restricts the assumed role. STEP06A uses a generated exact policy as the live session ceiling.

Bucket-read actions:
- `s3:GetBucketVersioning`
- `s3:GetBucketObjectLockConfiguration`
- `s3:GetLifecycleConfiguration`
- `s3:ListBucket`

Recovery-prefix object actions:
- `s3:GetObject`
- `s3:GetObjectVersion`
- `s3:GetObjectRetention`
- `s3:PutObject`
- `s3:PutObjectRetention`

Explicit session denies include:
- `s3:DeleteObject`
- `s3:DeleteObjectVersion`
- `s3:PutLifecycleConfiguration`
- `s3:PutBucketVersioning`
- `s3:PutBucketObjectLockConfiguration`
- `s3:BypassGovernanceRetention`
- bucket-policy mutation.

The object allow is scoped only to:

`arn:aws:s3:::<bucket>/h205f22/r1/sha256/*`

Sources:
- https://github.com/aws-actions/configure-aws-credentials
- https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_testing-policies.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html

### Backblaze B2 exposes lifecycle + Object Lock through `b2_list_buckets`

Current B2 does not expose a capability named `readBucketLifecycleRules`. `b2_list_buckets` returns bucket lifecycle rules directly. For a bucket-restricted key, the request must name that bucket.

Object Lock configuration in the same bucket response is readable with `readBucketRetentions`.

STEP06A therefore requires the runtime writer key to have exactly the file capabilities needed by STEP05A plus read-only readiness capabilities.

Required:
- `readFiles`
- `writeFiles`
- `readFileRetentions`
- `writeFileRetentions`
- `listBuckets`
- `readBucketRetentions`

Optional:
- `listFiles`

Anything else is rejected, including `deleteFiles`, `bypassGovernance`, `writeBuckets`, `writeBucketRetentions`, or account-administration capabilities.

The key remains restricted to one bucket, exact prefix `h205f22/r1/sha256/`, and expiry no more than 24 hours.

B2 bucket readiness requires:
- exact expected bucket/account;
- private bucket (`allPrivate`);
- Object Lock readable and enabled;
- no lifecycle rule whose prefix overlaps the recovery prefix and hides/deletes objects.

Sources:
- https://www.backblaze.com/apidocs/b2-list-buckets
- https://www.backblaze.com/apidocs/b2-authorize-account
- https://www.backblaze.com/docs/cloud-storage-enable-object-lock-with-the-native-api
- https://www.backblaze.com/docs/cloud-storage-application-key-capabilities

## Implementation

`controller/r1/provider_configuration_readiness.py`:
- generates and validates the exact AWS inline session policy;
- validates AWS versioning/Object Lock/lifecycle snapshots;
- validates B2 runtime authorization scope, expiry, bucket metadata, Object Lock and lifecycle rules;
- emits self-hashed non-authoritative readiness receipts.

`tests/test_r1_provider_configuration_readiness.py` adversarially covers:
- exact AWS session-policy shape;
- suspended versioning;
- missing Object Lock;
- overlapping AWS lifecycle rules;
- conservative unknown/tag filter handling;
- tampered AWS session policy;
- exact B2 scope/capabilities;
- long-lived/broad B2 keys;
- unreadable/disabled B2 Object Lock;
- B2 lifecycle overlap and public bucket rejection.

`.github/workflows/r1-live-two-domain-orchestration.yml` enforces the gate in the same secret-bearing provider step.

AWS:
`OIDC -> restricted inline session -> read bucket config -> STEP06A validate -> STEP05A`

B2:
`authorize short-lived app key -> b2_list_buckets -> STEP06A validate -> STEP05A`

Readiness receipts are uploaded only after provider credentials leave scope.

## Mandatory post-step research — completed before merge

### 1. AWS action set is complete for the actual STEP05A call graph

Current AWS documentation confirms the distinction used by the generated policy:

- current `HeadObject` requires `s3:GetObject`;
- requesting a specific version requires the relevant version read permission, and version-specific `GetObject` requires `s3:GetObjectVersion`;
- `GetObjectRetention` and `PutObjectRetention` use their own Object Lock permissions;
- `PutObject` remains required for the actual object creation;
- `s3:ListBucket` determines whether a missing current key can be distinguished as 404 rather than 403.

STEP05A depends on that last distinction because a verified missing current object is what selects the conditional first-write path. For that reason `s3:ListBucket` remains a bucket-level **read** on the dedicated recovery bucket rather than adding an unverified prefix condition that might turn a legitimate missing-key probe into AccessDenied. Object data remains prefix-scoped.

Sources:
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObjectRetention.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html

### 2. Blocking both lifecycle expiration and transitions is deliberately stricter than WORM alone

Object Lock survives storage-class transitions, and a protected retained version cannot be permanently removed by lifecycle expiration while its retention is active. However:

- current-version expiration can create a delete marker, changing name-based availability;
- transitions can move recovery bytes to storage classes with materially different retrieval behavior;
- lifecycle actions may already be scheduled when configuration changes occur.

R1 is a continuity plane, not merely a deletion-resistance proof. STEP06A therefore deliberately rejects enabled lifecycle transition/expiration rules that can affect the recovery prefix. This is stricter than the minimum Object Lock guarantee and is intentional for immediate recoverability.

Sources:
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-transition-general-considerations.html

### 3. B2 lifecycle and Object Lock metadata are visible with the selected readiness capabilities

Current Backblaze documentation confirms:

- `listBuckets` permits `b2_list_buckets`; for a bucket-restricted key the request must name the allowed bucket;
- `b2_list_buckets` returns lifecycle rules;
- `readBucketRetentions` makes `fileLockConfiguration.value` readable;
- no separate lifecycle-read capability is required or defined.

The runtime key therefore does not need broad bucket-write authority to inspect readiness.

Sources:
- https://www.backblaze.com/apidocs/b2-list-buckets
- https://www.backblaze.com/docs/cloud-storage-application-key-capabilities
- https://www.backblaze.com/docs/cloud-storage-enable-object-lock-with-the-native-api

### 4. B2 hide/current-version races do not change the R2 durability identity

Backblaze documents that `b2_hide_file` creates a hide marker as the newest version, causing download-by-name to return 404. Older upload versions remain versioned and can be addressed explicitly. The S3-compatible API similarly exposes version IDs.

The R1 durability identity is therefore **the concrete retained VersionId + full version-pinned materialized readback**, not perpetual current-name visibility. Adding a post-write “must still be current” check would measure an alias that can change immediately after the check and would not strengthen long-term WORM durability.

STEP06A instead blocks lifecycle rules that would systematically hide/delete recovery versions, while STEP05A continues to record and verify the exact provider version. A future restore path must use the recorded version ID rather than rely only on the object name.

Sources:
- https://www.backblaze.com/docs/cloud-storage-file-versions
- https://www.backblaze.com/apidocs/b2-list-file-versions
- https://www.backblaze.com/apidocs/b2-hide-file
- https://www.backblaze.com/docs/cloud-storage-s3-compatible-api-bucket-versions

### 5. Readiness evidence must be bound into final R2 authority, but not into the earlier source attestation

The source attestation identified after STEP04 establishes who produced/approved the encrypted source artifact. Provider readiness happens later and cannot honestly be retroactively included in that earlier causal statement.

The final R2 authority statement must therefore be a later in-toto/DSSE evidence binding whose subject is the exact ciphertext digest and whose predicate binds, at minimum:

- verified source-attestation bundle digest;
- AWS readiness receipt SHA-256;
- B2 readiness receipt SHA-256;
- AWS provider-result SHA-256 and concrete VersionId;
- B2 provider-result SHA-256 and concrete VersionId;
- exact source workflow/run/head identity;
- semantic checkpoint/canonical digest applicable at authority time.

Sigstore's in-toto attestation support signs DSSE statements with explicit subjects/digests and supports policy validation over the predicate. Sigstore bundles carry the verification material required to validate signatures and transparency-log inclusion. Verification must pin signer identity and OIDC issuer rather than accepting an arbitrary valid Sigstore identity.

Sources:
- https://docs.sigstore.dev/cosign/verifying/attestation/
- https://docs.sigstore.dev/cosign/verifying/verify/
- https://docs.sigstore.dev/about/bundle/

This final evidence-binding step is separate from STEP06A and remains a prerequisite before any Supabase R2 authority transition.

## Strict nonclaims

- no provider environment or credential is created by this step;
- no AWS/B2 API is called by PR CI;
- no live bucket readiness is claimed;
- no production object is written;
- no source attestation is verified;
- no final R2 evidence-binding attestation exists yet;
- no Supabase observation is inserted;
- no R2/R3 proof or persisted seal is created.

## Required next after merge

Before the first live provider write, the remaining missing prerequisite is the trusted recovery-source workflow and its source attestation. After actual provider readbacks, a separate final R2 evidence-binding attestation must bind source provenance, both readiness receipts and both version-pinned provider results before DB authority is considered.
