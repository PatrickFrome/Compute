# METAENGINE Client V1 C5 — LIVE Useful-Work Readiness Checkpoint

Date: 2026-10-06  
Status: **EVIDENCE_READY — PREPARE_ONLY / NO LIVE ACTUATION**  
Branch: `work/client-v1-c5-live-readiness-v1`  
Qualification discipline: exact-head workflow; the final report-containing SHA/run is recorded in draft PR #1129 to avoid a self-referential report-update loop.

## Roadmap reconciliation

Canonical Level-1 owner: **C2 — First Serial Coding Loop**.

The canonical acceptance shape remains:

`repo checkout → isolated edit → real build/test → verified artifact → serial loop end-to-end`.

This checkpoint does not execute that loop through a live Agent/provider. It removes ambiguity immediately before the live boundary by freezing the exact task, repository baseline, allowed edit surface, verification commands and expected artifact.

The canonical spine remains:

`R1 → C1 First Real Linux Worker → C2 First Serial Coding Loop`.

Client-side status:

- C5 useful-work proof contract: EVIDENCE_READY / PREPARE_ONLY
- C5 physical reference producer: EVIDENCE_READY / SYNTHETIC
- C5 restart continuity contract: EVIDENCE_READY / PREPARE_ONLY
- C5 installed-process restart continuity: EVIDENCE_READY / PREPARE_ONLY
- **C5 LIVE launch readiness capsule: EVIDENCE_READY / PREPARE_ONLY**
- C5 LIVE useful work: NOT_PROVEN
- canonical C2: NOT_PROVEN
- canonical promotion authority: false

## Why this slice exists

The existing C4 signed-canary runner can generate an objective and immediately perform signed enrollment plus Client goal submission.

That behavior is appropriate for a deliberate physical C4 qualification, but it is too broad as the first C5 useful-work execution boundary.

Before a C5 live effect, the following must already be immutable and independently testable:

1. exact source head;
2. exact objective text;
3. exact isolated fixture;
4. one and only one allowed changed path;
5. exact failing pre-repair command;
6. exact passing post-repair command;
7. exact build command;
8. expected changed-file manifest digest;
9. expected canonical patch digest;
10. expected artifact subject digest;
11. required LIVE/SIGNED_SUPERVISOR_READBACK evidence class;
12. separate human/environment authorization requirement.

The live call itself must not be the place where these decisions are invented.

## Implementation

New contract:

`coordination/client-v1/c5-live-readiness/client-c5-live-readiness.mjs`

New generator:

`coordination/client-v1/c5-live-readiness/client-c5-live-readiness-capsule.mjs`

New adversarial suite:

`coordination/client-v1/c5-live-readiness/client-c5-live-readiness.test.mjs`

Dedicated bounded fixture:

`coordination/client-v1/c5-live-readiness/fixture/`

Workflow:

`.github/workflows/client-v1-c5-live-readiness.yml`

## Packaging boundary

The readiness contract, generator, adversarial tests and bounded fixture live under:

`coordination/client-v1/c5-live-readiness/`

They are intentionally outside `apps/metaengine-browser/src/**/*`, which is the Electron builder's packaged runtime surface.

This prevents a PREPARE_ONLY launch contract from changing NSIS installer bytes or consuming a new immutable package identity.

## Canonical objective

The objective is a source constant, not free workflow input:

`Repair the single bounded Client C5 canary in coordination/client-v1/c5-live-readiness/fixture by changing only answer.mjs so the existing test passes, then run the existing build script to produce dist/live-artifact.json. Do not modify any other path, do not use network, and return only after the test and build pass.`

The contract requires both:

- exact objective equality;
- SHA-256 equality.

Changing the objective and recomputing only a new hash is therefore rejected.

## Bounded edit surface

Fixture root:

`coordination/client-v1/c5-live-readiness/fixture`

Only allowed changed file:

`coordination/client-v1/c5-live-readiness/fixture/answer.mjs`

Maximum changed files:

`1`

Required isolation:

- isolated workspace: true
- host repository mutation allowed: false
- host `.git` exposure allowed: false
- linked worktree allowed: false
- network required: false

The checked-in baseline is intentionally wrong:

`answer = 41`

The existing test requires:

`answer = 42`

The generator proves the baseline test really fails before repair.

## Verification commands

Pre-repair:

`node --test coordination/client-v1/c5-live-readiness/fixture/answer.test.mjs`

Post-repair:

same exact command.

Build:

`node coordination/client-v1/c5-live-readiness/fixture/build.mjs`

The generator executes all three in a separate `git clone --no-hardlinks` workspace.

Required observed states:

- pre-repair test: non-zero
- post-repair test: zero
- build: zero
- changed paths: exactly one

## Expected artifact

Artifact path:

`coordination/client-v1/c5-live-readiness/fixture/dist/live-artifact.json`

Schema:

`metaengine.client-v1.c5-live-artifact.v1`

Required semantic payload:

- `answer=42`
- `verified_behavior=answer-is-42`

Exact expected artifact SHA-256 from qualified head:

`71fe5c044aa937444d99eec4d0c27cc412c4aab31caba313a66630eda6d5f2f8`

The launch capsule also binds:

- command-contract SHA-256
- changed-file-manifest SHA-256
- canonical patch SHA-256
- expected artifact byte size
- fixture snapshot SHA-256
- repository identity SHA-256

A future LIVE useful-work proof must match those exact values.

## LIVE readback contract

A future accepted proof must be:

