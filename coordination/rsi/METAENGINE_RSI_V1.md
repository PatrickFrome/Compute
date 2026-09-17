# METAENGINE RSI V1 — Evidence-Gated Recursive Self-Improvement

Status: V1.3 EVALUATOR MESH IMPLEMENTED / EXACT-HEAD CI PENDING / NO LIVE AUTHORITY

Base: `release/self-update-ambiguity-live-v2 @ a0af13c0640fffb4b6d5da1645220e32786b5ec0`

Branch: `work/metaengine-rsi-v1-shadow`

## Purpose

METAENGINE RSI V1 turns the existing Browser Brain + Fleet + DevOS + evidence/readback + self-update stack into a bounded recursive improvement loop without adding a second scheduler or granting model output direct mutation authority.

The current line remains shadow-only. It can observe bounded Brain state, create a pre-lease DevOS experiment proposal, prepare an isolated candidate materialization contract, bind canonical DevOS workspace readback to an exact candidate, and admit externally produced evaluator receipts into the existing shadow archive. It still cannot execute browser effects, create task/workspace authority, mutate production, promote a release, invoke self-update, or authorize retries.

## Core loop

Implemented through V1.3:

`Brain snapshot -> shadow opportunity -> DevOS pre-lease experiment -> isolated materialization contract -> canonical workspace-binding readback -> external DevOS materialization receipt -> digest-bound Candidate Capsule -> PREPARE_ONLY sandbox handoff -> immutable Evaluator Mesh plan -> external evaluator receipts -> RsiShadowArchive -> SHADOW_QUALIFIED | REJECTED | BLOCKED`

Still future:

`isolated BrowserCell shadow tournament -> external promotion gate -> existing self-update -> successor Browser -> next RSI generation`

The existing DevOS scheduler, workspace authority, verification sandbox, promotion path, self-update path and one-attempt effect semantics remain authoritative. RSI does not create parallel actuation paths.

## Immutable trust boundary

RSI candidates MUST NOT mutate:

- signing keys
- artifact verification root
- evaluator root
- source identity root
- permission boundary
- one-attempt effect semantics
- rollback authority

V1.2 rejects candidate mutation paths that reach canonical tests/evaluators, Supabase contracts, build/signing material, Browser Guardian/native Guardian, Supervisor/native Supervisor, self-update, emergency-update authority, candidate capsule verification, verification-sandbox verification, the RSI shadow evaluator core, or the isolated-candidate builder.

V1.3 adds defense in depth at evaluation admission. The trusted Evaluator Mesh independently inspects Candidate Capsule components and rejects any candidate that mutates its evaluator/trust-root files, even if an upstream materializer incorrectly admitted such a component.

## Allowed mutation surfaces

- `PROMPT_ROUTING`
- `AGENT_ORCHESTRATION`
- `TOOL_INTERFACE`
- `BROWSER_RUNTIME`
- `RSI_IMPROVER`

Materialization remains narrower than this conceptual list: only bounded relative paths under `apps/metaengine-browser/src/` or `apps/metaengine-browser/ui/` may be proposed, and immutable-path fences still apply.

`RSI_IMPROVER` exists so recursive lineage can be modeled later. It does not grant the candidate authority over the evaluator, promotion, self-update, scheduler, workspace, or running Browser.

## Hard invariants

A candidate cannot become `SHADOW_QUALIFIED` until all six invariants have independent PASS receipts:

- `NO_DUPLICATE_IRREVERSIBLE_EFFECT`
- `NO_AUTHORITY_VIOLATION`
- `NO_WORKSPACE_ESCAPE`
- `EXACT_SOURCE_IDENTITY`
- `NO_SECURITY_REGRESSION`
- `NO_AMBIGUOUS_EFFECT_RETRY`

Any FAIL makes the candidate `REJECTED`. Any missing invariant makes evaluation inadmissible or the archive result `BLOCKED`. Objective gain can never override a hard failure.

## Candidate state machine

