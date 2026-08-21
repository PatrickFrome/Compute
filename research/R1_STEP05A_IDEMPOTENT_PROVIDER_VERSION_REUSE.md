# R1 STEP05A — idempotent provider-version reuse

Status: PREPARE_ONLY / retry-safety amendment  
Authority: NON-AUTHORITATIVE candidate generation only

## Why STEP05A exists

STEP05 uses a content-addressed object key and, on AWS S3, `If-None-Match: *` to prevent accidental overwrite. That is correct for first creation, but it creates a workflow retry problem: if provider A succeeds and provider B fails, replaying the whole two-provider workflow must not blindly write provider A again, and AWS will correctly reject a duplicate current key with `412 Precondition Failed`.

The safe retry behavior is not “disable the conditional write.” It is:

1. keep the original create-if-absent contract for first creation;
2. on a retry, probe the current content-addressed object;
3. accept it only after binding to its concrete provider version;
4. verify metadata, COMPLIANCE retention, full materialized bytes, and local SHA-256;
5. otherwise fail closed.

## Research before implementation

### AWS conditional-write semantics

AWS documents that `If-None-Match: *` on `PutObject` succeeds only when no current object with the key exists. If a current object exists, S3 returns `412 Precondition Failed`. For versioned buckets the condition applies to the current version. Concurrent conditional writers are also resolved by allowing the first successful write and rejecting later ones.

Source:
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html

Adopted invariant: STEP05's `If-None-Match: *` is retained. STEP05A never turns an existing-object retry into an unconditional overwrite.

### Version-pinned metadata/readback

AWS documents that HEAD without an explicit `versionId` returns metadata for the most recent/current object version, while a specific `versionId` retrieves metadata for that exact version. The response includes the version ID.

Sources:
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/RetMetaOfObjVersion.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html

Backblaze B2's S3-compatible Head Object operation likewise supports an optional `versionId` and returns `x-amz-version-id`; Backblaze explicitly recommends version pinning where multiple versions may exist.

Sources:
- https://www.backblaze.com/apidocs/s3-head-object
- https://www.backblaze.com/docs/cloud-storage-call-the-s3-compatible-api

Adopted retry contract:

`HEAD current -> require VersionId -> require project metadata -> GetObjectRetention(VersionId) -> GET(VersionId) -> local SHA-256`

No ETag is promoted to content authority.

## Implementation contract

`controller/r1/idempotent_exact_ciphertext_replication.py` wraps STEP05 and has two paths.

### Existing current version

The current object is reusable only when all checks pass:

- exact content-addressed key derived from STEP04 ciphertext SHA-256;
- non-null current `VersionId`;
- `ContentLength` equals the STEP04 ciphertext byte count;
- provider metadata `metaengine-sha256` equals the ciphertext SHA-256;
- provider metadata `metaengine-contract` equals `h205f22-r1-v1`;
- version-specific retention is `COMPLIANCE` and at least as long as requested;
- full GET of that exact version materializes locally;
- STEP02 recomputes SHA-256 and byte count over materialized bytes;
- resulting readback receipt is `VERIFIED` with `COMPLIANCE_NON_SHORTENABLE` retention.

A valid reuse result is marked:

- `replication.mode=REUSED_EXISTING_VERSION`;
- `new_provider_write=false`.

### Missing current version

If HEAD reports no current object, STEP05 runs unchanged. Its conditional-write and version-pinned readback behavior remain authoritative for the provider candidate. The wrapper only adds:

- `replication.mode=CREATED_NEW_VERSION`;
- `new_provider_write=true`.

### Create race

If the create path fails after an initial “missing” probe, STEP05A probes current state once more. A concurrently created object is accepted only if it passes the exact same existing-version verification. Otherwise the original failure propagates.

## Security and authority boundary

STEP05A does not contain credentials, provider account secrets, Supabase access, or DB mutation. It does not weaken source provenance requirements introduced after STEP04.

Every result remains:

- `canonical=false`;
- `authority_effect=false`;
- `source_attestation_verified=false`;
- `r2_proven=false`;
- `r3_proven=false`;
- `persisted_seal_allowed=false`.

## CI plan

The PR gate runs:

1. new adversarial retry/reuse tests;
2. the full original STEP05 provider-adapter regression suite;
3. static credential and authority checks;
4. a proof that PR CI contains no provider execution trigger or OIDC permission.

