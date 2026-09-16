# METAENGINE RSI V1 — Evidence-Gated Recursive Self-Improvement

Status: IMPLEMENTED SHADOW FOUNDATION / NO LIVE AUTHORITY

Base: `release/self-update-ambiguity-live-v2 @ a0af13c0640fffb4b6d5da1645220e32786b5ec0`

Branch: `work/metaengine-rsi-v1-shadow`

## Purpose

METAENGINE RSI V1 turns the existing Browser Brain + Fleet + DevOS + evidence/readback + self-update stack into a bounded recursive improvement loop without adding a second scheduler or granting model output direct mutation authority.

The initial slice is deliberately shadow-only. It can represent candidate lineage and independently evaluated evidence, but it cannot execute browser effects, mutate production, promote a release, invoke self-update, or authorize retries.

## Core loop

`observe -> hypothesize -> isolated candidate -> independent evaluation -> archive -> shadow qualification`

A future admitted slice may extend this to:

`shadow qualification -> isolated BrowserCell canary -> external promotion gate -> existing self-update -> successor Browser -> next RSI generation`

The existing self-update/effect authority remains authoritative. RSI does not create a parallel actuation path.

## Immutable trust boundary

RSI candidates MUST NOT mutate these surfaces through the RSI mutation contract:

- signing keys
- artifact verification root
- evaluator root
- source identity root
- permission boundary
- one-attempt effect semantics
- rollback authority

The current V1 code enforces this boundary before a candidate can enter the archive.

## Allowed mutation surfaces in V1

- `PROMPT_ROUTING`
- `AGENT_ORCHESTRATION`
- `TOOL_INTERFACE`
- `BROWSER_RUNTIME`
- `RSI_IMPROVER`

`RSI_IMPROVER` is represented now so recursive lineage can be modeled, but it still has zero execution/promotion authority in V1.

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

There is intentionally no transition from `SHADOW_QUALIFIED` to production in this slice.

## Evidence properties

- exact 40-hex parent SHA
- exact 40-hex candidate SHA
- evaluator identity
- evaluator SHA-256 digest
- bounded evidence references
- per-evidence SHA-256 digest
- append-once hard invariant identity
- append-once objective identity
- deterministic final digest over lineage + verdict evidence

Model text is evidence input only; it is never authority.

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

## Acceptance for this slice

1. Candidate lineage rejects non-exact source identities.
2. Trust-root mutation surfaces are rejected before evaluation.
3. Evidence cannot overwrite an already-recorded invariant verdict.
4. Missing hard evidence blocks qualification.
5. Any hard invariant failure rejects a candidate regardless of performance gain.
6. Full hard-invariant PASS plus at least one improved objective yields only `SHADOW_QUALIFIED`.
7. Snapshot and candidate records explicitly carry zero actuation/promotion/retry authority.
8. Existing `node --test test/*.test.mjs` discovers the RSI contract tests automatically.

## Next slices

### RSI V1.1 — Shadow Observer

Consume bounded Browser Brain / DevOS telemetry and emit candidate hypotheses without mutation authority. Candidate generation must carry exact observed source SHA and evaluator epoch.

### RSI V1.2 — Isolated Candidate Builder

Bind one RSI candidate to one DevOS workspace/worktree and exact parent SHA. Candidate build output receives an immutable artifact digest. No live Browser replacement.

### RSI V1.3 — Evaluator Mesh

Map existing test, chaos, security, latency, memory, source-identity, and ambiguity/effect gates into independent evaluator receipts. The candidate must not be able to modify its evaluator root.

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
- no second self-update mechanism
- no model-decided promotion
- no blind retry after ambiguous physical effects
- no weakening of R4/R5/R6 ambiguity fencing