- `evidence_class=LIVE`
- `evidence_origin=SIGNED_SUPERVISOR_READBACK`
- baseline SHA equal to launch source head
- repository identity equal to capsule repository identity
- checkout SHA equal to launch source head
- command contract equal to capsule
- changed-file manifest equal to capsule
- patch digest equal to capsule
- artifact subject digest equal to capsule
- artifact bytes equal to capsule
- independent verifier required
- Agent-origin readback required
- result readback required

Synthetic proof cannot satisfy the live matcher.

## Separate dispatch-authorization contract

A readiness capsule never authorizes its own execution.

Schema:

`metaengine.client-v1.c5-live-dispatch-authorization.v1`

A future authorization must separately prove:

- exact capsule digest
- exact source head
- GitHub environment `client-v1-c5-live`
- environment protection verified
- required reviewer approved
- self-review not used
- explicit live-effect authorization
- single-flight execution
- automatic retry disabled
- scheduler authority false
- Browser authority false
- release authority false
- authority effect false

No such authorization evidence was created in this checkpoint.

## CI evidence

Workflow:

`Client V1 C5 Live Readiness`

The first complete implementation run before the packaging-boundary relocation was `37402809051` / job `112073560720` and concluded **SUCCESS** with 32/32 tests.

After relocation into `coordination/client-v1/c5-live-readiness/`, the same workflow remains the exact-head qualifier. The final report-containing head/run is recorded in draft PR #1129, because writing that run id back into this report would itself create a new head and another run.

Adversarial/test result:

- tests: **32**
- passed: **32**
- failed: **0**
- skipped: **0**

The test set includes the new LIVE-readiness adversarial suite plus existing useful-work and restart-continuity suites.

The workflow also proved:

- exact-head checkout;
- readiness implementation parses;
- no `fetch(`, enrollment endpoint, canary URL or `client-goal-submit` exists in the readiness implementation;
- isolated fixture pre-test really fails;
- canonical repair post-test really passes;
- canonical build succeeds;
- checkout stays unchanged.

## Readiness artifact

The first complete implementation artifact before relocation was artifact `11385692558`, digest `sha256:4dc8393fb11ca97ebbfbd82be49fd376af223960fc7a7aa8b0cb5327720b97f3`.

Final non-packaged capsule/artifact ids and digests are recorded in PR #1129 from the exact report-containing head.

The artifact contains:

- launch capsule;
- readiness receipt;
- expected changed-file manifest;
- expected canonical patch;
- expected deterministic live artifact.

## Explicit non-executable state

The qualified receipt records:

- `fixture_pre_repair_failed=true`
- `fixture_post_repair_passed=true`
- `fixture_build_passed=true`
- `canonical_repair_single_file=true`
- `environment_protection_verified=false`
- `live_effect_authorized=false`
- `provider_contacted=false`
- `goal_submitted=false`
- `execution_ready=false`
- `automatic_retry_allowed=false`
- `authority_effect=false`

This is intentional.

## Amplifier research — GitHub protected environments

GitHub documents that a job referencing an environment must satisfy the environment's protection rules before running or accessing environment secrets.

Required reviewers can be configured, and GitHub supports preventing users from approving workflow runs they triggered.

Relevant documentation:

https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments

https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments

Applied design:

Future C5 live effect credentials should exist only inside a dedicated `client-v1-c5-live` environment, and the effect job should not start until required-reviewer protection succeeds.

The current GitHub connector cannot read repository environment settings, so **environment protection is NOT_PROVEN** here. The capsule records that fact instead of assuming protection exists.

## Amplifier research — artifact attestations

GitHub artifact attestations can establish and independently verify build provenance for artifacts.

Relevant documentation:

https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations

Applied design:

A future live artifact may use GitHub artifact attestations as an additional provenance amplifier when repository/plan support permits it.

It is not silently made a prerequisite here because the C5 contract already requires:

- content-addressed artifact subject;
- provenance digest;
- independent verification receipt.

## Adversarial properties

The new contract rejects:

- objective substitution even with a recomputed digest;
- extra changed paths;
- more than one changed file;
- network-required execution;
- host-repository mutation permission;
- host `.git` exposure;
- linked-worktree authority;
- command drift;
- baseline drift;
- capsule digest drift;
- secret/token/private-key fields;
- synthetic evidence presented as LIVE;
- artifact digest drift;
- changed-file manifest drift;
- command-contract drift;
- dispatch without verified environment protection;
- dispatch without reviewer approval;
- self-review;
- dispatch without explicit live-effect authorization;
- non-single-flight dispatch;
- automatic retry.

## Non-claims

This checkpoint does not prove:

- protected GitHub environment actually exists;
- required reviewers are configured;
- environment secrets are configured;
- any provider credential is present;
- any live enrollment happened;
- any Client goal was submitted;
- any live Agent ran;
- any live repository edit happened;
- any live artifact was produced;
- canonical C2 completion;
- release promotion.

## Next boundary

The remaining step is now narrow.

Before one live run, external GitHub settings must prove:

1. environment `client-v1-c5-live` exists;
2. required-reviewer protection is active;
3. self-review is prevented where supported;
4. live credentials are environment-scoped rather than repository-wide.

Then one explicitly authorized single-flight execution may consume this exact capsule and submit the exact canonical objective.

That action would create a real provider/Agent effect and is outside this PREPARE_ONLY checkpoint.

## Checkpoint

C5 LIVE launch readiness:

**EVIDENCE_READY / PREPARE_ONLY**

Environment protection:

**NOT_PROVEN**

Live effect authorization:

**NOT_GRANTED**

Provider contacted:

**false**

Goal submitted:

**false**

Client C5 LIVE useful work:

**NOT_PROVEN**

Canonical C2:

**NOT_PROVEN**

Canonical promotion authority:

**false**
