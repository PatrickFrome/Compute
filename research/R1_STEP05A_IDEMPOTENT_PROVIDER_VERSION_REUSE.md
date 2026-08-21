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

## Strict nonclaims

- no production S3/B2 object is created by this PR;
- no live retry is claimed;
- no provider credentials are used;
- no continuity observation is inserted into Supabase;
- no R2/R3 proof or H47C seal is created.

## Required post-step research

After implementation and CI, re-check:

- delete-marker/current-version semantics for AWS versioned buckets;
- whether B2 “hide”/latest-version behavior introduces a retry ambiguity;
- whether provider bucket policies should deny delete/hide/version creation outside the dedicated recovery controller;
- whether orchestration should serialize attempts per ciphertext digest in addition to idempotent reuse.
