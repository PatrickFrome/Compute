# A2 Browser Operator / Compute Browser — R4 Semantic Perception Compiler Deep Research — 2026-08-28

## Decision

R4 is one shared, adapter-neutral semantic compiler used by both execution surfaces:

- Chrome MV3 extension;
- standalone A2 Compute Browser over native Chromium CDP pipe;
- later remote/browser-engine adapters.

Raw browser observation remains local to the execution surface. The reasoning plane receives a bounded `SemanticFrame`, not a full DOM/body dump by default.

`SemanticFrame` is perception only. It never grants action authority.

## Current external evidence

### Playwright MCP: accessibility-first, refs are snapshot-local

Current Playwright MCP uses structured accessibility snapshots as its default browser-agent representation. Interactive elements receive refs and vision is optional. Its documentation reports typical snapshot cost around 200–400 tokens versus roughly 3000–5000 tokens for screenshot/vision representation. More importantly for A2, Playwright explicitly limits element-ref lifetime to the current snapshot/page state; navigation or DOM changes require a new snapshot.

Primary sources:
- https://playwright.dev/mcp/snapshots
- https://playwright.dev/mcp/introduction
- https://playwright.dev/mcp/vision-mode

A2 decision: accessibility semantics should be the default reasoning representation, but an AX ref/AXNodeId must never become durable A2 identity or authority.

### Chromium CDP: backend DOM identity is a join key, not authority

`Accessibility.enable` keeps AXNodeIds consistent between calls while the domain remains enabled, with an explicit performance cost. `Accessibility.getFullAXTree` exposes accessible role/name/state and backend DOM references. `DOMSnapshot.captureSnapshot` returns a flattened DOM/layout snapshot. The common backend DOM identity gives A2 a deterministic way to join AX semantics to layout without page JavaScript.

Primary sources:
- https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/
- https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/

A2 decision:
- `backendDOMNodeId` is fresh binding evidence;
- it is not a stable logical `semantic_id`;
- action execution must revalidate the live backend binding immediately before physical effect.

### Anthropic browser-use: browser-specific page tools before general computer-use

The 20260801 browser-use toolset works inside a browser and uses accessibility/page state, forms, tabs and element references. Anthropic recommends it when the task is contained in webpages, reserving general computer-use for arbitrary desktop interaction.

Primary sources:
- https://platform.claude.com/docs/en/release-notes/overview
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-combinations

A2 decision: vision/coordinate grounding is a fallback layer, not the primary browser representation.

### WebMCP: first-party typed intent is the stronger future path

Chrome WebMCP exposes structured site tools intended to improve agent actuation reliability. The current imperative API has moved from deprecated `navigator.modelContext` to `document.modelContext` in Chrome 150.

Primary sources:
- https://developer.chrome.com/docs/ai/webmcp
- https://developer.chrome.com/docs/ai/webmcp/imperative-api

A2 decision: R4 must not hard-code a DOM-only worldview. R6 WebMCP will be another perception/action provider above the same target/context identity model.

## R4 SemanticFrame v1

```text
SemanticFrame
  frame_id
  target_id
  context_id
  document_epoch
  captured_at
  source_hashes
  tainted_page_data=true
  authority_effect=false
  semantic_authority=false
  binding_requires_live_revalidation=true
  nodes[]
  changes[]
  truncation
  metrics
```

Each node carries:

```text
semantic_id
role
name
value_summary
states
editable
clickable
focusable
visible
bounds
relevance_score
confidence
continuity
binding_epoch
structural_fingerprint
binding_evidence:
  backend_dom_node_id
  ax_node_id
  source_frame_id
ambiguous_with[]
```

All role/name/value/ARIA-derived fields remain tainted page data.

## Stable identity model

A2 separates three identities:

1. logical target identity: `target_id` / `context_id`;
2. semantic locator identity: `semantic_id`;
3. physical binding evidence: backend DOM / AX / renderer identifiers.

