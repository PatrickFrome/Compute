# R1 STEP05B — persist normalized provider-controller evidence

Status: PREPARE_ONLY / evidence-preservation hardening  
Authority: provider readback auditability only; no R2/R3 or seal authority

## Goal

Preserve the normalized provider response structures that produced each STEP05A provider result, rather than preserving only `provider_controller_evidence_sha256`.

This step was discovered during mandatory research-before STEP08. The planned final R2 evidence package must remain independently auditable after the originating GitHub Actions run and its artifacts are deleted. A hash of unavailable provider evidence is not sufficient for that purpose.

## Mandatory research before implementation

### Provider response structures are useful audit evidence but are not raw HTTP transcripts

Current AWS S3 / AWS CLI documentation confirms the relevant operations expose object/version/retention metadata as structured output:

- `PutObject` returns fields including `VersionId`, ETag and optional checksum/encryption metadata;
- `HeadObject` returns object metadata, content length, ETag, metadata and `VersionId` when versioning applies;
- `GetObjectRetention` returns `Retention.Mode` and `Retention.RetainUntilDate`;
- version-specific `GetObject` returns response metadata while the requested object bytes are materialized separately.

These structures do not constitute a raw signed HTTP transcript. STEP05B therefore names them **normalized provider-controller evidence** and does not make a stronger claim.

Sources:
- https://docs.aws.amazon.com/cli/latest/reference/s3api/put-object.html
- https://docs.aws.amazon.com/cli/latest/reference/s3api/head-object.html
- https://docs.aws.amazon.com/cli/latest/reference/s3api/get-object-retention.html

### Credentials must never be persisted

The provider credential path remains external to target/result configuration:

- AWS short-lived OIDC credentials are step-scoped by STEP06;
- B2 key material is step-scoped by STEP06;
- AWS CLI JSON response bodies contain service response metadata, not the request credential values;
- the evidence contract explicitly requires `credentials_embedded=false`.

STEP05B does not persist environment variables, Authorization headers, command stderr/debug output, or the credential-bearing process environment.

### Existing STEP05A is the production entry point

The live two-domain workflow already invokes `controller/r1/idempotent_exact_ciphertext_replication.py` for both AWS and B2. STEP05B therefore hardens this production wrapper rather than changing the lower-level STEP05 primitive API.

The wrapper supports two modes:

1. `CREATED_NEW_VERSION` — conditional/new provider write followed by version-pinned retention, HEAD and full GET;
2. `REUSED_EXISTING_VERSION` — current-object probe followed by version-pinned retention and full GET without a new provider write.

Both modes must preserve the normalized response evidence needed to reproduce the controller evidence hash.

## Implementation contract

Each STEP05A result now includes:

- `provider_controller_evidence` — canonical JSON object;
- `provider_controller_evidence_sha256` — SHA-256 over canonical evidence bytes;
- `result_sha256` — SHA-256 over the complete provider result, including the nested evidence.

For a created version the evidence contains:

- provider/domain/bucket/key/version identity;
- `put_response`;
- version-pinned `head_response`;
- `retention_response`;
- version-pinned `get_response`;
- conditional-create contract flags;
- `credentials_embedded=false`.

For reuse it contains:

- provider/domain/bucket/key/version identity;
- `head_current_response`;
- version-pinned `retention_response`;
- version-pinned `get_response`;
- `new_provider_write=false`;
- the original AWS conditional-create contract marker;
- `credentials_embedded=false`.

The validator requires evidence SHA, provider/domain/object/version identity, COMPLIANCE retention, exact mode semantics, response version consistency when a response carries `VersionId`, content length consistency and all authority/R2/R3/seal fields false.

## Why the base STEP05 primitive remains unchanged

`exact_ciphertext_replication_controller.py` remains a low-level primitive and continues to compute its controller evidence hash. STEP05A wraps that primitive for the actual live orchestration path. For a new version, STEP05A records the same normalized runner responses, reconstructs the exact evidence object and requires its SHA-256 to equal the hash emitted by STEP05 before persisting it.

For a reused version, STEP05A already constructs the evidence object itself and now persists that exact object.

This avoids changing two provider APIs at once while making the real production entry point evidence-complete.

## Adversarial requirements

Tests must prove:

- create mode persists PUT/HEAD/retention/GET evidence and exact version identity;
- reuse mode persists current HEAD/retention/GET evidence and no-write semantics;
- create-race fallback still persists the winning version evidence;
- AWS/B2 conditional-create distinctions remain unchanged;
- nested evidence hash mismatch fails closed;
- recomputing both evidence/result hashes cannot hide a forged version identity;
- recomputing hashes cannot change `credentials_embedded` to true;
- recomputing hashes cannot downgrade COMPLIANCE to GOVERNANCE;
- existing STEP05 and STEP06 orchestration regressions still pass.

## Strict nonclaims

- PR CI performs no AWS/B2 calls;
- no production object or readback is created;
- normalized CLI response structures are not claimed to be raw provider-signed HTTP evidence;
- ETag/provider checksums are not content authority;
- no source/provider environment or credential is created;
- no Supabase continuity observation is inserted;
- no R2/R3 proof or persisted seal is created;
- stale worker claims are not mutated.

## Mandatory research after implementation before merge

After independent CI, re-check and record:

1. whether any persisted response field can contain credentials, signed request headers, tokens or sensitive user-controlled material;
2. whether create/reuse evidence objects preserve enough information for later STEP08 audit without relying on the original GitHub run;
3. whether normalized response evidence must remain embedded in the provider result or become a separate artifact;
4. whether `GetObject`/`HeadObject` response `VersionId` semantics differ materially between AWS and B2 and require looser/tighter validation;
5. whether the future DB observation `evidence` JSON should carry the complete provider result/evidence package while readiness itself continues to depend only on immutable object/domain/observation rows;
6. whether STEP08 still requires any provider-side re-query after STEP05B.

Merge is forbidden until these findings are appended here and CI/Governance succeed again on the exact resulting head.
