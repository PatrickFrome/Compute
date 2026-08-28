# A2 Browser R5 Semantic Action Cache — deep research

Date: 2026-08-28
Branch: `work/a2-browser-r5-semantic-action-cache`
Parent checkpoint: B4 perception parity `b89e1d28e38725a006e5f4b1653934eca9a9b870`

## Confirmed starting point

B4 CI run `33146514320` completed successfully on the exact B4 head and produced artifact `9675978262` with digest `sha256:bfbfa3d21cb3c8223bc1824628a9ae8ce90d8a76724d3ca9fce3046ee05b6984`.

The shared `perception-envelope.v1` already provides the mandatory cache namespace:

- `target_id`
- `context_id`
- `conversation_epoch`
- `document_epoch`

It also deliberately exposes semantic and geometry fingerprints as lookup hints rather than authority.

## Pre-implementation research

### Stagehand v3

Stagehand v3 supports deterministic replay of an observed action and server-side caching for `act`, `observe`, and `extract`. Its docs explicitly position cached `observe -> act` as a way to avoid repeated LLM work. This confirms the throughput value of moving stable browser steps from repeated inference to deterministic reuse.

However, Stagehand issue #1555 documents a weakness of XPath-heavy action caching: small DOM structural changes can invalidate cached actions even when the semantic target is unchanged. This is exactly the failure mode A2 should avoid.

### Playwright

Playwright locators are resolved against the current DOM at action time rather than holding a stale element handle. Playwright recommends user-facing semantic locators such as role/name and enforces strictness when multiple elements match.

Playwright also gates actions with fresh actionability checks. For click this includes uniqueness, visibility, stability, receiving pointer events, and enabled state. A2's perception envelope does not prove all of those conditions, so a cache hit must never itself authorize actuation.

### Browser Use comparison

Browser Use's agentic loop perceives an indexed DOM/accessibility representation and reasons again each step. That is excellent for exploration but comparatively expensive for stable repeated work. The best production pattern is therefore hybrid: agentic discovery on cache miss, deterministic semantic reuse on cache hit, with fresh target revalidation before effect.

### CDP identity constraints

`DOM.BackendNodeId` is an engine-side node identity and is useful for live CDP operations, but it is not a safe durable cross-surface cache key. B4 already prevents engine identity leakage from the shared envelope. R5 preserves that rule.

## Chosen R5 design

### 1. Cache planning, not authority

A cache hit returns a fresh candidate reference only after revalidating it against the latest perception envelope.

Every hit remains:

- `authority_effect=false`
- `actuation_eligible=false`
- `revalidation_required=true`
- `must_run_actionability_checks=true`

The physical-effect layer remains responsible for the final actionability and authority gates.

### 2. Full namespace fencing

An entry is reusable only inside the exact tuple:

`target_id / context_id / conversation_epoch / document_epoch`

This gives cheap same-document reuse while naturally invalidating cross-document navigation, target re-enrollment, conversation rollover, or context changes.

### 3. Semantic-first, geometry-second

Primary match: exact `semantic_fingerprint`.

If exactly one fresh eligible node matches, geometry drift is tolerated. This follows Playwright's semantic locator philosophy and avoids XPath-style brittleness.

If several nodes share the semantic fingerprint, `locator_fingerprint` (which contains coarse geometry) may disambiguate only when it selects exactly one node. Otherwise R5 fails closed with `AMBIGUOUS_TARGET`.

### 4. No stale node references

The cache accepts the current node ref only at insertion time so it can identify the chosen node inside the fresh envelope. The stored record contains no node ref.

A hit returns the ref from the new envelope, never an old ref.

### 5. No action payload caching

R5 does not cache typed text, fill values, passwords, tokens, cookies, headers, storage state, or other action arguments. This avoids turning the performance cache into a secret-bearing persistence plane.

Only an opaque `intent_id`, action kind, namespace, and semantic/locator fingerprints are retained.

### 6. No negative cache

Misses are not cached. Negative observations are especially dangerous because B4 visibility evidence intentionally distinguishes `VISIBLE` from `UNKNOWN` and does not currently assert `NOT_VISIBLE`.

### 7. Bounded lifetime and memory

Default TTL: 5 minutes.
Default capacity: 1024 records.
Eviction: LRU-like Map ordering.

Namespace fencing is the primary correctness boundary. TTL/capacity are secondary controls against long-lived SPA drift and unbounded memory growth.

## Implemented contract

`coordination/browser-shared/semantic-action-cache-v1.mjs`

Exports `SemanticActionCache` with:

- `put()`
- `resolve()`
- `invalidateNamespace()`
- `sweep()`
- `snapshot()`

The module is browser-surface-neutral and imports only the B4 shared perception contract.

## Verification matrix

`coordination/browser-shared/tests/semantic-action-cache-v1.test.mjs` covers:

1. Extension -> Compute Browser cross-surface reuse.
2. Exact namespace fencing for target/context/conversation/document epochs.
3. Geometry drift tolerance when semantic identity is unique.
4. Fail-closed ambiguity behavior.
5. Fresh visibility/capability requirement on put and resolve.
6. Rejection of action payload fields.
7. No stored ephemeral node refs.
8. TTL expiry and capacity eviction.
9. No negative caching.
10. Exact namespace invalidation.

## Performance implication

R5 targets effective compute throughput rather than raw hardware throughput. Stable repeated browser steps can bypass repeated LLM planning and repeated selector synthesis while still consuming a fresh lightweight perception envelope for safety. This converts a high-cost inference path into a deterministic lookup + semantic filter on cache hits.

The expected system-level effect is lower model-token consumption, lower decision latency, more browser actions per model-second, and more capacity for parallel browser workers. No numeric speedup is claimed until the next benchmark gate measures hit-rate, saved inference calls, p50/p95 latency, and false-hit rate.

## Post-implementation research conclusions

The implementation intentionally does **not** copy Stagehand's cached selector as an authoritative replay primitive. It combines the strongest parts of current analogues:

- Stagehand: skip inference for repeatable work.
- Playwright: re-resolve against the current page and require fresh actionability.
- B4 A2 parity: backend-neutral semantic fingerprints and document-scoped invalidation.

This produces a safer cache boundary for a system that must work across both an MV3 extension and a standalone Compute Browser.

## Next highest-value R5 step

R5B should integrate this shared cache into the planner boundary on both browser surfaces and measure:

- cache hit rate
- LLM calls avoided
- p50 / p95 plan latency
- semantic ambiguity rate
- revalidation failures
- cache-induced wrong-target count (must remain zero)

Only after those metrics are green should successful-action receipt promotion or durable cache persistence be considered.
