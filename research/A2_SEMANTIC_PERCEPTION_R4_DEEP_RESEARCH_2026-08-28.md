# A2 Browser Operator — R4 Semantic Perception Compiler Deep Research — 2026-08-28

## Goal

Create one adapter-neutral semantic perception format shared by:

- existing Chrome extension capture;
- standalone A2 Compute Browser over native CDP pipe;
- future remote/browser-engine adapters.

The compiler consumes tainted raw browser observations and emits a bounded `SemanticFrame`. It never grants authority by itself.

## External research

### Accessibility-first is the strongest default agent representation

Current Playwright MCP and Playwright CLI use accessibility snapshots with explicit element refs as their primary agent representation, with screenshots as a complementary visual channel. This substantially reduces the need for coordinate guessing and gives language models role/name/state structure directly.

Sources:
- https://github.com/microsoft/playwright.dev/blob/main/mcp/introduction.mdx
- https://playwright.dev/mcp/snapshots
- https://playwright.dev/agent-cli/snapshots

### Snapshot refs must not be treated as eternal identities

Playwright documents its element refs as stable within one snapshot and regenerated after page changes. A2 needs more continuity than that for long-lived chat workers, but should not pretend a DOM or AX node is permanently the same element.

Decision: A2 `semantic_id` may survive frames only after structural revalidation. Each SemanticFrame also carries a fresh physical binding/evidence object.

Source: https://playwright.dev/mcp/snapshots

### CDP provides a useful join key, not a durable authority key

`Accessibility.getFullAXTree` returns `backendDOMNodeId` and frame information. Enabling the Accessibility domain keeps AXNodeIds consistent between calls, but has a performance cost while enabled.

`DOMSnapshot.captureSnapshot` includes `backendNodeId`, DOM structure and layout information. Therefore A2 can merge accessible semantics with DOM/layout using backend DOM node identity without running page JavaScript.

Sources:
- https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/
- https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/

### Full trees need budgeted reduction

Playwright MCP's practical pattern is a compact accessibility-oriented snapshot rather than sending a full DOM to the model. A2 already captures much richer raw material, so the high-value work is compilation, pruning and delta generation rather than additional raw capture.

Source: https://github.com/microsoft/playwright.dev/blob/main/mcp/introduction.mdx

## A2 SemanticFrame v1

```text
SemanticFrame
  frame_id
  target_id
  context_id
  document_epoch
  captured_at
  source_hashes
  tainted_page_data=true
  nodes[]
  changes[]
  truncation
```

Each semantic node:

```text
semantic_id
role
name
value_summary
states
editable
clickable
focusable
bounds
frame_path
relevance_score
confidence
binding_evidence:
  backend_dom_node_id
  ax_node_id
  source_frame_id
binding_epoch
```

Page-derived name/value/attributes remain untrusted data. `semantic_id` is a locator identity, not authority.

## Stable semantic identity policy

A2 must not simply hash coordinates, text, AXNodeId or backendDOMNodeId.

Candidate continuity signature combines:

1. logical `target_id` + `context_id`;
2. document/frame lineage;
3. normalized role;
4. normalized accessible name class/fingerprint;
5. structural parent/neighbor signature;
6. current backend DOM binding when available;
7. geometry bucket as weak evidence only.

Continuity outcomes:

- `EXACT_BINDING`: same document epoch + same backend node + compatible semantic signature;
- `STRUCTURAL_REBIND`: physical node changed but semantic structure matches above threshold;
- `NEW_NODE`: insufficient evidence;
- `AMBIGUOUS`: multiple plausible matches; never auto-bind an action.

Navigation/new document invalidates physical bindings. Structural rebinding may preserve logical semantic_id with incremented `binding_epoch` only when confidence passes policy threshold.

## Relevance compiler

Default output should prioritize interaction/task semantics rather than raw source order.

High score:
- textbox/searchbox/combobox/button/link/checkbox/radio/menuitem/tab;
- focused or editable;
- changed since previous frame;
- visible and inside/near viewport;
- associated with current task vocabulary;
- actionable state change (`disabled`, `expanded`, `checked`, etc.).

Lower score:
- static duplicated text;
- off-screen layout-only nodes;
- decorative/ignored nodes;
- repeated navigation chrome unless task-relevant.

Initial agent budget target: 30–80 high-value semantic nodes plus explicit truncation metadata, not silent dropping.

## Delta-first perception

After a full baseline frame, subsequent observations should emit:

- added semantic IDs;
- removed semantic IDs;
- state/value/name changes;
- binding changes;
- focus/viewport changes.

The model receives delta + small current working set. A full refresh is forced after navigation, ambiguity, large mutation, stale age, or hash mismatch.

## Security model

1. All page-derived fields are `tainted_page_data=true`.
2. AX labels and ARIA attributes are untrusted and can contain prompt-injection text.
3. Semantic compiler may rank/describe nodes but cannot authorize an action.
4. Action guard must revalidate physical binding immediately before actuation.
5. Screenshot-only coordinates can suggest a candidate but never become durable authority.
6. Ambiguous rebinding must fail closed.
7. Raw HTML/body text should not be forwarded when a bounded semantic representation suffices.

## Adapter contract

### Extension adapter

Reuse existing capture primitives in `operator-perception.js` / OOPIF perception. Do not replace them. Compile their AX/DOM/layout output into SemanticFrame.

### Compute Browser adapter

Use internal CDP only:
- `Accessibility.enable`
- `Accessibility.getFullAXTree`
- `DOMSnapshot.captureSnapshot`
- `Page.getLayoutMetrics`

Avoid `Runtime.evaluate` for the core semantic capture path. Raw CDP remains inaccessible over external RPC.

## R4 implementation sequence

1. pure `SemanticPerceptionCompiler` with deterministic synthetic fixtures;
2. exact-binding + structural-rebind matcher;
3. relevance budget and explicit truncation;
4. frame delta engine;
5. Compute Browser capture adapter over native pipe;
6. extension adapter parity;
7. adversarial ARIA/prompt-injection fixtures;
8. benchmark raw bytes/tokens vs semantic bytes/tokens and target-resolution success.

## Required metrics

- raw observation bytes;
- semantic frame bytes;
- node reduction ratio;
- exact binding rate;
- structural rebind precision;
- ambiguity rate;
- target resolution success;
- semantic compile latency;
- tokens per successful browser task.

## Non-goals for R4

- no navigation authority;
- no click/type/submit authority;
- no LLM-selected arbitrary CSS/XPath execution;
- no raw JavaScript/eval;
- no semantic action cache yet (R5 consumes R4 output).