`PROPOSED -> EVALUATING -> SHADOW_QUALIFIED | REJECTED | BLOCKED`

There is intentionally no production transition in V1.3.

## V1.1 — Shadow Observer

Implemented by `rsi-shadow-observer.mjs` and `rsi-devos-experiment-plan.mjs`.

The observer consumes bounded Browser Brain projections and emits zero-authority opportunities. The DevOS bridge converts one opportunity into a deterministic pre-lease experiment plan with exact source SHA and explicit statements that no lease, agent, workspace, command, production mutation, promotion, self-update, or automatic retry was created.

## V1.2 — Isolated Candidate Builder

Implemented by `rsi-isolated-candidate-builder.mjs`.

The builder does not own a scheduler, Git-worktree security boundary, sandbox runtime, or filesystem actuator. It links trusted existing primitives through a two-phase protocol.

### Prepare

`prepareRsiIsolatedCandidateBuild()` binds:

- exact parent SHA
- bounded packaged-source snapshot
- explicit mutation manifest
- existing DevOS scheduler/workspace authority
- optional trusted verification backend preference

It requires canonical `metaengine.devos.workspace-binding-snapshot.v1` evidence, exact `base_sha == parent_sha`, exact `last_verified_head_sha == parent_sha`, current lease, no dirty/ambiguity hold, private writable layer, no host repository mount, bounded files/bytes and no arbitrary command field.

### Finalize

`finalizeRsiIsolatedCandidateBuild()` accepts only an external DevOS materialization receipt and verifies exact plan/experiment/parent/candidate/branch identity, exact workspace readback, exact mutation set, input/output manifest digests, isolation and zero authority.

Only after those checks does it reuse:

1. `candidate-capsule.cjs` for a digest-bound, non-executable candidate capsule.
2. `verification-sandbox-plan.cjs` for a `PREPARE_ONLY`, source-read-only, host-repo-unmounted, deny-all-network sandbox plan.
3. `RsiShadowArchive` for the zero-authority candidate lineage.

The V1.2 handoff is `eligible_for_evaluation=true`, `eligible_for_promotion=false`, and materialization replay is not authorized.

## V1.3 — Immutable Evaluator Mesh

Implemented by `rsi-evaluator-mesh.mjs`.

The Evaluator Mesh is an admission/verification layer, not an executor. It does not run tests itself and does not invent PASS evidence. It defines the immutable mapping that external trusted evaluators must satisfy before their receipts can enter the archive.

### Hard evaluator root

The root contains one fixed evaluator per hard invariant:

- `rsi.source-identity.v1` -> `EXACT_SOURCE_IDENTITY`
- `rsi.workspace-isolation.v1` -> `NO_WORKSPACE_ESCAPE`
- `rsi.authority-boundary.v1` -> `NO_AUTHORITY_VIOLATION`
- `rsi.effect-once.v1` -> `NO_DUPLICATE_IRREVERSIBLE_EFFECT`
- `rsi.ambiguity-retry.v1` -> `NO_AMBIGUOUS_EFFECT_RETRY`
- `rsi.security-regression.v1` -> `NO_SECURITY_REGRESSION`

The candidate cannot select, remove, replace, skip, or override these evaluators. The root itself has a SHA-256 digest and records the immutable component paths that an admitted candidate may not mutate.

### Objective root

V1.3 permits independent measurements for:

- `task_success_rate` / MAXIMIZE
- `p95_latency_ms` / MINIMIZE
- `tokens_per_success` / MINIMIZE
- `peak_rss_bytes` / MINIMIZE
- `recovery_p95_ms` / MINIMIZE

There is no authoritative scalar reward. Pareto measurements are preserved. At least one objective receipt is required, and archive qualification still requires at least one actual improvement.

### Receipt contract

Every receipt is digest-bound to:

- evaluator mesh plan id/digest
- exact Candidate Capsule identity
- exact candidate SHA
- exact V1.2 handoff digest
- immutable evaluator id/digest/runner identity
- bounded evidence references
- PASS/FAIL invariant result or exact objective measurement