Adversarial cases include:

- valid AWS existing version reuse without PUT;
- valid B2 existing version reuse;
- missing object delegates to original create path;
- wrong provider metadata is rejected;
- corrupt materialized GET bytes are rejected;
- a create race can recover only through a fully verified existing version.

## Post-step research after implementation

### Delete markers are an explicit “missing current object” state

AWS documents that when the current version is a delete marker, unversioned `HeadObject`/`GetObject` behaves as if the object were deleted. HEAD identifies the delete-marker state and normal reads return a not-found response. A protected retained data version still exists underneath the marker. AWS also documents that a simple `DeleteObject` in a versioned bucket inserts a new delete marker rather than permanently deleting a retained version.

Sources:
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeleteMarker.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html

Backblaze B2 has the same relevant S3-compatible model: deleting by key without a `versionId` creates a delete marker that becomes current. Its native model calls this a hide marker; a download by name then returns 404 while historical versions remain addressable by version/file ID.

Sources:
- https://www.backblaze.com/apidocs/s3-delete-object
- https://www.backblaze.com/docs/cloud-storage-file-versions

Adopted result: STEP05A treats a current delete/hide marker as “no reusable current data object.” A later conditional/new upload may create a new current version. The controller must never guess which hidden historical version to resurrect; historical reuse is allowed only when an explicit version identity is already part of trusted evidence.

### Recovery credentials should not be able to create delete/hide state

Object Lock protects retained versions against permanent deletion, but AWS explicitly notes that an unversioned delete request can still add a delete marker above a protected version. AWS recommends explicit denial of `s3:DeleteObject`, `s3:DeleteObjectVersion`, and lifecycle-configuration mutation where deletion must be prevented.

Sources:
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeletingObjects.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/troubleshooting-versioning.html

Adopted live-plane requirement: the dedicated recovery writer role/key must not have delete, delete-version, lifecycle-mutation, or Object-Lock-bypass authority. STEP06 environment preflight must treat provider policy configuration as a separate prerequisite rather than assuming COMPLIANCE retention alone prevents a current delete marker.

### B2 lifecycle policy is part of the continuity configuration

Backblaze lifecycle rules can automatically hide current files and delete older versions. B2's S3-compatible lifecycle representation maps hide to S3 `Expiration` and prior-version deletion to `NoncurrentVersionExpiration`.

Sources:
- https://www.backblaze.com/docs/cloud-storage-lifecycle-rules
- https://www.backblaze.com/apidocs/s3-get-lifecycle-configuration

Adopted live-plane requirement: the recovery prefix must have lifecycle settings reviewed so it cannot be automatically hidden or have retained evidence versions removed before the intended continuity horizon. A short-lived object application key must not have bucket-management capability to change those rules.

### Serialize live attempts instead of relying on idempotency alone

GitHub Actions concurrency guarantees at most one running workflow/job per concurrency group. Current GitHub Actions also supports `queue: max`, allowing up to 100 pending runs rather than replacing an older pending run. `cancel-in-progress` is not needed for durable writes and should remain false/omitted for this path.

Source:
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency

Adopted STEP06 requirement: live two-domain orchestration will use a concurrency key bound to the source recovery artifact identity and `queue: max`, so attempts are serialized rather than canceled while a provider write/readback is active.

### Provider-side policy hardening remains additive

AWS can enforce `If-None-Match` on writes with bucket policy conditions. This is a useful independent provider-side guard in addition to the client controller.

Source:
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html

Adopted future infrastructure requirement: AWS recovery-bucket policy should require conditional first writes for the recovery prefix and separately deny destructive actions to the recovery execution role. B2 receives equivalent least-privilege enforcement through the scoped application-key capabilities plus reviewed lifecycle configuration.

## Strict nonclaims

- no production S3/B2 object is created by this PR;
- no live retry is claimed;
- no provider credentials are used;
- no continuity observation is inserted into Supabase;
- no R2/R3 proof or H47C seal is created.

## Required next semantic step

`R1 STEP06 — isolated live two-domain orchestration preparation`

STEP06 must consume STEP05A rather than raw STEP05, preflight existing protected GitHub environments before referencing them, isolate AWS OIDC and B2 credentials into separate jobs, serialize attempts by source artifact identity, and assemble a credential-free two-domain quorum candidate that remains non-authoritative until the separate source-attestation gate is verified.
