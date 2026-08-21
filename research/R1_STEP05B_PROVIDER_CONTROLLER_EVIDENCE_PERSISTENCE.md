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

### 1. Credential and metadata leakage boundary

The first independent STEP05B CI passed all functional tests and failed only because its static checker inspected its own assertion text. That checker was corrected by removing its own block from the string under inspection.

Current AWS `PutObject`, `HeadObject`, `GetObject` and `GetObjectRetention` outputs expose service/object metadata rather than request credentials. Backblaze documents the corresponding S3-compatible object-version and retention responses. Nevertheless, persisting arbitrary future provider response JSON without a bound would be unnecessarily permissive.

Post-research hardening therefore added:

- a 256 KiB maximum canonical evidence size;
- recursive rejection of credential/token-like response keys such as Authorization, access-key, secret-key, session-token, application-key and credential fields;
- strict object user-metadata allowlist containing only `metaengine-sha256` and `metaengine-contract`;
- exact expected metadata values bound to the ciphertext digest and H205F22 contract.

No value-based secret detector is claimed; the trust boundary is structural and the CLI is not executed with debug output capture.

Sources:
- https://docs.aws.amazon.com/cli/latest/reference/s3api/put-object.html
- https://docs.aws.amazon.com/cli/latest/reference/s3api/head-object.html
- https://www.backblaze.com/apidocs/s3-put-object
- https://www.backblaze.com/apidocs/s3-get-object-retention

### 2. Create/reuse evidence is sufficient after GitHub run deletion

For both production modes the provider result now carries the normalized evidence object itself, not only its digest:

- create: PUT + version-pinned HEAD + retention + GET responses;
- reuse: current HEAD identifying the reused version + version-pinned retention + GET responses.

The existing STEP02 readback receipt still contains the independently recomputed materialized SHA-256/size and retention grade. The nested controller evidence supplies the provider response context needed to audit which version and retention were observed.

Therefore deletion of the originating Actions run no longer destroys the only copy of provider controller evidence, provided STEP08 preserves the complete provider-result bytes.

### 3. Evidence remains embedded, not split into another artifact

A separate provider-controller-evidence artifact would add another mutable handoff/index relationship without improving the proof. Embedding the evidence in the provider result is stronger for packaging because:

- `provider_controller_evidence_sha256` binds the nested evidence independently;
- the complete `result_sha256` binds controller evidence and readback receipt atomically;
- the existing immutable direct provider-result artifact already transports that result.

STEP08 should therefore persist the complete provider-result bytes and reference the two internal hashes in its deterministic manifest.

### 4. AWS/B2 version semantics

AWS documents `VersionId` on PutObject and version-addressable Head/Get operations. Backblaze S3-compatible PutObject returns `x-amz-version-id`, and its Object Lock APIs accept a specific `versionId` for retention inspection.

STEP05B allows a response to omit `VersionId` only where the lower-level API can legitimately omit it, but when PUT/current HEAD/GET return a version it must agree with the result's pinned version. Create PUT and reuse current HEAD remain mandatory version sources.

No ETag equivalence-to-content claim is introduced.

Sources:
- https://docs.aws.amazon.com/cli/latest/reference/s3api/put-object.html
- https://docs.aws.amazon.com/cli/latest/reference/s3api/head-object.html
- https://www.backblaze.com/apidocs/s3-put-object
- https://www.backblaze.com/apidocs/s3-get-object-retention

### 5. Future DB observation evidence shape

The production DB state machine remains the authority boundary. `compute_continuity_readiness_h205f22()` evaluates immutable object/domain/latest-observation rows and freshness; it does not trust a JSON claim that says R2 is true.

The future STEP08 ingestion projection may carry the complete provider result inside `compute_continuity_observation_h205f22.evidence`, but that JSON is supporting audit material only. The observation row must still independently provide the expected object identity, domain key, VERIFIED status, observed SHA-256/bytes, persisted_at and readback_at required by the existing insert guard/readiness function.

### 6. Provider re-query after STEP05B

STEP08 does not need a second provider query merely to package or audit a still-current STEP05B result: the required provider responses and materialized readback receipt are now preserved.

This does **not** extend evidence freshness. Production R2 readiness currently uses a seven-day maximum readback age. If Supervisor ingestion or sealing occurs after the stored readback becomes stale, the evidence package cannot make it fresh; the provider must be materialized/read back again and a new immutable observation produced.

This distinction is intentional:

`evidence persistence != evidence freshness`.

## Post-research implementation amendments

Before merge the implementation was hardened to enforce:

- `MAX_PERSISTED_EVIDENCE_BYTES = 256 KiB`;
- recursive forbidden-sensitive-key rejection;
- exact expected user-metadata keys/values;
- evidence/result semantic validation after hashes are recomputed;
- adversarial tests for sensitive-key smuggling, unexpected user metadata and oversized evidence;
- a non-self-referential PR-only static checker.

Merge remains forbidden until STEP05B CI, the historical STEP05A workflow and Compute Fabric Governance all succeed again on the exact final head.
