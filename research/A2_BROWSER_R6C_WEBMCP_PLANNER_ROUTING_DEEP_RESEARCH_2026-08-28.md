# A2 Browser Operator R6C — WebMCP Planner Routing Deep Research

Date: 2026-08-28
Branch: `work/a2-browser-r6c-webmcp-planner-routing`
Baseline: authoritative R6B `5c2e35a4c53f400ba55f6ba5af7a54b30dbf231a`

## Research question

How should the R5 planning broker use R6A/R6B WebMCP discovery without making the daemon guess user semantics, without re-inflating planner context, and without weakening the existing document/lease/actuation fences?

## Current architecture constraints

R5 deliberately captures a fresh B4 semantic perception envelope before cache lookup. That envelope supplies target/context/conversation/document identity, cache revalidation evidence, and the singleflight namespace. Therefore R6C should not try to eliminate the internal B4 capture merely to save CDP work; doing so would weaken the already-proven cache and causal fences.

R6B provides a deterministic, bounded WebMCP catalog, but even a compact 128-tool catalog measured 90,807 serialized bytes. Sending that complete catalog to every cold-miss planner is better than sending every JSON Schema, but it is still larger than necessary for first-pass tool-vs-semantic routing.

The daemon receives `intentId` and `actionKind`, not the original natural-language task. It therefore does not have enough semantic information to safely decide which WebMCP tool matches the user's actual goal. Page annotations and descriptions are also tainted page data and must never become authority policy.

## External comparison

### Chrome WebMCP

Chrome documents WebMCP as a progressive enhancement over manual actuation. Tool registration is dynamic and tied to page state; `toolchange` signals that the available set can change. Chrome's best-practices guidance warns that every additional tool consumes context and makes correct selection harder, recommends distinct single-purpose tools, and recommends keeping tools registered only while useful.

Implication for A2: expose a small selection surface first and keep exact tool hydration fresh. Do not make the daemon infer semantic relevance from untrusted tool metadata.

Sources:
- https://developer.chrome.com/docs/ai/webmcp
- https://developer.chrome.com/docs/ai/webmcp/best-practices
- https://developer.chrome.com/docs/ai/webmcp/imperative-api
- https://developer.chrome.com/docs/ai/webmcp/secure-tools

### MCP 2026-07-28

The 2026-07-28 MCP specification makes list results deterministic and cacheable and adds cache hints. This reinforces separating cheap discovery/index data from full per-tool schemas and expensive execution context.

Source:
- https://blog.modelcontextprotocol.io/posts/2026-07-28/

### Playwright MCP / CLI

Playwright explicitly documents MCP as having higher token cost because tool schemas and snapshots occupy context, while its CLI/skills approach is more token-efficient because concise capabilities are loaded on demand.

Implication for A2: a planner should receive a routing index first, then request only the exact richer surface it needs.

Sources:
- https://playwright.dev/mcp/introduction
- https://playwright.dev/agent-cli/introduction

### Stagehand v4

Stagehand v4 can drive pages through WebMCP and uses caching to skip inference entirely on cache hits. Browserbase reports that a cache hit performs no model call and consumes no model tokens. Stagehand's cache also validates that the current page still matches before deterministic reuse.

Implication for A2: R5 remains the first fast path. R6C optimizes only cold leaders, preserving fresh revalidation rather than replacing it.

Sources:
- https://www.browserbase.com/blog/stagehand-v4
- https://www.browserbase.com/changelog/caching-configurable
- https://www.browserbase.com/blog/stagehand-caching

## Chosen R6C architecture

R6C is **context routing**, not semantic routing.

```text
fresh B4 capture
      |
      v
R5 cache / singleflight
      |
      +-- HIT_REVALIDATED ------> no model context
      |
      +-- WAIT_FOR_PROMOTION ---> no model context
      |
      `-- MISS_LEADER
              |
              v
       fresh WebMCP discovery
              |
       +------+------+
       |             |
 unsupported/0    tools present
       |             |
       v             v
 fresh B4      tiny routing index
 semantic       (no full schema,
 context         no annotations)
       |             |
       |        planner chooses
       |        /           \
       |   exact tool      no match
       |      |              |
       | fresh describe      |
       |                     |
       `------------- lease-bound fresh
                     semantic fallback
```

### Routing index

R6C adds a second, smaller representation compiled from the R6B catalog. It is explicitly lossy and selection-only. Each entry contains:
- document-bound opaque `tool_ref`
- bounded name
- short description hint
- schema fingerprint
- root input type + property count
- `preview_lossy=true/false`
- `tainted_page_data=true`

It deliberately excludes:
- full JSON Schema
- annotations
- raw frame/backend/session identity
- execution payloads
- any invocation capability

Initial hard budget: 48 KiB final serialized JSON for the complete 128-tool index. Exact schema remains available only through fresh `webmcp.describe`.

### Lease-bound semantic fallback

A cold leader may request `planning.context` with its exact `flightId + leaseToken`. The daemon captures a fresh B4 envelope and asks the shared planning broker to revalidate that the flight still belongs to the same target/context/conversation/document namespace. Only then is the semantic envelope returned.

Waiters cannot obtain this context because they do not own the lease. A stale or cross-document lease fails closed.

### Post-flight failure cleanup

R6C adds risky work after `MISS_LEADER`: WebMCP capture and routing-index compilation. If that work throws after a leader flight has been created, the service must abort the unseen lease before returning the error. Otherwise subsequent callers would wait on an orphaned flight until TTL expiry.

### Progressive enhancement failure policy

- WebMCP `UNSUPPORTED` or zero tools -> semantic B4 context.
- Malformed/over-budget WebMCP metadata -> semantic B4 context with a typed degraded reason; page data cannot deny the semantic fallback.
- Target/context/document/incarnation change during routing -> abort the flight and fail closed. Returning the previously captured B4 envelope across a causal change is forbidden.

## Invariants

- R5 cache lookup remains first and unchanged.
- Cache hit still skips model work entirely.
- Waiters still receive no planner context.
- R6C never invokes WebMCP.
- `Runtime.evaluate` remains absent.
- Tool descriptions remain tainted data, never authority.
- No execution payload or provider credential is stored.
- Every semantic fallback is fresh and lease-bound.
- Any planner promotion still performs the existing fresh perception/actionability path.

## Verification plan

1. Unit/adversarial tests for the 48 KiB routing-index compiler and exact final byte accounting.
2. Prove 128 tools fit the index and measure reduction versus R6B catalog and full R6A envelope.
3. Prove cache HIT and WAIT return no WebMCP or semantic planner payload.
4. Prove cold leader with supported tools returns only the routing index, never B4 envelope or full schemas.
5. Prove unsupported/empty/malformed WebMCP degrades to semantic B4 without granting authority.
6. Prove document drift during routing aborts the unseen flight rather than leaving waiters stranded.
7. Prove `planning.context` requires the exact live leader lease and a fresh same-document B4 envelope.
8. Preserve all R6A/R6B/R5/B4/scheduler/extension regressions.
9. Add real-Chrome smoke and deterministic provenance gate before ledger promotion.
