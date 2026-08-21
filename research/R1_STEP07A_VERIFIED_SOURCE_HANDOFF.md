# R1 STEP07A — bind cryptographically verified source before provider credentials

Status: PREPARE_ONLY / mandatory orchestration gate  
Authority: source-provenance eligibility only; no provider or R2 authority

## Goal

Make the cryptographically verified STEP07 source receipt a mandatory, immutable input to the existing STEP06 orchestration **before** AWS/B2 protected environments and cloud credentials can become eligible.

STEP07A closes a deliberate historical gap: STEP06 was implemented before STEP07 existed, so it knew that source attestation was required but could not yet consume a verified source receipt. No live provider execution is permitted through the updated workflow unless this handoff succeeds.

## Mandatory research before implementation

### GitHub artifact metadata is sufficient for immutable same-run binding

The current GitHub Actions artifact REST response includes:

- artifact `id`;
- `name`;
- `size_in_bytes`;
- `expired`;
- SHA-256 `digest`;
- bound `workflow_run` metadata including run id, repository ids, branch and head SHA.

STEP07A therefore requires a new workflow-dispatch input:

`source_verification_artifact_id`

The selected artifact must be exactly:

`r1-recovery-source-verification.json`

and must belong to the same successful `workflow_dispatch` source run/head/repository as the ciphertext/envelope artifacts.

GitHub's artifact upload action publishes a SHA-256 digest, and download-artifact validates the downloaded artifact digest. STEP07A additionally validates the receipt's own canonical self-hash and its binding to the actual downloaded ciphertext/envelope bytes. The trust chain is intentionally redundant:

`artifact ID -> GitHub artifact digest -> downloaded bytes -> receipt self-hash -> ciphertext/envelope/source-run binding`.

Sources:
- https://docs.github.com/en/rest/actions/artifacts
- https://docs.github.com/en/actions/tutorials/store-and-share-data

### Consumer verification remains separated from provider credentials

GitHub artifact-attestation guidance states that signing alone is not a security benefit; consumers must verify provenance according to policy.

STEP07 already performs the cryptographic Sigstore/in-toto verification in a credential-free `verify-source` job and emits `r1-recovery-source-verification.json`.

STEP07A deliberately does **not** repeat `gh attestation verify` inside AWS/B2 credential-bearing jobs. Instead it validates the immutable verified receipt in `preflight-live`, which already owns only GitHub metadata/read access and is already the predecessor that controls whether provider environment names are published to downstream jobs.

Source:
- https://docs.github.com/en/actions/concepts/security/artifact-attestations

### Gate placement matters

The provider jobs use dynamic environments from `needs.preflight-live.outputs.*`. Therefore the verified-source check must occur before the step that writes those environment names to `GITHUB_OUTPUT`.

The resulting live order is:

`source run metadata -> STEP06 source/environment preflight -> download exact ciphertext/envelope/source-verification -> STEP07A handoff validation -> publish environment names -> AWS/B2 environment approvals -> provider readiness -> provider replication/readback`.

A failed or missing source-verification artifact prevents provider jobs from becoming runnable through this workflow.

## Implementation

### `controller/r1/verified_source_handoff.py`

Validates:

- self-hashed STEP06 preflight;
- exact source run/workflow/head/repository identity;
- immutable source-verification artifact metadata;
- exact downloaded ciphertext hash/size;
- STEP04 envelope integrity;
- STEP07 verification receipt schema/classification/self-hash;
- exact source run/head binding;
- exact ciphertext/envelope binding;
- `source_attestation_verified=true`;
- at least one verified timestamp;
- explicit final-R2-evidence-binding requirement;
- all authority/R2/R3/seal fields remain false.

Output:

`VERIFIED_SOURCE_HANDOFF_PROVIDER_ELIGIBILITY_NONAUTHORITATIVE`

with `provider_credentials_eligible_after_environment_and_readiness_gates=true` but `provider_execution_authorized=false`.

### `controller/r1/source_bound_quorum_candidate.py`

The historical STEP06 result intentionally has `source_attestation_verified=false`. STEP07A does not rewrite that older contract. Instead, after two provider results are assembled, a wrapper binds the old quorum candidate to the verified-source handoff and emits:

`VERIFIED_SOURCE_TWO_DOMAIN_PROVIDER_READBACK_CANDIDATE_NONAUTHORITATIVE`

This records `source_attestation_verified=true` while preserving:

- `authority_effect=false`;
- `r2_proven=false`;
- `r3_proven=false`;
- `persisted_seal_allowed=false`;
- `final_r2_evidence_binding_required=true`.

### Workflow integration

`.github/workflows/r1-live-two-domain-orchestration.yml` now:

- requires `source_verification_artifact_id`;
- downloads ciphertext, envelope and verification receipt separately by immutable IDs in credential-free preflight;
- uses `download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` with digest mismatch as error;
- runs STEP07A before publishing AWS/B2 environment names;
- uploads the self-hashed handoff receipt;
- provider jobs retain `needs: preflight-live`;
- final quorum downloads the handoff artifact and creates the source-bound candidate.

The AWS/B2 provider credential/readiness implementation itself is unchanged.

## Adversarial coverage

`tests/test_r1_verified_source_handoff.py` covers:

- exact valid handoff;
- wrong/expired verification artifact;
- artifact from wrong source head/run;
- receipt self-hash tampering;
- forged run id after recomputing self-hash;
- ciphertext binding mismatch;
- unverified source;
- attempted authority/R2 escalation;
- preflight that tries to authorize provider execution.

`tests/test_r1_source_bound_quorum_candidate.py` covers:

- valid source-bound candidate with R2 still false;
- source/ciphertext mismatch;
- handoff authority escalation;
- base/handoff self-hash tampering;
- unready two-domain quorum;
- unverified source.

## Strict nonclaims

- PR CI performs no source-generation or provider API call;
- no GitHub environment/secret/variable is created;
- no live source-verification artifact currently exists from this PR;
- no AWS/B2 object/readback is created;
- source provenance eligibility is not provider execution authority;
- no Supabase continuity observation is inserted;
- no R2/R3 proof or persisted seal is created;
- stale R1 worker claim state is not mutated.

## Mandatory research after implementation before merge

After CI, re-check and record:

1. whether direct-file artifact digest semantics provide any stronger content assertion than the receipt self-hash, or should remain transport-only evidence;
2. whether the source-verification receipt should also bind the source environment readiness artifact/hash before final R2 authority;
3. whether provider jobs should independently download/validate the handoff receipt or whether GitHub `needs` dependency is the preferable least-credential design;
4. whether source run/artifact deletion after provider execution requires the final R2 evidence binder to persist the source-verification/handoff bytes or only their hashes;
5. whether the source-bound quorum candidate contains every hash needed by the next final R2 evidence-binding step, especially both provider-readiness receipt hashes, which are currently separate artifacts.

Merge is forbidden until these findings are recorded and CI/Governance succeed again on that exact head. All live workflow-dispatch jobs must remain skipped on PR.
