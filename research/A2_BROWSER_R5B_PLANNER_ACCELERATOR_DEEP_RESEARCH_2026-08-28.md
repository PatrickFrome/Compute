# A2 Browser R5B Planner Accelerator — deep research

Date: 2026-08-28
Branch: `work/a2-browser-r5-semantic-action-cache`
Parent verified slice: R5A semantic action cache, CI `33147160394`, artifact `9676210155`, digest `sha256:f67a7f60191701341592d2d2320148f9bf38d20a2cc241bb3a206547d88d6494`.

## Goal

Increase effective browser-compute throughput by removing repeated model planning from stable semantic actions without turning a cached decision into browser authority.

The optimization target is model-seconds and token budget per successful browser action, not raw CPU benchmark throughput.

## Analogue comparison before implementation

### Stagehand v3

Stagehand documents server-side caching for `act`, `observe`, and `extract`; a cache HIT consumes no LLM tokens. Its recommended observe -> act pattern makes deterministic reuse a first-class performance path.

This is the strongest analogue for the *economic* optimization: expensive planning should happen once, then stable work should replay cheaply.

But current Stagehand action results expose XPath selectors. The project's own issue #1555 records that minor DOM structure changes can invalidate XPath-backed cached actions and force re-inference. Earlier issue #404 describes the same repeated-inference bottleneck that R5 is designed to remove.

### Playwright

Playwright locators represent logic for finding the element now, not a retained element identity. Every action resolves the locator against the current DOM again. It recommends role/name and other user-facing attributes over CSS/XPath and fails strict when several elements match.

Playwright also performs fresh actionability checks before a click: uniqueness, visibility, stability, receiving events, and enabled state.

This is the stronger analogue for the *correctness* boundary: reuse semantic intent, but resolve and validate current page state again before physical effect.

### Browser Use

Browser Use keeps browser-state/history representations for an agentic loop. That is useful for open-ended exploration and recovery, but it does not eliminate the repeated reasoning cost of stable atomic steps as aggressively as a deterministic action cache. Its history/replay bug reports are also a reminder that replay state needs explicit serialization and verification contracts.

## R5B design

`coordination/browser-shared/semantic-action-planner-v1.mjs` adds `CachedSemanticPlanner`.

Algorithm:

1. Receive the latest B4 `perception-envelope.v1` plus opaque `intent_id` and action kind.
2. Ask R5A cache to resolve against that fresh envelope.
3. On `HIT_REVALIDATED`, return the fresh candidate ref and do **not** invoke the planner/model.
4. On MISS, invoke the configured planner exactly once.
5. Validate the planner-selected node through R5A `put()` eligibility before promotion.
6. Return a non-authoritative plan result. The physical action layer still performs all existing live safety/actionability checks.

## Preserved safety boundaries

Every result remains:

- `authority_effect=false`
- `actuation_eligible=false`
- `revalidation_required=true`
- `must_run_actionability_checks=true`

R5B does not receive or store execution payloads as part of cache identity. A caller may pass current planning context to a fresh planner call, but only allowlisted, non-sensitive planner metadata can appear in the returned/snapshotted state. The cache still stores neither node refs nor typed values.

Planner errors do not promote cache entries.

Ambiguous cached targets do not guess: they become MISS and fall back to the fresh planner.

Cross-document changes remain fenced by `document_epoch`.

## Deterministic throughput criterion

The contract suite includes a 1000-request stable-intent run across alternating Extension and Compute Browser surfaces.

Required outcome:

- planner calls: 1
- cache misses: 1
- cache hits: 999
- planner calls avoided: 999

This is a deterministic call-count benchmark, not a wall-clock benchmark. It proves the architecture can reduce repeated planner inference by 99.9% for a fully stable hot intent after warm-up. It does **not** claim production hit rates or latency improvement.

## Why this is preferable to XPath replay

A2 stores semantic and locator fingerprints only as candidate hints under an exact document namespace. The current perception envelope must still contain a fresh eligible node. A unique semantic match survives geometry/DOM drift; coarse locator fingerprint is used only to disambiguate multiple semantic matches and never becomes authority.

This combines Stagehand's inference bypass with Playwright's fresh semantic resolution and strictness.

## Next benchmark gate

After CI verification, the next slice should instrument real planner boundaries on both browser surfaces and record:

- model/planner calls requested vs avoided
- cache hit/miss/ambiguity rates
- semantic revalidation failures
- p50/p95 planning latency
- page-perception cost
- wrong-target count (must remain zero)
- tokens/model-cost per successful action

Only after those measurements should durable/persistent cache sharing or remote cache distribution be considered.
