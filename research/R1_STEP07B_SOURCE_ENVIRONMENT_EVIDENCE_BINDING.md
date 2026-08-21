# R1 STEP07B — source-environment evidence binding

Status: PREPARE_ONLY / source-provenance hardening  
Authority: source-environment configuration evidence only; no durability or R2 authority

## Goal

Bind the already enforced GitHub protected environment configuration into the signed STEP07 source provenance, rather than leaving `source.environment` as a workflow-controlled custom-predicate field.

STEP07B closes a trust gap found during mandatory research-before STEP08. STEP07 already runs the DB-secret-bearing `source-build` job in `r1-recovery-source`, and GitHub enforces environment protection before the job runs, but the custom source predicate previously contained only the string `r1-recovery-source`. That string alone did not cryptographically bind the environment readiness evidence used by the preflight.

## Mandatory research before implementation

### GitHub environment protection is real execution policy

Current GitHub Actions documentation states that jobs referencing an environment must pass that environment's protection rules before the job is sent to a runner, and environment secrets are unavailable until the protection rules have passed. Required reviewers can be configured and `prevent_self_review` can prevent the initiator from approving their own deployment.

The existing STEP07 preflight therefore remains useful and meaningful evidence when it validates:

- required reviewers exist;
- `prevent_self_review=true`;
- branch/deployment policy exists;
- the environment is exactly `r1-recovery-source`.

Sources:
- https://docs.github.com/en/actions/reference/deployments-and-environments
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments

### Custom predicate fields still require explicit evidence binding

GitHub artifact-attestation guidance requires consumer policy verification. A custom predicate is workflow-produced data; the string value `source.environment` is not independently authenticated as an environment configuration snapshot merely because the overall statement is signed.

STEP07B therefore persists the validated environment-readiness receipt as an immutable artifact and binds its canonical SHA-256 into the signed predicate.

### Independent signer-side validation is required

`source-build` has the DB credential and constructs the predicate but has no OIDC/attestation permission. `attest-source` has OIDC/attestation permission but no DB secret/environment.

To avoid trusting `source-build` to invent an environment-readiness hash, the signer job independently downloads both:

- the final predicate artifact;
- the original readiness artifact emitted by preflight;

and validates their exact binding **before** calling `actions/attest`.

The consumer verifier independently performs the same materialization and binding after `gh attestation verify`.

## Implementation contract

### `controller/r1/source_environment_evidence_binding.py`

Offline / credential-free helper with three operations:

1. `bind-predicate`
   - validates the STEP07 predicate self-hash/non-authority;
   - validates source-environment readiness shape/non-authority;
   - adds `source_environment_evidence` with canonical readiness SHA-256;
   - recomputes `predicate_sha256`.

2. `validate-predicate`
   - independently validates the bound predicate against the original readiness bytes;
   - intended for the signer job before `actions/attest`.

3. `bind-verification`
   - consumes the successful `gh attestation verify` JSON;
   - verifies that the signed statement predicate contains the exact readiness binding;
   - binds immutable readiness artifact id/name/hash into the STEP07 source-verification receipt;
   - recomputes `verification_receipt_sha256`.

All outputs remain non-authoritative and explicitly keep R2/R3/seal false.

### Source workflow changes

`preflight-source` now uploads direct immutable artifact:

`r1-source-environment-readiness.json`

and exposes its artifact ID.

`source-build` downloads the readiness artifact by immutable ID and produces an environment-bound predicate.

`attest-source` now depends on both `source-build` and `preflight-source`; it downloads the predicate and original readiness artifact, validates the binding, and only then obtains signing authority through `actions/attest`.

`verify-source` materializes the same readiness artifact and binds it into the final source-verification receipt after cryptographic verification.

### STEP07A fail-closed compatibility

`controller/r1/verified_source_handoff.py` now rejects a STEP07 source-verification receipt unless it contains:

- positive readiness artifact ID;
- artifact name `r1-source-environment-readiness.json`;
- valid readiness SHA-256;
- environment `r1-recovery-source`;
- `source_environment_binding_verified=true`.

The handoff propagates that evidence while preserving provider execution/R2/R3/seal false.

No live STEP07 receipts have been created before this change, so no production evidence migration is required.

## Adversarial coverage

`tests/test_r1_source_environment_evidence_binding.py` covers:

- malformed or weakened readiness protection evidence;
- attempted authority escalation;
- exact readiness hash binding and predicate rehash;
- forged readiness after predicate creation;
- forged predicate after recomputing self-hash;
- mismatched signed predicate at consumer verification;
- source-verification authority escalation;
- double-binding rejection.

`tests/test_r1_verified_source_handoff.py` additionally requires environment-bound source verification and rejects missing or false bindings.

## Strict nonclaims

- PR CI does not create or approve a GitHub environment;
- PR CI does not access the Supabase DB;
- no live encrypted recovery source is produced;
- no GitHub deployment approval event is claimed or named by reviewer;
- environment configuration evidence is not itself a proof of two-domain durability;
- no AWS/B2 call or object/readback is created;
- no Supabase continuity observation is inserted;
- no R2/R3 proof or persisted seal is created;
- stale R1 worker claim state is not mutated.

## Mandatory research after implementation before merge

After CI, re-check and record:

1. TOCTOU semantics: the readiness artifact is captured before `source-build`; determine what GitHub guarantees if environment configuration changes before approval/job start.
2. Distinguish environment **configuration readiness** from the actual deployment approval event; do not overclaim reviewer identity or approval timestamp unless independently available and verified.
3. Determine whether a deployment/approval record can be retrieved through current GitHub REST/GraphQL/audit APIs and whether it materially strengthens future R2 source evidence.
4. Confirm whether final STEP08 must preserve raw readiness bytes as well as the readiness hash/artifact ID.
5. Confirm that STEP07A should consume the environment-bound verification receipt rather than independently re-fetching the raw readiness artifact under provider credentials.
6. Reassess whether the signer job should itself use the protected source environment; prefer separation unless research shows the environment claim cannot be adequately bound without doing so.

Merge is forbidden until these findings are recorded and CI/Governance succeed again on the exact resulting head. All live workflow-dispatch jobs must remain skipped on PR.
