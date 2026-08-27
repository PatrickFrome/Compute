# MAIN ROADMAP ACCELERATORS V5 — W1 SSM LIVE PREP CHECKPOINT

Date: 2026-08-28 (user-local; source validation completed 2026-08-27 UTC)

## Scope

This checkpoint seals the contract-ready W1 live SSM safety provisioning path. It does **not** seal live execution, host safety, reboot persistence, worker admission, W1 verification, or canonical mainline advancement.

## Exact Git state

- Repository: `PatrickFrome/Compute`
- Branch: `work/main-roadmap-accelerators-v5`
- Validated source commit: `60f89d1765c1eeaf108523cd63ea11f82bc2e5a9`
- Validated source tree: `78a8c14f175cc56019a2c787040f3328565cdedb`
- `main`: `0d1c074c7f513f25000d967761c7bb13912dacaa`
- Before this checkpoint document, branch relation to main was clean descendant / ahead-only; prior compare at source preparation showed `behind_by=0`.
- No force push.
- No PR merge.

## Exact CI evidence

### Live workflow contract

Workflow: `W1 AWS SSM Safety Provision Live`

- source: `60f89d1765c1eeaf108523cd63ea11f82bc2e5a9`
- run: `33127293695`
- result: **SUCCESS**
- live cloud jobs on push: skipped by design

The preceding exact source `84a420ddac185b5781569008a1b4a9ded5b2daf0` produced run `33127145875`, also **SUCCESS**, with **64/64 tests PASS** and `live-gate`, `provision`, `iid-capture`, `postverify` all skipped on push.

### Strict SendCommand semantics

- source: `eef86435623e725235fc218a3d89ce8b831fd773`
- run: `33121722500`
- result: **SUCCESS**

### Create-once SSM safety document contract

- source: `ade5fda45980581aaed4a0113d9ac5ec5d208269`
- run: `33121678860`
- result: **SUCCESS**

## Implemented live trust split

`gate -> provision -> IID capture -> independent postverify`

### Gate

- explicit `workflow_dispatch` only for live cloud jobs;
- exact `main` ref;
- exact confirmation `PROVISION_W1_SAFETY_PACKAGE`;
- exact reviewed package source identity.

### Provisioning role

Can only read SSM state and execute the exact version-1 account-owned safety provisioning document against the exact tagged candidate. Full `SendCommand` semantics are pinned: timeout, target, empty parameters, and no output/notification/alarm/service-role/comment side channels.

### IID capture role

Separate OIDC role executes only the exact parameterless signed-IID capture document. Host bytes remain untrusted transport until off-host cryptographic verification.

### Verifier role

Fresh OIDC session with read-only EC2/SSM/CloudTrail access. It cannot `SendCommand`, author SSM documents, reboot instances, or mutate the database.

## Research decisions sealed by this checkpoint

1. `GetCommandInvocation` is eventually consistent, therefore only `InvocationDoesNotExist` and nonterminal invocation states receive bounded retry.
2. CloudTrail is an independent control-plane witness for Systems Manager management events including `SendCommand`; absence is bounded-retryable, duplicate exact matches are fatal.
3. `SendCommand` semantic surfaces beyond document/target must be pinned to prevent a semantically different launch of the same document.
4. GitHub `id-token: write` is only OIDC token-fetch capability; real cloud authority remains in AWS trust/session policy and protected GitHub environments.
5. SSM safety document authoring is a separate create-once control plane and is not available to the runtime provisioning workflow.
6. Complex validation belongs in ordinary adversarially tested Python, not nested workflow heredocs.

Research file: `research/W1_SSM_SAFETY_LIVE_WORKFLOW.md`.

## Live Supabase readback at checkpoint preparation

Observation time: `2026-08-27T23:41:33.571526Z`.

- roadmap definition integrity: `true`;
- canonical alignment integrity: `true`;
- roadmap drift: `false`;
- next mainline: `W1_PERSISTENT_LINUX_WORKER_SAFETY`;
- W1 effective status: `READY`;
- T1 blocked by W1;
- A1 blocked by W1;
- active claim alignment: empty;
- EVIDENCE_READY alignment: empty;
- stale persisted claim #32 remains cleanup debt;
- lease truth v2 states stale rows have `authority_effect=false`;
- supervisor active claims/directives: empty.

No supervisor lease cleanup was performed.

## Mutations explicitly NOT performed

This checkpoint did not:

- dispatch the live AWS workflow;
- create/update/delete a live SSM document;
- call live `ssm:SendCommand`;
- mutate or reboot EC2;
- capture a real W1 host safety envelope;
- create synthetic W1 evidence;
- insert W1 evidence into Supabase;
- admit a worker;
- mark W1 verified;
- reserve or advance a canonical checkpoint.

## Status truth

`W1_PERSISTENT_LINUX_WORKER_SAFETY = READY`

**Not VERIFIED.**

The live path is now contract-ready, not execution-proven.

## Next exact slice

Build and validate a non-mutating readiness preflight that checks the real external prerequisites before any provisioning command is allowed:

- GitHub protected environment policy;
- exact role/config variable presence without exposing secrets;
- read-only AWS account/Region/candidate binding;
- online Linux SSM managed-node state;
- exact version-1 safety provisioning document exists and matches generated bytes;
- exact version-1 IID capture document exists and matches repository bytes;
- fresh verifier role can perform all required reads;
- zero `SendCommand`, document authoring, reboot, admission or DB mutation.

A real package provisioning dispatch must remain blocked until this readiness slice is green.
