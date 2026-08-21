# R1 STEP05 — AWS S3 + Backblaze B2 exact-ciphertext replication

Status: PREPARE_ONLY / provider execution adapter  
Authority: NON-AUTHORITATIVE candidate generation only

## Research before implementation

### AWS S3 conditional creation

Amazon S3 documents `If-None-Match: *` for `PutObject` as a conditional write that fails when the key already exists. It is usable with SigV4 and provides an atomic create-if-absent guard for the current object key. AWS also supports bucket policies that require conditional writes.

Sources:
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html

Adopted: AWS targets use `--if-none-match "*"` in addition to content-addressed keys.

### Version-specific Object Lock COMPLIANCE

S3 Object Lock retention protects an **object version**. In COMPLIANCE mode the protected version cannot be overwritten or deleted even by the AWS account root user; retention mode cannot be changed and the period cannot be shortened. The retain-until date can be extended.

Sources:
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html

Adopted: every receipt pins the provider-returned `VersionId`, then verifies `GetObjectRetention` for that exact version before readback.

### Backblaze B2 S3-compatible Object Lock

Backblaze documents S3-compatible `put-object` with `--object-lock-mode COMPLIANCE` and a retain-until date. B2 COMPLIANCE retention cannot be removed by users and can only be extended by authorized clients. B2 S3 responses expose version IDs and version-specific retention operations.

Sources:
- https://www.backblaze.com/docs/cloud-storage-object-lock
- https://www.backblaze.com/docs/cloud-storage-enable-object-lock-with-the-s3-compatible-api
- https://www.backblaze.com/apidocs/s3-put-object-retention

### Deliberate asymmetry: no invented B2 conditional-write claim

Current Backblaze S3 `Put Object` documentation enumerates supported headers but does not establish the same `If-None-Match: *` create-if-absent contract documented by AWS. The controller therefore does **not** claim atomic conditional creation for B2.

This is safe because R2 object identity is version-specific:

- object key is content-addressed by ciphertext SHA-256;
- returned B2 `VersionId` is mandatory;
- retention verification is performed against that exact version;
- readback downloads that exact version;
- local SHA-256 over the downloaded bytes is the canonical content proof.

Sources:
- https://www.backblaze.com/apidocs/s3-put-object
- https://www.backblaze.com/docs/cloud-storage-call-the-s3-compatible-api

### ETag remains non-authoritative

Provider ETag and checksums are recorded only as auxiliary provider identity. STEP02 recomputes SHA-256 over full materialized bytes. Multipart/encryption/provider semantics must never promote ETag to the canonical content digest.

## Controller contract

Input:

1. exact STEP04 ciphertext;
2. hardened STEP04 envelope receipt;
3. non-secret target descriptor;
4. an external AWS CLI v2-compatible executable whose credentials are supplied by its runtime environment.

Target descriptor contains no secrets. It names:

- provider kind (`AWS_S3` or `BACKBLAZE_B2`);
- domain key;
- expected operator class;
- failure domain and independence basis;
- hashed account scope;
- bucket/region;
- B2 HTTPS S3 endpoint when applicable;
- retain-until date.

Execution sequence:

1. validate STEP04 receipt + exact ciphertext locally;
2. derive content-addressed key `h205f22/r1/sha256/<ciphertext_sha256>.age`;
3. `PutObject` exact local ciphertext with COMPLIANCE retention;
4. require returned `VersionId`;
5. `GetObjectRetention` for the exact version and require COMPLIANCE + requested-or-longer retention;
6. `HeadObject` for the exact version;
7. `GetObject` for the exact version to a fresh local temporary file;
8. feed that file and normalized descriptor into STEP02 verifier;
9. require locally computed SHA-256, exact byte count and strong retention classification;
10. emit only a non-authoritative provider readback candidate.

## Credential boundary

The Python controller never reads or serializes provider credentials. The external AWS CLI process obtains credentials from its normal runtime environment. Evidence stores only provider responses, version/object identity, hashed account scope and local readback results.

A later GitHub `workflow_dispatch` may bind each provider to its own protected environment/secrets. PR CI must never call real provider APIs.

## Provenance boundary from STEP04 post-research

Even two perfect provider readbacks do not establish sender/source authenticity. STEP05 result therefore keeps:

- `source_attestation_verified=false`;
- `source_attestation_required_before_authority=true`;
- `r2_proven=false`;
- `persisted_seal_allowed=false`.

Future DB authority must separately verify the DSSE/in-toto/Sigstore source attestation described by STEP04 post-research.

## Post-implementation research

### V1 single-PUT size scope

AWS documents a maximum of 5 GB for one `PutObject` operation; larger objects must use multipart upload. Backblaze likewise distinguishes normal/single uploads from its large-file/multipart path and supports multipart parts up to 5 GiB.

Sources:
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/upload-objects.html
- https://www.backblaze.com/docs/cloud-storage-files
- https://www.backblaze.com/apidocs/s3-create-multipart-upload

Adopted scope:

- STEP05 v1 is the **single-PUT provider adapter**;
- it is intended for encrypted recovery artifacts at or below the common 5 GB single-upload envelope;
- an over-limit provider request fails before any successful materialized-readback receipt can exist;
- large recovery artifacts require a distinct reviewed multipart step with part-level failure/retry/abort semantics and the same final full-object local SHA-256 readback requirement.

No multipart completion ETag may become content authority.

### Credential custody amplifier

AWS side: retain the earlier GitHub OIDC -> narrowly scoped AWS role pattern so long-lived AWS access keys are not needed.

Backblaze side: current B2 application keys can be limited by bucket, filename prefix, capabilities and `validDurationInSeconds`. For the S3-Compatible API, B2 `keyID` maps to `AWS_ACCESS_KEY_ID` and `applicationKey` maps to `AWS_SECRET_ACCESS_KEY`.

Sources:
- https://www.backblaze.com/apidocs/b2-create-key
- https://www.backblaze.com/docs/cloud-storage-application-keys
- https://www.backblaze.com/docs/cloud-storage-get-started-with-a-backblaze-integration

Adopted live-orchestration policy:

1. AWS live replication runs in its own protected job/environment using OIDC short-lived credentials.
2. B2 live replication runs in a different protected job/environment using a short-lived, bucket/prefix-scoped app key.
3. No job receives both provider credential sets.
4. Provider jobs emit only non-secret candidate artifacts.
5. A third credential-free job evaluates the two readback receipts and source-attestation status.
6. DB ingestion remains a later separately authorized step.

This separation preserves H44 independent-operator evidence at the execution boundary rather than merely recording two provider names after one credential-rich process handled both.

### Large-object next amplifier

For future artifacts above the single-PUT scope, implement an explicit multipart controller rather than silently switching behavior inside v1. That controller must preserve:

- immutable target version identity;
- COMPLIANCE retention on the completed object version;
- abort/cleanup of failed multipart uploads;
- bounded and deterministic part sizing;
- final full-object materialized GET and local SHA-256;
- the same external source-attestation gate before authority.

## Strict nonclaims

- no production provider credential is included;
- no production S3/B2 object is created by PR CI;
- no provider readback is claimed until live external execution exists;
- no Supabase observation is inserted;
- no R2/R3 proof or H47C seal is created.

## Required next semantic step

`R1 STEP06 — isolated live provider orchestration preparation`

Create two separate protected execution jobs (AWS OIDC and expiring B2 app key), plus a third credential-free quorum/attestation-validation job. PR context must continue to skip all live provider calls.
