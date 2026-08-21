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

## Strict nonclaims

- no production provider credential is included;
- no production S3/B2 object is created by PR CI;
- no provider readback is claimed until live `workflow_dispatch`/external execution exists;
- no Supabase observation is inserted;
- no R2/R3 proof or H47C seal is created.

## Required post-step research

After implementation/CI, re-check:

- AWS CLI behavior and output for versioned Object Lock PUT/GET;
- B2 S3-compatible version/retention response parity;
- checksum/streaming edge cases for large artifacts;
- options for short-lived B2 credentials or isolated secret custody;
- whether a two-provider workflow should use separate protected GitHub environments/jobs rather than a single process holding both credentials.
