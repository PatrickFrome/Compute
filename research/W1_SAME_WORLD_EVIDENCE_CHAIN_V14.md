# W1 Same-World Evidence Chain V14

Date: 2026-08-28
Status: source-only provenance fence / non-authority

## Problem

The existing W1 controls are intentionally separated into different trust domains:

- deterministic package provisioning;
- signed AWS EC2 identity capture;
- Linux safety capture;
- provider reboot request evidence;
- post-reboot Linux evidence;
- database persisted-readback admission composition.

Each domain already has strong local validation, but independent successful receipts do not automatically prove that they belong to one execution world. A cross-run mix-and-match attack could otherwise combine individually valid evidence from different source revisions, instances, workers or provider operations.

V14 therefore adds a pipeline-level same-world provenance fence. It does not replace any existing verifier and it does not grant authority.

## Research basis

### SLSA build provenance

SLSA provenance models a build as a `buildDefinition` plus `runDetails`. The build definition records external parameters and resolved dependencies so downstream verifiers can decide whether the observed execution matches policy. The transferable W1 lesson is that individual evidence blobs need a shared immutable execution definition rather than merely being valid in isolation.

References:
- https://slsa.dev/spec/v1.1/provenance
- https://slsa.dev/spec/v1.2-rc2/build-provenance

### in-toto statements and Link predicates

in-toto statements bind subjects to a typed predicate. The Link predicate is particularly relevant because each supply-chain step consumes materials and produces subjects/products. V14 mirrors that relationship:

`world anchor -> provision receipt -> pre-reboot safety receipt -> reboot receipt -> post-reboot safety receipt`

Every stage after the first includes both the previous stage link digest and the previous receipt digest as materials.

References:
- https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md
- https://github.com/in-toto/attestation/blob/main/spec/predicates/link.md

### Tekton Chains

Tekton Chains demonstrates why pipeline-level provenance is stronger than disconnected task-level attestations. It can observe a completed TaskRun or PipelineRun, snapshot execution details, format the result as provenance, then sign and store it. The relevant lesson is to preserve both step-level evidence and a composition-level chain.

References:
- https://tekton.dev/docs/chains/
- https://tekton.dev/docs/chains/slsa-provenance/

### AWS CloudTrail session identity

CloudTrail records temporary-role session context in `userIdentity.sessionContext`. Existing W1 provisioning and reboot controllers already bind CloudTrail events to exact role-session names. V14 retains those receipts instead of inventing a new provider identity primitive.

Reference:
- https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-user-identity.html

## Immutable world anchor

`build_world_anchor()` binds:

- repository `PatrickFrome/Compute`;
- immutable repository id `1341371143`;
- immutable owner id `20597814`;
- `refs/heads/main`;
- protected Environment `w1-persistent-host-proof`;
- exact reviewed source SHA and source tree;
- exact EC2 instance id, worker id, AWS account and region;
- provider kind `AWS_EC2`;
- deterministic safety package source commit/tree/manifest;
- live safety policy key `linux-h1-h13-v1`;
- exact current policy SHA-256 `3dba3ce69e945e52ff1a2ab23e2981dd543296c72f229673bcc44c94c9e70122`.

The canonical hash of that object is `world_id`.

A changed source SHA, host identity, account/region, package identity or safety policy therefore creates a different execution world rather than being silently accepted into an existing chain.

## Stage links

V14 defines four ordered links:

1. `PROVISION`
2. `PRE_REBOOT_SAFETY_CAPTURE`
3. `REBOOT_REQUEST`
4. `POST_REBOOT_SAFETY_CAPTURE`

Each link binds:

- `world_id`;
- exact source SHA/tree;
- immutable repository/owner ids;
- exact allowlisted workflow path;
- GitHub run id and attempt;
- stage ordinal;
- current receipt digest as subject;
- previous link digest and previous receipt digest as materials for every stage after the first.

This prevents a later step from being reattached to a different predecessor without changing the link digest.

## Reuse of existing receipt semantics

V14 does not create parallel provider truth.

Provisioning evidence must already satisfy the existing strict provenance compositor:
- signed AWS IID;
- exact instance/worker/account/region;
- exact SSM document and package;
- CloudTrail `SendCommand` correlation;
- exact command invocation;
- independent read-only verifier.

Safety evidence must already satisfy the existing off-host safety capture guard and be safety-eligible, while still remaining `host_safety_verified=false`.

Reboot evidence must already be an existing provider controller receipt with semantics `ASYNC_REBOOT_REQUEST_ACCEPTED`; provider request acceptance is explicitly not reboot completion.

The pre- and post-reboot safety receipts must use distinct SSM command IDs and distinct transported evidence bundles. This blocks trivial replay of the same capture on both sides of the reboot boundary.

## Deliberate authentication gap

A SHA-256 over JSON is integrity/correlation metadata, not producer authentication.

Therefore every V14 anchor/link and the final chain explicitly retain:

`producer_attestations_authenticated=false`

The source-only contract does not claim that arbitrary stage-link JSON came from GitHub Actions, AWS or another trusted builder. Authenticated producer provenance is a separate next milestone.

This is analogous to the distinction in SLSA/in-toto between a provenance statement and a statement whose producer identity/signature is actually verified.

## Why V14 still cannot prove persistence

Even a fully linked V14 chain keeps these false:

- `reboot_completion_proven`;
- `boot_id_transition_verified`;
- `database_persisted_readback_verified`;
- `persistent_worker_proof`;
- `worker_admitted`;
- `w1_verified`;
- `canonical`;
- `authority_effect`.

The database-native W1 compositor remains authoritative for the eventual persistence candidate. It must independently read persisted pre/post probes, require a changed Linux `boot_id`, validate ordering against the reboot receipt, validate the post-reboot safety verification, and recompute all persisted digests.

## Source-only workflow

`.github/workflows/w1-same-world-evidence-chain-contract.yml` is intentionally credential-free:

- no `workflow_dispatch`;
- no OIDC permission;
- no AWS/Supabase/psql/curl/wget execution;
- no artifacts containing provider evidence;
- only compilation, adversarial unit tests and static non-authority checks.

The V14 allowlist references a future `.github/workflows/w1-aws-ssm-safety-capture-live.yml` as the dedicated safety producer. That live workflow is deliberately not created by this source-only step because producer authentication and protected Environment semantics must be researched first.

## Adversarial cases

The test contract rejects:

- safety policy drift;
- cross-instance evidence;
- package digest/source drift;
- worker drift in reboot evidence;
- previous-link substitution;
- previous-receipt substitution;
- source/world drift;
- unapproved workflow paths;
- authority flag injection;
- receipt self-hash tampering;
- reuse of one SSM command for pre and post capture;
- reuse of one transported safety bundle for pre and post capture.

## Next research / implementation boundary

After V14 source CI is green, the next strongest accelerator is authenticated producer provenance, not another self-hash wrapper.

Candidates to research against current product availability:

1. GitHub Artifact Attestations / `actions/attest-build-provenance` with GitHub OIDC builder identity;
2. DSSE/in-toto statement signing and verification;
3. Sigstore keyless verification/bundle semantics;
4. a reusable live W1 orchestrator that generates one world anchor on protected `main` and passes its digest through provision, pre-capture, reboot and post-capture without merging provider authorities.

Any authenticated link integration must still preserve separate AWS roles for provisioning, capture and reboot and must not replace changed-`boot_id` persisted-readback proof.

W1 remains READY, not VERIFIED.
