# METAENGINE Client V1 C5 — Useful Work Proof Research Checkpoint

Date: 2026-10-06  
Status: **PREPARE_ONLY / CONTRACT EVIDENCE_READY**  
Branch: `work/client-v1-c5-useful-work-proof-v1`  
Exact code head: `022a342e8bcb8ae5e9ddb1839d0a53187b5b27cd`

## Roadmap reconciliation

Canonical Level-1 owner: **C2 — First Serial Coding Loop**.

Canonical C2 requires:

- repo checkout
- isolated edit
- real build or test
- verified artifact
- serial loop end-to-end

This slice does not claim canonical C2 completion. The primary execution spine remains:

`R1 → C1 First Real Linux Worker → C2 First Serial Coding Loop`.

R1 and C1 remain external hard dependencies for canonical promotion.

Client roadmap relation:

- C4 proves one physical Agent-origin goal/readback.
- C5 must prove that one exact Client goal produces useful verified work.
- C5 is therefore the first client-side proof surface that matches the shape of canonical C2, but it cannot promote canonical C2 by itself.

## Problem found in the existing Client proof chain

The existing C4 contract intentionally stops at Agent-origin proof.

`client-v1-c4-physical-agent-qualification.test.mjs` explicitly states:

- C4 exit requires Agent-origin proof;
- result proof may be recorded;
- useful verified work + restart belong to the next client gate.

The existing execution proof already binds:

- exact Client request
- workspace / plan / point / task
- lease generation
- z.ai Agent-origin causal digest
- result claim digest
- result-origin conversation digest
- accepted result state

But an accepted result is not yet evidence that a repository was edited, a real test/build executed, or a produced artifact was independently verified.

That gap is the target of this slice.

## Implementation

New verifier:

`apps/metaengine-browser/src/client-useful-work-proof.mjs`

Schema:

`metaengine.client-v1.useful-work-proof.v1`

The verifier is read-only. It does not:

- submit goals
- schedule agents
- execute commands
- change Supabase
- retry effects
- publish releases
- promote roadmap state

It consumes an already-normalized completed Client execution proof and a digest-only useful-work evidence projection.

### Exact binding

A positive proof must match the existing execution proof on:

- request ID
- workspace ID
- roadmap ID
- plan generation
- alignment epoch
- baseline SHA
- plan SHA-256
- point ID
- task ID
- task-spec SHA-256
- lease generation
- result SHA-256
- result-claim SHA-256
- Agent-origin conversation URL SHA-256

The execution proof must already be:

- `COMPLETED`
- terminal
- Agent-origin proven
- result available
- result claim valid
- result origin-bound
- result accepted

A merely `RESULT_READY` result is insufficient.

## Useful-work criteria

### 1. Repository checkout

Required:

- exact checkout SHA equals the Client goal baseline SHA
- repository identity digest
- source snapshot digest
- isolated workspace
- host repository not mounted
- host `.git` not mounted
- linked Git worktree not exposed as a security boundary
- source snapshot read-only

### 2. Isolated materialized edit

Required:

- patch SHA-256
- changed-file manifest SHA-256
- at least one changed file
- at least one materialized edit operation
- edit materialized
- protected root unchanged
- host repository unchanged

### 3. Real repair verification

Required:

- command-contract digest
- observed failing pre-repair test
- non-zero pre-repair exit code
- observed passing post-repair test
- zero post-repair exit code
- real build-or-test flag
- repair verified

This makes the proof distinguish a real repaired behavior from a generated textual answer.

### 4. Verified artifact

Required:

- artifact SHA-256
- positive artifact byte size
- subject digest exactly equals artifact digest
- provenance digest
- verification receipt digest
- provenance verified
- subject digest verified
- artifact verified

### 5. Independent review

Required:

- review receipt digest
- independent verifier
- acceptance
- accepted artifact digest equals the verified artifact digest

## Evidence classes

The contract makes evidence class explicit.

Allowed classes:

- `LIVE`
- `SYNTHETIC`

Allowed origins:

- `SIGNED_SUPERVISOR_READBACK`
- `CONTROLLED_FIXTURE`

Only this exact pair may produce:

`client_c5_useful_work_verified=true`

`LIVE + SIGNED_SUPERVISOR_READBACK`

A controlled synthetic fixture can validate contract structure, but must return:

`client_c5_useful_work_verified=false`

This prevents unit tests and fixtures from becoming accidental live claims.

## Canonical promotion fence

Even a fully valid LIVE C5 proof returns:

`canonical_c2_promotion_authorized=false`

It also returns the five canonical-shaped criteria as evidence facts:

- `repo_checkout=true`
- `isolated_edit=true`
- `real_build_or_test=true`
- `verified_artifact=true`
- `serial_loop_end_to_end=true`

This is intentional: Client evidence can satisfy the shape of C2 evidence without bypassing R1/C1 dependencies, Supervisor review, or checkpoint sealing.

## Privacy / authority membrane

The proof forbids raw fields such as:

- repository URL/path
- host workspace path / git dir
- raw patch/diff
- stdout/stderr
- artifact path
- model output
- page content
- result summary
- agent/tab/target identities

Only bounded digests and verification facts cross the proof boundary.

All authority flags remain false:

- `automatic_retry_allowed=false`
- `scheduler_authority=false`
- `browser_authority=false`
- `release_authority=false`
- `authority_effect=false`

## Adversarial tests

New suite:

`apps/metaengine-browser/test/client-v1-c5-useful-work-proof.test.mjs`

It verifies positive and fail-closed behavior for:

- full LIVE chain
- synthetic non-promotion
- explicit absence
- RESULT_READY rejection
- execution binding drift
- Agent/result binding drift
- baseline checkout drift
- host repository mount rejection
- empty edit rejection
- host-root mutation rejection
- missing failing pre-test
- failed post-repair test
- artifact subject digest drift
- unverified provenance
- wrong reviewed artifact
- non-independent review
- raw content / scheduler identity leakage
- evidence-class summary mismatch

The workflow also re-runs the existing Agent-origin/result and execution-proof integrity suites.

## Exact CI evidence

Workflow:

`Client V1 C5 Useful Work Contracts`

Exact head:

`022a342e8bcb8ae5e9ddb1839d0a53187b5b27cd`

Run:

`37393794142`

Job:

`112044813752`

Conclusion: **SUCCESS**

Test result:

- tests: **38**
- pass: **38**
- fail: **0**
- skipped: **0**

The workflow also proved that the source checkout remained unchanged.

## Amplifier research

### SLSA provenance

SLSA defines provenance as verifiable information describing where, when, and how an artifact was produced. Build provenance binds a produced artifact to the build process and source/materials.

Relevant source:

https://slsa.dev/spec/v1.2/provenance

Applied decision:

A Client result cannot be called useful verified work merely because it contains a success message. The output artifact must be content-addressed and its production provenance independently verifiable.

### GitHub artifact attestations

GitHub artifact attestations establish build provenance for binaries and support independent verification of the artifact subject.

Relevant source:

https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations

Applied decision:

The C5 contract separates:

- artifact digest
- provenance digest
- verification receipt
- subject-digest verification

This lets a later physical producer use GitHub attestations, SLSA, or another compatible trusted verifier without weakening the client contract to “file exists”.

### Fresh hosted runners

GitHub documents that standard hosted Windows jobs run on a fresh VM instance.

Relevant source:

https://docs.github.com/en/actions/reference/runners/github-hosted-runners

Applied decision:

Fresh Windows VMs remain useful for installer/runtime qualification, but they do not replace the persistent Linux worker required by canonical C1 and they do not prove a useful coding loop.

## Non-claims

This checkpoint does not prove:

- a live z.ai Agent performed the useful work
- a real repository was edited by the Client path
- a live failing test was repaired
- a live artifact was produced
- restart continuity of useful work
- canonical C2 completion
- R1/C1 completion
- production release readiness

The positive unit fixture is contract-only and must not be cited as LIVE evidence.

## Next physical exit gate

The next physical step is not another schema.

It is one bounded live Client goal with the following evidence chain:

1. C4 Agent-origin proof is already positive for the exact request.
2. The selected task checks out the exact baseline into an isolated workspace.
3. One intentionally failing test is observed.
4. The Agent makes a bounded edit.
5. The same test/build passes.
6. One artifact is emitted with a stable digest.
7. Independent verification confirms artifact subject/provenance.
8. A signed Supervisor readback projects only the digest-level C5 proof.
9. Client reconciles that proof without replaying the goal/effect.
10. A restart test later proves the same accepted useful-work state survives without blind replay.

Live goal submission / provider actuation is intentionally outside this PREPARE_ONLY slice.

## Checkpoint state

Client C5 useful-work contract: **EVIDENCE_READY / PREPARE_ONLY**.

Physical C5 useful work: **NOT_PROVEN**.  
Canonical C2: **NOT_PROVEN**.  
Canonical promotion authority: **false**.
