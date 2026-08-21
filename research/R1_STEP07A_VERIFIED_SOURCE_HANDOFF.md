# R1 STEP07A — bind cryptographically verified source before provider credentials

Status: PREPARE_ONLY / mandatory orchestration gate  
Authority: source-provenance eligibility only; no provider or R2 authority

## Goal

Make the cryptographically verified STEP07 source receipt a mandatory, immutable input to the existing STEP06 orchestration **before** AWS/B2 protected environments and cloud credentials can become eligible.

STEP07A closes a deliberate historical gap: STEP06 was implemented before STEP07 existed, so it knew that source attestation was required but could not yet consume a verified source receipt. No live provider execution is permitted through the updated workflow unless this handoff succeeds.

## Mandatory research before implementation

### GitHub artifact metadata is sufficient for immutable same-run binding

The current GitHub Actions artifact REST response includes artifact `id`, `name`, `size_in_bytes`, `expired`, SHA-256 `digest`, and bound `workflow_run` metadata including run id, repository ids, branch and head SHA.

STEP07A therefore requires a new workflow-dispatch input:

`source_verification_artifact_id`

The selected artifact must be exactly `r1-recovery-source-verification.json` and must belong to the same successful `workflow_dispatch` source run/head/repository as the ciphertext/envelope artifacts.

GitHub's artifact upload action publishes a SHA-256 digest, and download-artifact validates the downloaded artifact digest. STEP07A additionally validates the receipt's own canonical self-hash and its binding to the actual downloaded ciphertext/envelope bytes:

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

The provider jobs use dynamic environments from `needs.preflight-live.outputs.*`. Therefore the verified-source check occurs before the step that writes those environment names to `GITHUB_OUTPUT`.

Live order:

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

It records `source_attestation_verified=true` while preserving:
- `authority_effect=false`;
- `r2_proven=false`;
- `r3_proven=false`;
- `persisted_seal_allowed=false`;
- `final_r2_evidence_binding_required=true`.

### Workflow integration

`.github/workflows/r1-live-two-domain-orchestration.yml` now:
- requires `source_verification_artifact_id`;
- downloads ciphertext, envelope and verification receipt separately by immutable IDs in credential-free preflight;
- uses pinned download-artifact with digest mismatch as error;
- runs STEP07A before publishing AWS/B2 environment names;
- uploads the self-hashed handoff receipt;
- keeps provider jobs on `needs: preflight-live`;
- final quorum downloads the handoff artifact and creates the source-bound candidate.

The AWS/B2 provider credential/readiness implementation itself is unchanged.

## Adversarial coverage

`tests/test_r1_verified_source_handoff.py` covers exact valid handoff, wrong/expired artifact, wrong source head/run, receipt self-hash tampering, forged run id after recomputing self-hash, ciphertext mismatch, unverified source, authority/R2 escalation, and preflight attempting to authorize provider execution.

`tests/test_r1_source_bound_quorum_candidate.py` covers valid source-bound candidate with R2 still false, source/ciphertext mismatch, handoff authority escalation, base/handoff self-hash tampering, unready quorum and unverified source.

## Mandatory research after implementation — completed

### 1. Artifact digest is transport-integrity evidence, not semantic authority

Current GitHub documentation states that upload-artifact emits a SHA-256 digest and download-artifact recalculates/validates it. For direct unarchived artifacts, current upload-artifact also uses the filename as the artifact name.

STEP07A keeps the GitHub digest as transport-integrity evidence. It does not promote that digest into recovery authority because the semantic object being trusted is the self-hashed STEP07 verification receipt bound to exact ciphertext/envelope/source identity.

Decision:
- artifact id/digest protects handoff transport and same-run selection;
- canonical receipt self-hash + materialized ciphertext/envelope hashes protect semantic binding;
- neither alone establishes R2.

Sources:
- https://docs.github.com/en/actions/tutorials/store-and-share-data
- https://github.com/actions/upload-artifact/blob/main/action.yml

### 2. Direct-file artifact naming was checked for collision safety

Current upload-artifact direct-file semantics (`archive:false`) use the uploaded filename as the artifact name. Existing and new orchestration artifacts use distinct filenames:

- `r1-live-preflight.json`;
- `r1-verified-source-handoff.json`;
- `r1-aws-provider-readiness.json`;
- `r1-aws-provider-result.json`;
- `r1-b2-provider-readiness.json`;
- `r1-b2-provider-result.json`;
- `r1-two-domain-quorum-candidate.json`.

Therefore the workflow does not rely on repeated default `artifact` names and does not hit the immutable same-name upload conflict.

Source:
- https://github.com/actions/upload-artifact/blob/main/action.yml

