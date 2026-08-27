# MAIN ROADMAP ACCELERATORS V5 — W1 SSM READINESS PREP CHECKPOINT

Date: 2026-08-28 (user-local)

## Scope

This checkpoint seals the contract for a real, non-mutating external readiness preflight before the first W1 safety-package provisioning dispatch.

It does not assert that the live GitHub environment, AWS roles, candidate host, or SSM documents have already passed that read-only preflight.

## Exact validated source

- repository: `PatrickFrome/Compute`
- branch: `work/main-roadmap-accelerators-v5`
- source commit: `7daa6a489fcd9a4a351d8617566dac502dad6e69`
- source tree: `1470f00c93225196f633d1705b4f56a776626b6e`
- readiness workflow: `W1 AWS SSM Safety Readiness`
- exact run: `33127567187`
- result: **SUCCESS**
- push behavior:
  - `contract`: SUCCESS
  - `github-environment`: SKIPPED
  - `aws-readonly`: SKIPPED

The initial workflow source `8de2c6492784f738eac8234c5db4297b21604879`, tree `8d29fbae4dd243a38eda05d397d54c24842608ec`, also passed exact run `33127518080`.

## Implemented readiness boundary

### GitHub metadata phase

The future explicit dispatch reads only:

- environment `w1-persistent-host-proof`;
- `main` branch metadata;
- custom environment deployment branch policies when applicable.

It reuses the existing W1 validators to require:

- a non-empty required-reviewers rule;
- `prevent_self_review=true`;
- an environment branch-policy rule;
- protected `main` or exactly one custom `main` deployment policy.

This phase has no OIDC token and no AWS credentials.

### AWS read-only phase

Only one job may request a GitHub OIDC token. It runs behind the protected environment and assumes only the configured verifier role.

Its inline session policy contains only:

- EC2 describe instance/volume/security-group;
- SSM describe managed-node information;
- SSM describe/get exact safety provisioning document;
- SSM describe/get exact IID capture document.

It contains no:

- `ssm:SendCommand`;
- SSM session or document-authoring operations;
- EC2 lifecycle mutation;
- CloudTrail execution correlation;
- S3/KMS/Secrets Manager access;
- database access.

### Role configuration invariant

The preflight requires three pairwise-distinct same-account role ARNs:

1. safety-package provisioning role;
2. IID capture role;
3. read-only verifier role.

The live STS caller must bind to the configured verifier role, preventing a provisioning-role session from masquerading as an independent readiness verifier.

## Readiness receipt

A real successful preflight may state:

- protected GitHub environment verified;
- main deployment route verified;
- role separation verified;
- verifier identity verified;
- provider host binding verified;
- SSM managed node online/Linux verified;
- exact safety provisioning document verified;
- exact IID capture document verified;
- `readiness_preflight_passed=true`.

It must still state false for:

- `send_command_executed`;
- document mutation;
- host filesystem mutation;
- reboot;
- database mutation;
- worker admission;
- persistent worker proof;
- W1 verification;
- canonical authority effect.

## Research basis

Current official documentation was rechecked before implementation:

- GitHub REST environment endpoint exposes protection/deployment metadata through a read endpoint;
- GitHub environments can gate jobs before runner execution;
- AWS SSM `DescribeInstanceInformation` exposes managed-node status/platform;
- `DescribeDocument` exposes document owner/version/hash/state;
- `GetDocument` exposes exact versioned content.

Research file: `research/W1_SSM_SAFETY_READINESS.md`.

## Relationship to prior checkpoint

The preceding live-provisioning contract checkpoint sealed:

`gate -> provision -> IID capture -> independent postverify`

The new readiness checkpoint places a read-only proof in front of that chain:

`readiness contract -> explicit read-only preflight -> explicit provisioning dispatch`

This prevents the first mutating W1 workflow from being used as a configuration-discovery mechanism.

## Current roadmap truth

Latest live Supabase readback during this development cycle:

- definition integrity = true;
- canonical alignment integrity = true;
- drift = false;
- next mainline = W1;
- W1 = READY;
- T1 = BLOCKED by W1;
- A1 = BLOCKED by W1;
- active claim alignment empty;
- EVIDENCE_READY alignment empty;
- stale claim #32 remains cleanup debt with stale-row authority effect false.

No lease cleanup or supervisor-authority mutation was performed.

## Explicit nonclaims

This slice did not:

- dispatch `PREFLIGHT_W1_SSM_SAFETY_READINESS`;
- access the live AWS candidate through this new workflow;
- prove environment variables/roles exist live;
- prove either SSM document exists live;
- run `SendCommand`;
- mutate EC2;
- reboot;
- capture real host safety evidence;
- ingest W1 evidence into Supabase;
- verify or admit W1.

## Status

`W1_PERSISTENT_LINUX_WORKER_SAFETY = READY`

**Not VERIFIED.**

## Next evidence action

The next meaningful step is an explicitly approved `main` dispatch of `W1 AWS SSM Safety Readiness` using confirmation:

`PREFLIGHT_W1_SSM_SAFETY_READINESS`

A green receipt would still be non-authoritative and non-mutating; it would merely establish that the real external prerequisites are ready for a separately approved provisioning dispatch.
