# R1 STEP06A — provider configuration readiness preflight

Status: PREPARE_ONLY / mandatory gate before STEP05A provider write  
Authority: NON-AUTHORITATIVE readiness only

## Goal

STEP06 isolated provider credentials and provider execution, but object-level COMPLIANCE retention alone does not prove the surrounding provider bucket is configured safely. STEP06A makes bucket configuration a mandatory fail-closed gate immediately before provider replication/reuse.

No readiness receipt establishes R2. It only permits STEP05A to attempt a non-authoritative provider candidate.

## Mandatory research before implementation

### AWS Object Lock does not neutralize lifecycle/delete-marker behavior

Amazon S3 documents that Object Lock protects concrete object versions. Lifecycle policies continue to run normally on protected objects and can place delete markers. A simple delete likewise creates a current delete marker even when the underlying version is COMPLIANCE-locked.

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

AWS IAM policy simulator is useful but AWS explicitly warns that simulation results can differ from the live environment and do not model every policy/control plane identically. It is therefore not used as the sole proof that a live recovery writer lacks destructive permissions.

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

S3 documentation confirms version-specific GET requires `s3:GetObjectVersion`, Object Lock retention writes require `s3:PutObjectRetention`, and lifecycle/Object Lock/versioning reads have separate bucket-read permissions.

Sources:
- https://github.com/aws-actions/configure-aws-credentials
- https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_testing-policies.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html

### Backblaze B2 exposes lifecycle + Object Lock through `b2_list_buckets`

Current B2 does not expose a capability named `readBucketLifecycleRules`. `b2_list_buckets` returns bucket lifecycle rules directly. For a bucket-restricted key, the request must name that bucket.

Object Lock configuration in the same bucket response is readable only with `readBucketRetentions`.

STEP06A therefore requires the runtime writer key to have exactly the file capabilities needed by STEP05A plus read-only readiness capabilities:

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

`.github/workflows/r1-live-two-domain-orchestration.yml` now enforces the gate in the same secret-bearing provider step:

AWS:
`OIDC -> restricted inline session -> read bucket config -> STEP06A validate -> STEP05A`

B2:
`authorize short-lived app key -> b2_list_buckets -> STEP06A validate -> STEP05A`

Readiness receipts are uploaded only after provider credentials leave scope.

## Strict nonclaims

- no provider environment or credential is created by this step;
- no AWS/B2 API is called by PR CI;
- no live bucket readiness is claimed;
- no production object is written;
- no source attestation is verified;
- no Supabase observation is inserted;
- no R2/R3 proof or persisted seal is created.

## Mandatory post-step research before merge

After implementation CI, re-check:
- whether the AWS inline session action/resource list is complete but minimal for the actual STEP05A calls;
- whether S3 lifecycle transitions or delete markers introduce any missed availability edge;
- whether B2 lifecycle/object-lock metadata is fully visible with the selected key capabilities;
- whether B2 `writeFiles`/hide semantics require an additional post-write current-version guard;
- whether readiness receipts should be bound cryptographically into the future source-attestation / R2-authority statement.
