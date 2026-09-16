# METAENGINE RSI V1 — Evidence-Gated Recursive Self-Improvement

Status: V1.2 ISOLATED CANDIDATE BUILDER IMPLEMENTED / NO LIVE AUTHORITY

Base: `release/self-update-ambiguity-live-v2 @ a0af13c0640fffb4b6d5da1645220e32786b5ec0`

Branch: `work/metaengine-rsi-v1-shadow`

## Purpose

METAENGINE RSI V1 turns the existing Browser Brain + Fleet + DevOS + evidence/readback + self-update stack into a bounded recursive improvement loop without adding a second scheduler or granting model output direct mutation authority.

The current line remains shadow-only. It can observe bounded Brain state, create a pre-lease DevOS experiment proposal, prepare an isolated candidate materialization contract, bind a confirmed external DevOS materialization receipt to an exact candidate capsule, and prepare the candidate for independent sandbox evaluation. It cannot execute browser effects, create task/workspace authority, mutate production, promote a release, invoke self-update, or authorize retries.

## Core loop

Implemented through V1.2:

`Brain snapshot -> shadow opportunity -> DevOS pre-lease experiment -> isolated materialization contract -> canonical DevOS workspace-binding readback -> external DevOS materialization receipt -> digest-bound candidate capsule -> PREPARE_ONLY sandbox handoff -> shadow archive proposal`

Still future:

`independent evaluator mesh -> shadow qualification -> isolated BrowserCell canary -> external promotion gate -> existing self-update -> successor Browser -> next RSI generation`

The existing DevOS scheduler, workspace authority, verification sandbox, promotion path, and self-update/effect authority remain authoritative. RSI does not create parallel actuation paths.

## Immutable trust boundary

RSI candidates MUST NOT mutate these surfaces through the RSI mutation contract:

- signing keys
- artifact verification root
- evaluator root
- source identity root
- permission boundary
- one-attempt effect semantics
- rollback authority

V1.2 additionally rejects candidate mutation paths that reach canonical tests/evaluators, Supabase contracts, build/signing material, Browser Guardian/native Guardian, Supervisor/native Supervisor, self-update, emergency-update authority, candidate capsule verification, verification-sandbox verification, the RSI shadow evaluator core, or the isolated-candidate builder itself.

## Allowed mutation surfaces in V1

- `PROMPT_ROUTING`
- `AGENT_ORCHESTRATION`
- `TOOL_INTERFACE`
- `BROWSER_RUNTIME`
- `RSI_IMPROVER`

V1.2 materialization is intentionally narrower than the conceptual surface set: branch-local candidate components must be relative paths under `apps/metaengine-browser/src/` or `apps/metaengine-browser/ui/` and must pass the immutable-path fence.

`RSI_IMPROVER` is represented so recursive lineage can be modeled, but it still has zero execution/promotion authority. Mutation of the immutable RSI evaluator/materializer roots remains forbidden.

## Hard invariants

A candidate cannot become `SHADOW_QUALIFIED` until every invariant has independent PASS evidence:

- `NO_DUPLICATE_IRREVERSIBLE_EFFECT`
- `NO_AUTHORITY_VIOLATION`
- `NO_WORKSPACE_ESCAPE`
- `EXACT_SOURCE_IDENTITY`
- `NO_SECURITY_REGRESSION`
- `NO_AMBIGUOUS_EFFECT_RETRY`

Any FAIL makes the candidate `REJECTED`. Any missing invariant makes it `BLOCKED`.

A candidate also needs at least one objectively improved measured metric. Objective improvement never overrides a failed hard invariant.

## Candidate state machine

`PROPOSED -> EVALUATING -> SHADOW_QUALIFIED | REJECTED | BLOCKED`

There is intentionally no transition from `SHADOW_QUALIFIED` to production in V1.2.

## V1.1 — Shadow Observer

Implemented by `rsi-shadow-observer.mjs` and `rsi-devos-experiment-plan.mjs`.

The observer consumes only bounded Browser Brain projections and emits zero-authority opportunities for ambiguity/reliability/memory pressure. The DevOS bridge converts one opportunity into a deterministic pre-lease experiment plan with exact source SHA. The plan explicitly records:

- existing DevOS scheduler required
- no lease created
- no agent assigned
- no workspace bound
- no command created
- no execution/promotion/self-update/retry authority

## V1.2 — Isolated Candidate Builder

Implemented by `rsi-isolated-candidate-builder.mjs`.

V1.2 deliberately does not create or own a sandbox, Git worktree, task lease, or filesystem actuator. Instead it links already-existing trusted primitives through a two-phase protocol.

### Phase A — prepare

`prepareRsiIsolatedCandidateBuild()` accepts:

- a valid RSI DevOS pre-lease experiment plan
- exact parent SHA
- bounded DevOS source provenance snapshot
- explicit relative mutation manifest
- optional existing verification backend preference

It emits a deterministic digest-bound build plan. The plan requires the existing DevOS authority to provision/bind the workspace before materialization and declares that a linked Git worktree is not a security boundary.

The plan requires:

- canonical `metaengine.devos.workspace-binding-snapshot.v1` readback
- exact workspace `base_sha == parent_sha`
- exact `last_verified_head_sha == parent_sha`
- current DevOS lease
- no `dirty_hold` and no ambiguity code
- immutable source snapshot
- private writable layer
- no host repository mount
- exact candidate SHA distinct from parent
- input and output manifest digests
- bounded file count and mutation bytes
- no arbitrary command field
- unchanged evaluator/artifact/effect trust roots
- deny-by-default verification network
- zero automatic retry

### Phase B — finalize

`finalizeRsiIsolatedCandidateBuild()` accepts only a materialization receipt produced under the existing DevOS authority. It validates:

- plan id/digest and experiment identity
- exact parent and distinct exact candidate SHA
- exact target branch
- canonical DevOS workspace-binding readback with one exact workspace match
- exact parent equality for both `base_sha` and `last_verified_head_sha`
- current lease, clean workspace and no ambiguity marker
- zero scheduler/browser/page authority in the binding proof
- no filesystem/worktree path exposure in the binding proof
- isolated workspace evidence
- no host repository mount
- no linked worktree exposure to the candidate
- read-only source snapshot plus private writable layer
- exact input snapshot digest
- exact mutation set (no path substitution)
- bounded materialized bytes/files
- zero execution/promotion/self-update/retry authority

Only after those checks does it reuse the existing Development Plane primitives:

1. `candidate-capsule.cjs` creates and verifies a digest-bound, non-executable candidate capsule.
2. `verification-sandbox-plan.cjs` creates and verifies a `PREPARE_ONLY` sandbox plan with immutable snapshot materialization and deny-all initial network.
3. The handoff emits a `shadow_archive_proposal` for the existing `RsiShadowArchive`.

The workspace binding proof is stored as a separate digest-bound `WORKSPACE_BINDING_READBACK` evidence item in the Candidate Capsule. The V1.2 handoff is `eligible_for_evaluation=true` and `eligible_for_promotion=false`. Materialization replay is explicitly unauthorized.

## Evidence properties

- exact 40-hex parent SHA
- exact 40-hex candidate SHA
- exact source snapshot digest
- exact canonical workspace-binding readback digest
- exact input/output manifest digests
- digest-bound build plan
- digest-bound materialization receipt projection
- digest-bound candidate capsule and component digests
- PREPARE_ONLY sandbox plan digest
- evaluator identity and SHA-256 digest once V1.3 runs
- bounded evidence references
- append-once hard invariant identity
- append-once objective identity
- deterministic final archive digest over lineage + verdict evidence

Model/page text is evidence input only; it is never authority.

## Durable archive contract

`apps/metaengine-browser/supabase/rsi-shadow-archive-v1.sql` defines a rollback-only storage contract. It is intentionally outside production migrations and ends in `rollback;`.

The source contract encodes the same zero-authority properties as the runtime:

- `shadow_only = true`
- `execution_authority = false`
- `production_mutation_authority = false`
- `promotion_authority = false`
- `self_update_authority = false`
- `automatic_retry_allowed = false`

It is not deployed DDL.

## Acceptance through V1.2

1. Candidate lineage rejects non-exact source identities.
2. Trust-root mutation surfaces and immutable paths are rejected before evaluation.
3. Source snapshot SHA must equal the experiment parent SHA.
4. Build plans are deterministic and tamper-evident.
5. A prepared plan carries no lease/workspace/materialization authority.
6. Finalization requires canonical workspace readback with `base_sha` and `last_verified_head_sha` exactly equal to parent.
7. Finalization rejects stale base/head, non-current lease, dirty/ambiguous binding, authority leakage and filesystem-path leakage.
8. Finalization rejects a no-op candidate whose SHA equals the parent.
9. Finalization rejects host-repository exposure and linked-worktree exposure.
10. Finalization rejects component/path substitution relative to the prepared mutation manifest.
11. Candidate Capsule verification remains non-executable and non-promotable.
12. Verification sandbox remains `PREPARE_ONLY`, source-read-only, host-repo-unmounted, and deny-all network.
13. The resulting archive proposal preserves exact parent/candidate lineage and zero actuation authority.
14. Existing `node --test test/*.test.mjs` discovers RSI contract tests automatically.

## Next slices

### RSI V1.3 — Evaluator Mesh

Map existing contract, chaos, security, latency, memory, source-identity, ambiguity/effect, package, and physical Browser gates into independent evaluator receipts. Evaluators consume the V1.2 candidate handoff; the candidate cannot modify or select its evaluator root.

### RSI V1.4 — BrowserCell Shadow Tournament

Run incumbent and candidates in isolated BrowserCells over the same bounded workload. Store Pareto measurements; do not collapse selection to one scalar reward.

### RSI V1.5 — External Promotion Gate

Only after independent qualification may an existing trusted promotion/self-update path consume a signed candidate admission receipt. RSI itself remains unable to promote.

### RSI V2 — Recursive Improver

Permit an admitted candidate to modify the proposer/search/improver implementation in an isolated branch. The improved improver is evaluated by the unchanged external evaluator root before becoming the parent for another improvement generation.

## Non-goals

- no self-modifying running Electron process
- no direct production DDL
- no second task scheduler
- no second workspace authority
- no second sandbox implementation
- no second self-update mechanism
- no model-decided promotion
- no linked Git worktree treated as a sandbox
- no host repository mounted into untrusted candidate execution
- no blind retry after ambiguous physical effects
- no weakening of R4/R5/R6 ambiguity fencing