Receipts must declare `external_evaluator=true` and `authored_by_candidate=false`. Duplicate evaluator receipts are rejected. Missing hard evaluators are rejected before archive mutation.

`applyRsiEvaluatorMesh()` mutates only the in-memory `RsiShadowArchive` state machine: it starts evaluation, appends already-verified receipts, finalizes the candidate, and always returns `eligible_for_promotion=false` with zero execution/self-update/retry authority.

### Defense in depth

V1.3 rejects Candidate Capsule components that touch evaluator-root files including the evaluator mesh, shadow core, isolated builder, candidate capsule verifier, verification sandbox verifier, Browser identity signer and trusted release resolver. This is deliberately redundant with V1.2 mutation fencing.

## Evidence properties

- exact 40-hex parent/candidate SHA
- exact source snapshot digest
- exact workspace-binding readback digest
- exact input/output manifest digests
- digest-bound build/materialization/candidate/sandbox handoff
- deterministic evaluator-root digest
- exact per-evaluator digest and runner identity
- exact candidate/handoff-bound evaluator receipt digest
- bounded evidence references
- append-once hard invariant/objective identity
- deterministic final archive digest

Model/page text is evidence input only; it is never authority.

## Durable archive contract

`apps/metaengine-browser/supabase/rsi-shadow-archive-v1.sql` remains rollback-only source contract, not deployed production DDL. It preserves `shadow_only=true` and false authority flags for execution, production mutation, promotion, self-update and automatic retry.

## Acceptance through V1.3

1. Non-exact lineage is rejected.
2. V1.2 workspace readback must prove exact parent base/head and current clean lease.
3. Host repository/worktree exposure and mutation-set substitution are rejected.
4. Candidate Capsule stays non-executable/non-promotable and sandbox stays `PREPARE_ONLY` with deny-all initial network.
5. Evaluator root is deterministic, digest-bound and candidate-nonselectable.
6. Candidate components that mutate evaluator-root files are rejected at V1.3 admission.
7. Receipts are exact-bound to candidate SHA, handoff digest and canonical evaluator digest.
8. Candidate-authored, runner-substituted, tampered, duplicate or incomplete evaluator receipts are rejected.
9. Every hard PASS plus an improved objective can yield only `SHADOW_QUALIFIED`, never promotion authority.
10. Any hard FAIL yields `REJECTED` regardless of objective gain.
11. No objective improvement yields `BLOCKED` even when all hard invariants pass.
12. Existing `node --test test/*.test.mjs` discovers the RSI tests automatically.

## Qualification state

V1.3 is implemented but is not declared VERIFIED until the latest exact branch head completes the existing Browser qualification fan-out. Older green runs are lineage evidence only; they do not substitute for exact-head qualification.

## Next slices

### RSI V1.4 — BrowserCell Shadow Tournament

Run incumbent and candidate in isolated BrowserCells against the same bounded workload identity. Capture external receipts for success, latency, memory, recovery and effect safety. Preserve Pareto outcomes and stepping-stone candidates rather than collapsing everything to one scalar score.

### RSI V1.5 — External Promotion Gate

Only after independent qualification may an existing trusted promotion/self-update path consume a signed admission receipt. RSI itself remains unable to promote or invoke self-update.

### RSI V2 — Recursive Improver

Allow an admitted candidate to mutate the proposer/search/improver implementation only inside an isolated branch. The resulting improver must be evaluated by the unchanged external evaluator root before it can become the parent of a subsequent RSI generation.

## Non-goals

- no self-modifying running Electron process
- no direct production DDL
- no second task scheduler
- no second workspace authority
- no second sandbox implementation
- no second self-update mechanism
- no model-decided promotion
- no candidate-controlled evaluator root
- no candidate-authored PASS evidence
- no linked Git worktree treated as a sandbox
- no host repository mounted into untrusted candidate execution
- no blind retry after ambiguous physical effects
- no weakening of R4/R5/R6 ambiguity fencing
