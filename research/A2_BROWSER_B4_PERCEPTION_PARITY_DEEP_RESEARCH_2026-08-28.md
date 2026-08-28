# A2 Browser B4 Perception Parity — Deep Research Checkpoint

Date: 2026-08-28
Status: implementation-driving research
Scope: Chrome Extension R4 + A2 Compute Browser B3/R4 -> one cache-facing perception contract

## Research question

How should A2 expose one semantic perception contract across an MV3 extension and a standalone managed Chromium runtime without weakening target identity, navigation invalidation, prompt-injection taint, or physical-effect safety?

## Sources reviewed

- Chrome DevTools Protocol, Page domain / Frame / loaderId / getFrameTree:
  https://chromedevtools.github.io/devtools-protocol/tot/Page/
- Chrome DevTools Protocol, DOMSnapshot domain:
  https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/
- WebDriver BiDi specification, browsing contexts / user contexts:
  https://w3c.github.io/webdriver-bidi/
- Microsoft Playwright MCP:
  https://github.com/microsoft/playwright-mcp
- Playwright accessibility/ARIA snapshot behavior and current visibility limitations:
  https://playwright.dev/docs/aria-snapshots
  https://github.com/microsoft/playwright/issues
- Chrome WebMCP:
  https://developer.chrome.com/docs/ai/webmcp

## Findings

### 1. The shared contract must sit above browser-engine identity

CDP uses frame IDs, loader IDs, target IDs, backend DOM node IDs, AX node IDs and flattened session IDs. WebDriver BiDi uses a different vocabulary around browsing contexts and user contexts. These are adapter bindings, not durable A2 identity.

Therefore the common cache-facing identity is:

```text
target_id
context_id
conversation_epoch
document_epoch
```

Raw CDP/BiDi IDs remain adapter-local.

### 2. Main-frame loaderId is a useful cross-document invalidation primitive

CDP documents `Frame.loaderId` as the loader associated with the frame. `Page.navigate` omits a new loaderId for same-document navigation because the committed loader does not change; `Page.reload(loaderId=...)` can use loaderId as a race guard.

A2 therefore uses a read-only loader sandwich on Compute Browser:

```text
Page.getFrameTree
DOMSnapshot.captureSnapshot
Accessibility.getFullAXTree
Page.getFrameTree
```

If the main loader changes during capture, the snapshot is discarded. The raw loaderId is never returned. A keyed digest of `(target_id, conversation_epoch, loaderId)` becomes the public `document_epoch`.

This preserves same-document continuity while invalidating cross-document cache state.

### 3. Accessibility snapshot presence is not equivalent to on-screen visibility

Accessibility trees are excellent semantic evidence but can contain nodes outside the visual viewport or otherwise unsuitable for direct physical targeting. Geometry also has producer/version-specific incompleteness.

The B4 common contract therefore does not expose a strong negative visibility assertion in V1. It uses:

```text
VISIBLE  = positive evidence only
UNKNOWN  = negative, missing or incomplete evidence
```

This is intentionally asymmetric and fail-closed for future action-cache reuse.

### 4. Extension semantic frame and Compute semantic snapshot are different layers, not competing formats

Extension R4 already compiles raw AX/DOM observations into a bounded `semantic-frame.v1` with semantic identity, continuity, relevance and delta semantics.

Compute Browser R4 produces a lower-level `semantic-snapshot.v1` with HMAC-opaque node refs and strict causal binding to process/session state.

B4 retains both native evidence formats and adds a third cache-facing layer:

```text
surface evidence -> perception-envelope.v1 -> R5 semantic action cache
```

This avoids forcing extension-specific DOM heuristics into Compute Browser and avoids leaking CDP causality into extension semantics.

### 5. Cache namespace must include every logical isolation dimension

No fallback values are permitted for `context_id`, `conversation_epoch` or `document_epoch`. In particular, extension rollover must never silently fall back to epoch `1`.

Missing identity dimension => no envelope => no cache reuse.

### 6. Structural cache hints must be engine-neutral and non-authoritative

B4 emits two hints:

- `semantic_fingerprint`: normalized role/name/value/actionability evidence
- `geometry_bucket`: coarse geometry evidence

`locator_fingerprint` combines both for candidate lookup. None is an authority token. R5 must still re-resolve and live-revalidate a target before any physical action.

### 7. Taint survives compilation

The common envelope always sets:

```text
tainted_page_data = true
authority_effect = false
actuation_eligible = false
```

Semantic compaction does not launder webpage text into trusted instructions.

### 8. WebMCP is a future higher-level adapter, not a replacement for the contract

WebMCP demonstrates the direction toward first-party typed website capabilities. B4 therefore remains backend-neutral so a future WebMCP evidence/tool adapter can provide the same `target/context/document` namespace and semantic cache hints without changing R5.

## Implemented B4 decisions

- true two-parent integration of extension R4 and Compute Browser B3/R4 histories
- `coordination/browser-shared/perception-envelope-v1.mjs`
- mandatory target/context/conversation/document identity
- positive-only visibility semantics
- bounded node output
- backend-neutral semantic and geometry fingerprints
- raw engine identity leak fence
- `coordination/browser-compute/src/perception-envelope.mjs`
- loader-sandwich navigation race detection
- HMAC document epoch
- no new navigation/click/type/eval capability
- synthetic parity tests plus real Chromium read-only `about:blank` smoke

## R5 implications

Semantic Action Cache may use B4 fingerprints only for candidate lookup. A cache hit must still require:

1. exact target/context/conversation namespace
2. compatible document epoch / explicitly approved cross-document fingerprint policy
3. live perception revalidation
4. capability and taint guard
5. expected precondition validation
6. no raw coordinate or backend-node authority
7. no blind retry after ambiguous physical effect

The next research checkpoint should compare Stagehand action caching, Playwright locator stability, Browser Use reuse patterns and durable idempotency semantics before R5 execution is enabled.
