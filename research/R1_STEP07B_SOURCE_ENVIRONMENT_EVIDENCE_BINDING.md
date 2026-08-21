# R1 STEP07B — source-environment configuration + approval evidence binding

Status: PREPARE_ONLY / source-provenance hardening  
Authority: source-environment provenance only; no durability or R2 authority

## Goal

Bind both the protected GitHub source-environment configuration and an actually observed approved deployment review into the signed STEP07 source provenance, rather than leaving `source.environment` as a workflow-controlled custom-predicate field.

STEP07B closes a trust gap found during mandatory research-before STEP08. STEP07 already runs the DB-secret-bearing `source-build` job in `r1-recovery-source`, but the custom source predicate previously contained only the string `r1-recovery-source`. That string alone did not cryptographically bind either the protection configuration or the review event that allowed the protected job to run.

## Mandatory research before implementation

### GitHub environment protection is real execution policy

Current GitHub Actions documentation states that jobs referencing an environment must pass that environment's protection rules before the job is sent to a runner, and environment secrets are unavailable until protection rules have passed. Required reviewers can be configured and `prevent_self_review` prevents the initiator from approving their own deployment.

The existing STEP07 preflight therefore remains meaningful configuration evidence when it validates:

- required reviewers exist;
- `prevent_self_review=true`;
- branch/deployment policy exists;
- the environment is exactly `r1-recovery-source`.

Sources:
- https://docs.github.com/en/actions/reference/deployments-and-environments
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments

### Custom predicate fields still require explicit evidence binding

GitHub artifact-attestation guidance requires consumer policy verification. A custom predicate is workflow-produced data; the string value `source.environment` is not independently authenticated as an environment configuration snapshot merely because the overall statement is signed.

STEP07B therefore persists validated environment evidence as immutable direct-file artifacts and binds their canonical hashes/IDs into the signed predicate.

### Independent signer-side validation is required

`source-build` has the DB credential and constructs the predicate but has no OIDC/attestation permission. `attest-source` has OIDC/attestation permission but no DB secret/environment.

To avoid trusting `source-build` to invent environment evidence, the signer job independently downloads the original evidence artifacts and validates their exact predicate binding **before** calling `actions/attest`.

The consumer verifier independently repeats the evidence validation after `gh attestation verify`.

## Initial implementation

### Configuration readiness artifact

`preflight-source` uploads direct immutable artifact:

`r1-source-environment-readiness.json`

The receipt records the validated protection shape but remains non-authoritative.

### `controller/r1/source_environment_evidence_binding.py`

Offline / credential-free helper initially bound readiness bytes into the STEP07 predicate, revalidated them in the signer, and propagated them into the source-verification receipt.

### STEP07A fail-closed compatibility

`controller/r1/verified_source_handoff.py` was changed to reject source verification that does not contain verified source-environment evidence. No live STEP07 source has ever been produced before this change, so no production evidence migration is required.

## Mandatory research after implementation

### 1. Preflight configuration alone leaves a TOCTOU gap

The first CI implementation correctly persisted the configuration seen by `preflight-source`, but post-step research identified an important distinction:

- the readiness artifact proves the protection **configuration observed during preflight**;
- GitHub separately enforces the environment protection rules when `source-build` becomes runnable;
- the readiness artifact by itself is not a record of which reviewer actually approved the deployment.

A repository administrator could theoretically change environment configuration after preflight. Therefore STEP07B should not rely on the preflight snapshot alone as evidence that a required-review approval actually occurred.

### 2. GitHub exposes read-only workflow-run review history

Current GitHub REST documentation exposes:

`GET /repos/{owner}/{repo}/actions/runs/{run_id}/approvals`

Anyone with Actions read permission can retrieve the review history for an accessible workflow run. The response includes review state, environment(s), and reviewer user identity. The separate endpoint for reviewing pending deployments requires Deployments write permission, but STEP07B only performs the read operation.

GitHub Actions also exposes `github.actor_id` / `GITHUB_ACTOR_ID`, the stable account ID that initiated the initial workflow run.

This allows stronger evidence without granting any review/write capability to the workflow.

Sources:
- https://docs.github.com/en/rest/actions/workflow-runs#get-the-review-history-for-a-workflow-run
- https://docs.github.com/en/actions/reference/workflows-and-actions/contexts
- https://docs.github.com/en/actions/reference/workflows-and-actions/variables

### 3. Post-research amendment — actual approval evidence

The implementation was hardened before merge.

New helper:

`controller/r1/source_environment_approval_evidence.py`

It normalizes the review-history response and requires:

- at least one `approved` review covering exactly `r1-recovery-source`;
- positive stable reviewer user ID;
- reviewer user ID differs from `GITHUB_ACTOR_ID`;
- no authority/R2/R3/seal claim;
- no approval timestamp claim, because the current review-history response used by this contract is not relied on for a timestamp.

The normalized direct artifact is:

`r1-source-environment-approval.json`

It records reviewer identity and hashes the free-form review comment rather than using the comment text as authority evidence.