### 3. `needs: preflight-live` is the preferred credential boundary

GitHub documents that a job listed in `needs` must complete successfully before the dependent job runs; failure/skip propagates through the dependency chain unless explicitly overridden with an `always()`-style condition. Provider jobs do not use such an override.

GitHub environments separately enforce protection before the environment job is sent to a runner, and environment secrets are unavailable until that point.

Decision:
- keep handoff parsing/validation entirely in credential-free `preflight-live`;
- do **not** repeat handoff parsing under AWS/B2 credentials;
- provider jobs remain dependent on successful preflight and then their own protected-environment/readiness gates.

This minimizes the parser/credential overlap while retaining a fail-closed execution graph.

Sources:
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs
- https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments

### 4. Source-environment readiness remains a final-authority evidence requirement, not a provider-eligibility blocker

STEP07 verification cryptographically pins the source workflow/source digest and validates a predicate that records the expected source environment. The signing job intentionally does not hold the DB environment itself, preserving DB-secret/signing-identity separation.

STEP07A therefore accepts the cryptographically verified STEP07 receipt for provider eligibility, but does not claim certificate-level proof of the source environment metadata.

Decision for final authority:
- final R2 evidence must bind the verified source receipt/predicate hash;
- it should also bind explicit source-environment readiness evidence if that environment property is promoted into an R2 authority criterion;
- STEP07A remains non-authoritative and does not need to collapse those trust zones.

### 5. GitHub `needs` success is sufficient for provider eligibility; provider jobs should not independently fetch the handoff

Re-downloading the handoff inside credential-bearing provider jobs would add no new cryptographic identity, because those jobs would still trust GitHub artifact transport and the same receipt. It would instead move additional JSON parsing into the cloud-credential window.

Decision:
- handoff is validated once before environment outputs;
- provider jobs depend on the successful preflight job;
- the handoff artifact is retained for later evidence binding and downloaded again only by the credential-free quorum/final-evidence plane.

### 6. GitHub source artifacts are ephemeral transport; final evidence must preserve authority-relevant bytes before deletion

GitHub documentation states that deleting a workflow run deletes all artifacts associated with it, and artifacts also expire according to configured retention.

Therefore hashes alone are not sufficient for long-lived future cryptographic verification if the only copy of the Sigstore bundle/verification receipt disappears.

Decision for the next evidence layer:
- before R2 authority, persist the source-attestation bundle and verification receipt bytes (or an evidence package containing them) outside ephemeral GitHub artifact retention;
- persist their exact hashes in the final evidence statement;
- provider durability must remain valid independently of GitHub run/artifact lifetime.

Source:
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/remove-workflow-artifacts

### 7. Source-bound quorum is intentionally incomplete for final R2 authority

The source-bound quorum candidate now contains:
- exact source/handoff hashes;
- exact source-verification artifact metadata/hash;
- source predicate hash/control identity;
- both provider result hashes;
- two-domain quorum/immutability evidence.

It does **not** yet bind the two provider-configuration readiness receipt hashes. Those readiness receipts remain separate same-run artifacts. This is intentional because STEP07A is only the source-provenance handoff gate.

Required next semantic step:

`STEP08_FINAL_R2_EVIDENCE_PACKAGE`

STEP08 must assemble a credential-free evidence package that materializes and hashes at least:
- portable source attestation bundle;
- STEP07 source-verification receipt;
- STEP07A verified-source handoff;
- AWS provider-readiness receipt;
- B2 provider-readiness receipt;
- AWS provider result/readback receipt;
- B2 provider result/readback receipt;
- source-bound two-domain quorum candidate;
- source/run/artifact identities and control-plane head/digest bindings.

Even STEP08 package assembly must remain `r2_proven=false` until Supervisor ingestion evaluates the live evidence against the canonical R2 acceptance contract.

## Post-research verdict

No STEP07A implementation defect requiring a code rewrite was found after CI. The post-research confirms the chosen least-credential job dependency and identifies STEP08 as the next missing evidence layer rather than silently escalating STEP07A to R2.

## Strict nonclaims

- PR CI performs no source generation or provider API call;
- all workflow-dispatch live jobs are skipped on PR;
- no GitHub environment/secret/variable is created;
- no AWS/B2 object/readback is created;
- source provenance eligibility is not provider execution authority;
- no Supabase continuity observation is inserted;
- no R2/R3 proof or persisted seal is created;
- stale R1 worker claim state is not mutated.

## Merge gate

STEP07A may merge only after the exact head containing this post-research record passes:
1. `R1 Live Two-Domain Readback Orchestration` contract/regression CI;
2. `Compute Fabric Governance`.

All workflow-dispatch live jobs must remain skipped on PR.
