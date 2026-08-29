# A2 Browser R6 — WebMCP Adapter Deep Research

Date: 2026-08-28
Milestone: R6_WEBMCP_ADAPTER_V1
Baseline: R5 Semantic Action Cache / Planning Broker VERIFIED

## Research question

Can A2 use browser-native structured WebMCP tools to reduce perception and model reasoning while preserving the existing fail-closed authority, navigation, identity and prompt-injection fences?

## Current platform state

Primary sources:
- https://developer.chrome.com/docs/ai/webmcp
- https://developer.chrome.com/docs/ai/webmcp/imperative-api
- https://developer.chrome.com/docs/agents/security
- https://chromedevtools.github.io/devtools-protocol/tot/WebMCP/

As of August 2026, WebMCP is a proposed/experimental web standard. Chrome documents it as a progressive enhancement: pages expose named tools with JSON input schemas instead of forcing an agent to infer every interaction from pixels/DOM. Chrome 149 introduced an origin trial; `navigator.modelContext` is deprecated in Chrome 150 in favor of `document.modelContext`.

The most important A2-specific finding is that current tip-of-tree Chrome DevTools Protocol contains a dedicated experimental `WebMCP` domain. It exposes:
- `WebMCP.enable` / `disable`;
- `WebMCP.invokeTool` / `cancelInvocation`;
- `WebMCP.toolsAdded` / `toolsRemoved`;
- `WebMCP.toolInvoked` / `toolResponded`.

Therefore A2 does **not** need `Runtime.evaluate` to discover or eventually invoke WebMCP tools. This preserves the B3 raw-eval prohibition.

## Security signals from the platform

Chrome's agent-security guidance identifies two relevant prompt-injection channels:
1. malicious tool manifests/descriptions/parameters;
2. contaminated tool outputs, including third-party/user-generated data.

The CDP WebMCP domain itself explicitly states that tool output is untrusted and poses a prompt-injection risk. Tool annotations include hints such as read-only, untrusted-content, consequential and autosubmit, but these are hints supplied by the page and are not authority.

A2 consequence: every WebMCP descriptor and result is tainted page data. An annotation such as `readOnly` may inform policy/routing but must never bypass A2 authority or approval gates.

## Performance opportunity

Current B4 perception requires DOMSnapshot + Accessibility capture and semantic compilation. WebMCP lets a cooperative site publish a smaller structured action surface directly. On supported pages, this can reduce:
- perception bytes;
- semantic target ambiguity;
- model tokens spent inferring what UI controls mean;
- number of browser interaction steps needed for a task.

This complements R5 rather than replacing it:

```text
page
 |
 +--> WebMCP available --> structured tool discovery --> planner/cache
 |
 +--> no WebMCP / unsafe / unsupported --> B4 AX+DOM perception --> planner/cache
```

## R6A chosen boundary: discovery only

The first implementation deliberately exposes only `webmcp.snapshot`.

Why not invoke immediately:
- `WebMCP.invokeTool` can cause navigation, mutation or consequential external effects;
- tool annotations are untrusted hints;
- execution needs a separate typed authority policy, idempotency/no-blind-retry receipts and invocation lifecycle fencing;
- discovery can provide most of the planning-efficiency benefit without creating a new actuation path.

## R6A capture protocol

For one logical target:
1. bind to the existing flattened CDP session through `CdpSessionScheduler`;
2. subscribe only to the exact session's `WebMCP.toolsAdded`/`toolsRemoved` events;
3. read main-frame loader identity;
4. call typed `WebMCP.enable`;
5. collect the initial registered-tool event in a short bounded settle window;
6. read main-frame loader identity again;
7. disable WebMCP;
8. discard the capture if the document loader changed;
9. normalize into a backend-neutral envelope.

No `Runtime.evaluate`, raw CDP API, arbitrary script, external navigation or tool invocation is required.

## Backend-neutral tool envelope

Publish only bounded fields required by an external planner:
- opaque `tool_ref`;
- tool name;
- bounded description;
- bounded JSON input schema;
- conservative annotations;
- origin/surface/target/context/conversation/document identity;
- `tainted_page_data=true`;
- `authority_effect=false`;
- `actuation_eligible=false`.

Do not publish:
- `frameId`;
- `backendNodeId`;
- registration stack traces;
- CDP session IDs;
- loader IDs;
- JS object/window handles.

Opaque refs are hints/lookup handles, never execution authority.

## Bounds / denial-of-service policy

Web pages control tool metadata, therefore descriptor size is attacker-controlled.

R6A should enforce daemon-owned bounds on:
- number of tools;
- tool name/description length;
- JSON-schema depth;
- JSON-schema node count;
- total serialized bytes.

Malformed/over-limit schemas fail the structured WebMCP capture closed and fall back to B4 perception rather than truncating schema semantics silently.

## Unsupported-browser behavior

WebMCP is experimental. If the CDP method is genuinely unavailable (`method not found`), return a typed `UNSUPPORTED` capability result with zero tools. Do not degrade the entire Compute Browser runtime.

Other protocol/session/identity failures remain hard failures.

## R6B/R6C follow-ups after discovery is verified

R6B: planner routing
- prefer eligible WebMCP structured tools over semantic UI planning when a unique suitable tool exists;
- integrate with R5 cache namespace/document epoch;
- benchmark token/latency savings versus B4 perception.

R6C: typed invocation authority
- separate `webmcp.invoke` method;
- classify read-only/mutating/consequential actions independently of page hints;
- explicit invocation receipt and no-blind-retry fence;
- cancellation and `toolResponded` reconciliation;
- treat all returned content as tainted;
- preserve user/authority gates for consequential effects.

## Rejected designs

### `Runtime.evaluate('document.modelContext.getTools()')`
Rejected. It reopens arbitrary page-JS evaluation and is unnecessary because Chrome exposes a dedicated WebMCP CDP domain.

### Trust page `readOnly` / `consequential` annotations as policy
Rejected. Page-supplied tool metadata is untrusted input.

### Replace AX/DOM perception with WebMCP
Rejected. WebMCP is experimental, opt-in and unavailable on many pages. It must be a progressive fast path with B4 fallback.

### Expose raw `frameId` or `backendNodeId`
Rejected. They are engine/session identities and violate the existing redaction boundary.

### Invoke tools in R6A
Rejected. Discovery can be verified independently before adding a new effect path.

## Success criteria for R6A

- Chrome's typed `WebMCP` domain is used; `Runtime.evaluate` remains absent.
- real Chrome capability probe passes on current CI Chrome even with zero registered tools.
- unit fixture proves registered tools normalize without raw engine IDs.
- loader race invalidates the capture.
- oversized/malformed schemas fail closed.
- unsupported WebMCP returns `UNSUPPORTED`, not runtime failure.
- no WebMCP invocation or web effect occurs.
