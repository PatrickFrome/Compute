# A2 Browser R5C Singleflight Planner Accelerator — deep research

Date: 2026-08-28
Branch: `work/a2-browser-r5-semantic-action-cache`
Verified parent: R5B planner accelerator at `fecf2ed333283ec3cab78ff1ddbc7e01cfb71999`, workflow `33147577403`, artifact `9676372088`, digest `sha256:a961e09bf0377cfe9667841b6292c48fd90ac54c704b26bc905023e5802a3053`.

## Problem

R5A/R5B eliminate repeated planner/model work after the cache is warm. A remaining fleet-scale failure mode is a cold-miss stampede: many agents can observe the same empty semantic cache at nearly the same time and all invoke the expensive planner before the first result is promoted.

This wastes model capacity precisely when browser parallelism increases.

## Pre-implementation analogue research

### Go x/sync/singleflight

The official `golang.org/x/sync/singleflight` package provides duplicate function-call suppression. For one key, only one execution is in flight; duplicate callers wait and share completion. This is the cleanest reference model for suppressing duplicate cold work.

### Cloudflare cache-stampede/request collapsing

Cloudflare describes request collapsing/cache locking as a standard protection against a popular expired/missing cache entry sending a burst of identical origin work. The browser-planner analogue is direct: the model/planner is the expensive origin and the semantic action cache is the hot cache.

### Playwright parallelism

Playwright scales independent work through worker processes and supports sharding across machines. This reinforces that A2 should expect concurrency to grow rather than serialize the entire browser fleet. The correct optimization is therefore per-semantic-key collapse, not a global planner lock.

## Why ordinary singleflight is insufficient for a browser agent

A normal singleflight implementation can share the leader's result with every waiter. A2 cannot safely share an ephemeral browser node reference that way:

- Extension and Compute Browser have different node-ref spaces.
- even inside one surface, each follower may hold a newer perception envelope.
- geometry/DOM working-set churn can replace a ref without changing semantic intent.

Therefore R5C shares **completion of expensive planning**, not the leader's ephemeral browser identity.

## R5C design

`CachedSemanticPlanner` now owns a bounded in-memory `inFlight` map.

The singleflight key is the exact semantic cache identity:

`target_id / context_id / conversation_epoch / document_epoch / intent_id / action_kind`

### Leader

1. Claims the key.
2. Invokes the planner/model once.
3. Validates the selected node through R5A eligibility.
4. Promotes only semantic/locator fingerprints into the cache.
5. Removes the in-flight record in `finally`.

### Follower

1. Waits for the leader to finish.
2. Does **not** consume the leader's candidate ref.
3. Calls cache resolution again with its own fresh perception envelope.
4. If semantic revalidation succeeds, returns its own fresh candidate ref as `CACHE_COALESCED_REVALIDATED`.
5. If revalidation fails, loops and may become a new leader for the same key, ensuring incompatible semantic evidence never inherits the earlier target.

### Failure collapse

If the leader planner fails, current followers receive the same failure rather than immediately creating a planner stampede. No cache record is promoted.

### Resource bound

`maxInFlight` defaults to 256 and is fail-closed. Unique-key overload cannot create an unbounded in-memory wait graph.

## Safety invariants preserved

Every result remains:

- `authority_effect=false`
- `actuation_eligible=false`
- `revalidation_required=true`
- `must_run_actionability_checks=true`

Singleflight never caches action payloads and never persists planner context or ephemeral node refs.

The exact document/conversation/context/target namespace remains the causal fence.

## Verification additions

The planner contract suite now proves:

1. 64 concurrent identical cold misses collapse to exactly 1 planner call.
2. 63 followers revalidate and each receives its own fresh node ref.
3. Different document epochs do not coalesce.
4. A follower with different semantic evidence cannot inherit the leader ref and performs fresh planning.
5. 32 simultaneous callers share one planner failure; planner call count remains 1.
6. in-flight cardinality is bounded and overflow fails closed.

## Compute-throughput implication

R5B removes repeated inference after warm-up. R5C removes duplicate inference during warm-up. Together they attack both steady-state and burst duplication.

For a perfectly identical 64-way cold burst, the deterministic planner-call reduction target is 64 -> 1 (98.4375% fewer planner invocations for that burst). This is a call-count property, not a production latency or token-cost claim.

## Post-implementation direction

The next highest-value step is not remote persistence yet. It is real surface integration plus measurement:

- wire the planner accelerator at the Extension and Compute Browser planning boundary;
- measure planner calls requested/avoided/collapsed;
- measure p50/p95 planning latency and perception overhead;
- record ambiguity/revalidation failure rates;
- require wrong-target count to remain zero.

Once measured local semantics are stable, the later remote-browser-pool/adaptive-router milestones can scale horizontally without multiplying duplicated model work.
