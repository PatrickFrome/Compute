# A2 Browser Operator R6B — WebMCP Catalog Compiler Deep Research

Date: 2026-08-28
Branch: `work/a2-browser-r6-webmcp-adapter`
Baseline: R6A authoritative commit `9ebd5dbfcb76c08b339ad0d1eb64e1610462decc`

## Research question

How should A2 expose WebMCP tools to a planner without paying the context/token cost of embedding every full JSON Schema, while preserving the existing fail-closed causal and authority boundaries?

## Current evidence

R6A proved a typed read-only discovery path over Chromium's experimental CDP `WebMCP` domain without `Runtime.evaluate`, remote navigation, or `WebMCP.invokeTool`. Real Chrome returned `SUPPORTED` in CI. Tool metadata is tainted and annotations remain hints only.

The remaining inefficiency is context size: the R6A snapshot intentionally preserves full sanitized `input_schema` for correctness, but a page can expose many tools and schemas can be large. Passing the entire envelope to an external planner on every miss would erase part of the token/latency gain achieved by R5 caching and singleflight.

## External comparison

### Chromium WebMCP

Chrome's WebMCP guidance treats descriptions and schemas as model-facing interface material and recommends keeping tool and parameter descriptions concise. The API is dynamic: tools can be registered/removed and discovery state can change while the page is live. WebMCP metadata and tool output are untrusted page-originated data.

Implication for A2: preserve the complete sanitized discovery envelope as the truth source, but compile a deliberately lossy planner catalog. Never convert page annotations into authorization policy.

Sources:
- https://developer.chrome.com/docs/ai/webmcp
- https://developer.chrome.com/docs/ai/webmcp-security
- https://chromedevtools.github.io/devtools-protocol/tot/WebMCP/

### MCP 2026-07-28

The 2026-07-28 MCP specification makes list results deterministic and cacheable and adds explicit cache hints. This reinforces treating a tool list/catalog as its own cacheable/discoverable representation rather than injecting full schemas into every model turn.

Source:
- https://blog.modelcontextprotocol.io/posts/2026-07-28/

### Stagehand v4

Stagehand v4 reports large token reductions from better context management and skips inference entirely on validated cache hits. Its WebMCP support uses first-party structured tools instead of inferring equivalent DOM actions where available.

Implication for A2: R5 should continue to eliminate repeat reasoning, while R6B should minimize the context cost of unavoidable misses.

Sources:
- https://www.browserbase.com/blog/stagehand-v4
- https://www.browserbase.com/changelog/caching-configurable
- https://www.browserbase.com/changelog

### Playwright

Playwright's robust action model resolves locators against current page state and checks actionability at execution time. A2 should preserve this separation: catalog/selection is not execution authority, and any future tool invocation must have an independent fresh authority gate.

Sources:
- https://playwright.dev/docs/locators
- https://playwright.dev/docs/actionability

## Chosen architecture: progressive disclosure

R6B introduces two representations:

1. **Full R6A WebMCP envelope** — sanitized but semantically complete discovery evidence. It may contain full JSON Schema. It remains read-only and tainted.
2. **Compact R6B catalog** — deterministic, bounded, intentionally lossy planner-facing index. It contains opaque `tool_ref`, bounded name/description previews, frame scope, annotation hints, and a schema shape/fingerprint, but never embeds the full schema.

A planner first receives the catalog. After shortlisting one exact `tool_ref`, it requests a fresh description/hydration. The daemon re-runs WebMCP discovery and only returns the full sanitized schema if that document-bound opaque tool ref still exists.

This gives:

`DISCOVER -> COMPACT CATALOG -> SHORTLIST -> FRESH HYDRATE`

not:

`DISCOVER -> DUMP EVERY SCHEMA INTO MODEL`

## Causal safety requirements

- `tool_ref` stays bound to target/context/conversation/document identity inherited from R6A.
- Hydration performs fresh discovery; a document rotation naturally invalidates the old `tool_ref`.
- Catalog entries have `authority_effect=false` and `actuation_eligible=false`.
- Hydrated tool descriptions also have no execution authority.
- WebMCP annotations remain untrusted hints.
- `WebMCP.invokeTool` remains absent from the RPC surface in R6B.
- No raw `frameId`, `backendNodeId`, stack trace, CDP session id, loader id, or process incarnation is exposed.

## Catalog budget

The catalog compiler must have daemon-owned hard bounds independent of page input. The full envelope already bounds source schemas; R6B additionally bounds planner-facing previews and total serialized catalog size.

Initial v1 limits:
- tool name preview: 64 characters
- description preview: 240 characters
- all tools retained up to the R6A 128-tool maximum
- schema represented only by root type/count hints plus a deterministic schema fingerprint
- catalog serialized size: maximum 96 KiB; overflow fails closed rather than silently dropping tools

The catalog marks whether name/description previews were truncated. Truncation is acceptable here because this artifact is explicitly a lossy index and exact hydration is required before argument construction.

## Why not vector embeddings yet

An embedding/vector retrieval layer could improve very large catalogs, but R6A currently caps discovery at 128 tools. Adding embeddings would introduce model/provider coupling, persistence/privacy questions, and a new cache identity problem before measurements show it is needed.

R6B therefore starts with a deterministic provider-neutral catalog. A later benchmark can justify lexical ranking or embeddings only if catalog size/relevance becomes a measured bottleneck.

## Why not invoke WebMCP yet

Discovery and invocation have different authority semantics. `WebMCP.invokeTool` may cause consequential web effects. R6B remains read-only so that context optimization can be verified independently before a later milestone designs confirmation, actionability, idempotency, and receipt contracts for tool execution.

## Verification plan

1. Unit/adversarial tests for deterministic catalog compilation.
2. Demonstrate full schemas are absent from catalog serialization.
3. Demonstrate fresh hydration returns the exact sanitized schema for a document-bound `tool_ref`.
4. Demonstrate old refs fail after document identity changes.
5. Compare serialized bytes for full envelope vs catalog across 8/32/128-tool synthetic workloads.
6. Extend typed RPC with read-only `webmcp.catalog` and `webmcp.describe` only.
7. Preserve all R6A, R5, B4, scheduler, and extension safety regressions.
8. Add dedicated evidence/provenance gate before ledger promotion.