### 4. Approval history may grow monotonically

Once one required reviewer approves, the protected job can proceed. Additional non-self approvals may appear in review history later.

Signer/consumer revalidation therefore uses monotonic subset semantics:

- every approval captured in the immutable approval artifact must still be present in fresh GitHub review history;
- fresh review history may contain additional non-self approvals;
- any self-approval observed in the fresh history remains a fail-closed condition.

This avoids false failures from harmless additional approvals without allowing a recorded approval to disappear or mutate.

### 5. Trust-zone flow after the amendment

The final STEP07B source path is:

1. `preflight-source` validates current environment protection configuration and uploads immutable readiness evidence.
2. GitHub itself evaluates the protected `source-build` environment before the job reaches a runner.
3. `source-build`, before DB access, reads the workflow-run approval history and builds immutable approval evidence.
4. Only after the approval evidence exists does the DB-secret-bearing dump/encrypt step run.
5. The source predicate binds both readiness and approval artifact IDs/hashes.
6. `attest-source` independently downloads both evidence artifacts, independently re-reads GitHub approval history, verifies the approval artifact and predicate binding, then and only then calls `actions/attest`.
7. `verify-source` independently repeats approval-history validation and binds readiness+approval evidence into the cryptographically verified source receipt.
8. STEP07A rejects any source-verification receipt missing either configuration evidence or approved-review evidence before provider environments/credentials become eligible.

The signing job remains outside the protected source environment. This preserves separation between the DB/environment trust zone and the OIDC signing trust zone while the signed predicate is independently checked against the original GitHub evidence.

### 6. What STEP07B still does not claim

STEP07B intentionally distinguishes three things:

- environment **configuration readiness**;
- an **approved review event** observed in GitHub workflow-run history;
- two-domain **durability**.

Only the first two are advanced here. Neither is R2.

The evidence does not claim a cryptographically authoritative approval timestamp. It does not claim that GitHub is an independent durability provider. It does not create a Supabase continuity observation.

### 7. STEP08 persistence requirement

GitHub documents that deleting a workflow run deletes its associated artifacts. Therefore the future STEP08 final evidence package must preserve the raw bytes of both:

- `r1-source-environment-readiness.json`;
- `r1-source-environment-approval.json`;

in addition to their hashes/artifact IDs already propagated through the signed predicate, source verification, handoff, and source-bound quorum candidate.

GitHub artifacts remain transport/evidence staging, not a continuity failure domain.

Source:
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/remove-workflow-artifacts

### 8. Provider jobs should not re-fetch approval evidence

STEP07A remains the credential-free consumer boundary. AWS/B2 jobs should not independently fetch or parse source-environment evidence while holding cloud credentials.

The provider jobs depend on successful `preflight-live`; that credential-free predecessor validates the source-verification receipt/handoff. This is the lower-credential architecture and avoids duplicating source-provenance logic inside cloud trust zones.

### 9. Final R2 binder requirement

STEP08 must carry forward raw source-environment evidence plus:

- Sigstore source attestation bundle;
- source verification receipt;
- STEP07A handoff;
- both provider readiness receipts;
- both provider result/readback receipts;
- source-bound quorum candidate;
- an appropriate Sigstore trusted-root snapshot for portable/offline verification.

STEP08 must remain non-authoritative until the real bytes are verified and ingested into the existing continuity DB state machine.

## Adversarial coverage

`tests/test_r1_source_environment_approval_evidence.py` covers:

- valid approval normalization;
- stable-ID self-approval rejection;
- missing approval / wrong environment;
- sorting/deduplication;
- forged evidence after recomputing self-hash;
- recorded review missing from fresh history;
- legitimate later non-self approvals;
- self-approval added later;
- malformed IDs.

`tests/test_r1_source_environment_evidence_binding.py` covers:

- weakened readiness evidence;
- approval authority escalation;
- exact readiness + approval artifact ID/hash binding;
- signer-side readiness/approval forgery;
- signed-predicate mismatch;
- artifact-ID tamper;
- double binding.

`tests/test_r1_verified_source_handoff.py` requires both configuration and approved-review evidence before provider eligibility.

`tests/test_r1_source_bound_quorum_candidate.py` propagates both environment evidence roots into the final non-authoritative two-domain candidate and still requires R2/seal false.

## Strict nonclaims

- PR CI does not create, modify, approve, or bypass a GitHub environment;
- PR CI does not access the Supabase DB;
- no live encrypted recovery source is produced;
- no source approval timestamp authority is claimed;
- no AWS/B2 call or object/readback is created;
- no Supabase continuity observation is inserted;
- no R2/R3 proof or persisted seal is created;
- stale R1 worker claim state is not mutated.

## Merge gate

Merge is forbidden until, on the exact final head:

- STEP07/07B source contract tests succeed;
- STEP07A/orchestration regression succeeds;
- Compute Fabric Governance succeeds;
- every live `workflow_dispatch` source/provider job remains skipped on PR.
