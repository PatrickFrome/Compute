# A2 Browser Operator — R4 Semantic Perception Compiler Deep Research — 2026-08-28

## Goal

Create one adapter-neutral semantic perception format shared by:

- existing Chrome extension capture;
- standalone A2 Compute Browser over native CDP pipe;
- future remote/browser-engine adapters.

The compiler consumes tainted raw browser observations and emits a bounded `SemanticFrame`. It never grants authority by itself.

## External research

### Accessibility-first is the strongest default agent representation

Current Playwright MCP uses structured accessibility snapshots with explicit element refs as its primary agent representation, with screenshots as a complementary visual channel. It also exposes a targeted `browser_find` path so an agent can search a snapshot and avoid returning the whole tree when only a local region is needed.

Sources:
- https://github.com/microsoft/playwright.dev/blob/main/mcp/introduction.mdx
- https://github.com/microsoft/playwright-mcp/blob/main/README.md

### Browser-specific structured tools should outrank pixels

Anthropic's current browser toolset uses page-aware member tools such as `read_page`, `find`, `form_input`, and `get_page_text`, with element references alongside clicks/typing. Chrome WebMCP moves further in the same direction by exposing first-party typed web tools. A2 therefore treats semantic structure as the normal reasoning interface and screenshot/vision as fallback evidence.

Sources:
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-combinations
- https://developer.chrome.com/docs/ai/webmcp

### Snapshot refs must not be treated as eternal identities

Snapshot element refs are useful deterministic bindings for one observed state, but page mutation can invalidate them. A2 needs more continuity for long-lived workers without pretending a DOM/AX node is permanently the same element.

Decision: A2 `semantic_id` may survive frames only after structural revalidation. Each SemanticFrame carries a fresh physical binding/evidence object and explicit continuity status.

### CDP provides a useful join key, not a durable authority key

`Accessibility.getFullAXTree` exposes backend DOM node linkage and `DOMSnapshot.captureSnapshot` exposes backend node IDs, DOM structure and layout. Therefore A2 can merge accessible semantics with DOM/layout using backend DOM node identity without page-script evaluation.

Sources:
- https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/
- https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/

### Full trees need budgeted reduction

Playwright MCP's practical pattern is a compact accessibility-oriented snapshot instead of sending full DOM/screenshots to the model. Large snapshot users have also reported token exhaustion after only a handful of steps, which reinforces explicit pruning, search and delta-first output rather than silent full-tree dumps.

Sources:
- https://github.com/microsoft/playwright.dev/blob/main/mcp/introduction.mdx
- https://github.com/microsoft/playwright-mcp/issues/915

### Page semantics remain untrusted

ARIA labels, DOM text and structured page metadata can carry prompt injection. OpenAI's current guidance treats the problem as source-to-sink risk: untrusted external content must not gain dangerous capability merely because a model summarized or believed it. A2 therefore keeps semantic data tainted and separates perception from authorization.

Sources:
- https://openai.com/index/designing-agents-to-resist-prompt-injection/
- https://openai.com/safety/prompt-injections/

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
  authority_effect=false
  nodes[]
  changes[]
  truncation
  metrics
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
continuity
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
4. normalized accessible-name fingerprint;
5. structural parent/tag signature;
6. current backend DOM binding when available;
7. geometry bucket as weak evidence only.

Continuity outcomes:

- `EXACT_BINDING`: same document epoch + same backend node + compatible semantic signature;
- `STRUCTURAL_REBIND`: physical node changed but semantic structure uniquely matches above policy threshold;
- `NEW_NODE`: insufficient evidence;
- `AMBIGUOUS`: multiple plausible matches; never auto-bind an action.

Navigation/new document invalidates physical bindings and prevents automatic carry-over in R4 v1. Structural rebinding may preserve logical `semantic_id` with incremented `binding_epoch` only inside the same document epoch and only when a unique match passes threshold.

## Relevance compiler

Default output prioritizes interaction/task semantics rather than raw source order.

High score:
- textbox/searchbox/combobox/button/link/checkbox/radio/switch/menuitem/tab;
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

Initial agent budget: 30–80 high-value semantic nodes plus explicit truncation metadata, never silent dropping.

## Delta-first perception

After a full baseline frame, subsequent observations emit:

- added semantic IDs;
- removed semantic IDs;
- state/value/name changes;
- binding changes;
- focus changes.

A full refresh is forced after navigation/document-epoch change, ambiguity, large mutation, stale age, or source-hash mismatch policy.

## Security model

1. All page-derived fields are `tainted_page_data=true`.
2. AX labels and ARIA attributes are untrusted and can contain prompt-injection text.
3. Semantic compiler may rank/describe nodes but cannot authorize an action.
4. Action guard must revalidate physical binding immediately before actuation.
5. Screenshot-only coordinates can suggest a candidate but never become durable authority.
6. Ambiguous rebinding fails closed.
7. Raw HTML/body text is not part of SemanticFrame v1.
8. Cookies, auth headers and storage-state are not perception fields.

## Adapter contract

### Extension adapter

Reuse existing capture primitives in `operator-perception.js` / OOPIF perception. Do not replace them. Compile AX/DOM/layout output into SemanticFrame.

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
- structural rebind count/precision fixture rate;
- ambiguity rate;
- target resolution success;
- semantic compile latency;
- tokens per successful browser task (later integration benchmark).

## Non-goals for R4

- no navigation authority;
- no click/type/submit authority;
- no LLM-selected arbitrary CSS/XPath execution;
- no raw JavaScript/eval;
- no semantic action cache yet (R5 consumes R4 output).