`semantic_id` is derived from logical target/context, document epoch, normalized role/name class, structural parent signature and duplicate ordinal. Coordinates are weak evidence only and never authority.

Continuity outcomes:

- `EXACT_BINDING`: same semantic identity and same live backend binding in the same document epoch;
- `STRUCTURAL_REBIND`: a unique semantic candidate survives a physical backend replacement;
- `NEW_NODE`: no sufficient continuity evidence;
- `AMBIGUOUS`: multiple plausible candidates; action auto-binding is forbidden.

Duplicate role/name/parent candidates are intentionally fail-closed. If their backend identities change, R4 emits `AMBIGUOUS` rather than guessing which duplicate survived.

A new document epoch fences previous physical continuity. A future adapter may still use the same higher-level target/conversation identity, but the physical binding must be rebuilt.

## Relevance and budget

R4 ranks interaction semantics before static page text:

High weight:
- textbox/searchbox/combobox/button/link/checkbox/radio/menuitem/tab;
- editable/focusable/clickable state;
- visible viewport intersection;
- state changes such as checked/expanded/disabled/busy;
- bounded task-vocabulary match.

Task vocabulary changes relevance only. It never changes taint, authority or action capability.

Default node budget: 80. Hard maximum: 200. Truncation is explicit with candidate/selected/dropped counts.

## Delta model

After a baseline frame, R4 emits bounded changes:
- `ADDED`
- `REMOVED`
- `UPDATED`
- `REBIND`
- `EVICTED_FROM_WORKING_SET`

The previous semantic frame is only continuity evidence. It is never a license to reuse a stale physical binding.

## Compute Browser adapter

R4 capture is internal CDP only:

```text
Target.attachToTarget(flatten=true)
  -> Page.enable
  -> Accessibility.enable
  -> Accessibility.getFullAXTree
  -> DOMSnapshot.captureSnapshot
  -> Page.getLayoutMetrics
  -> Page.getFrameTree
  -> compile SemanticFrame
  -> Accessibility.disable
  -> Target.detachFromTarget
```

The adapter does not use `Runtime.evaluate` and does not expose raw CDP, raw DOM, full AX trees or page body text over RPC.

Typed RPC adds only:

`perception.capture(profileId, targetId, nodeBudget?, taskTerms?) -> SemanticFrame`

Effect class: `READ_ONLY`. `web_authority_effect=false`.

The target must have an exact current `process_incarnation_id` binding from the B2/B3 runtime.

## Extension adapter

The exact same compiler file is loaded as a classic script before existing `operator-perception.js`. This preserves MV3 classic service-worker semantics and avoids an unrelated ESM conversion.

The current raw extension capture remains temporarily for compatibility. The next R4 parity slice will:
- resolve perception by `target_id` through `A2_TARGET_REGISTRY` rather than platform-only pinned URL;
- compile existing AX/DOMSnapshot material into `semantic_frame`;
- retain raw capture only behind local/debug compatibility surfaces;
- preserve existing physical action revalidation.

## Security adversarial cases required

- ARIA label contains prompt injection text;
- duplicate same-name buttons change backend nodes;
- document changes while semantic text stays identical;
- task terms match malicious page text;
- node budget truncates relevant/static mixtures;
- stale process incarnation attempts capture;
- missing or retired target attempts capture.

Expected invariant: attacker-controlled text may affect ranking or model reasoning, but it can never set `authority_effect`, bypass live revalidation, manufacture a trusted target binding or turn ambiguity into an action.

## Metrics

R4 records:
- source node count;
- semantic node count;
- raw compact observation bytes estimate;
- semantic frame bytes;
- node reduction ratio;
- exact binding / structural rebind / ambiguity rates in benchmark fixtures.

R14 will later promote these into full task-level metrics including tokens per successful task and target-resolution success.

## Non-goals

R4 adds no:
- navigation authority;
- click/type/submit authority;
- raw JavaScript/eval;
- arbitrary selector execution;
- semantic action cache (R5);
- WebMCP actuation (R6);
- durable action graph (R8).
