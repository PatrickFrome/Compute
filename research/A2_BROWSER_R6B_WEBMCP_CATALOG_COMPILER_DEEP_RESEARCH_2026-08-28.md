# A2 Browser Operator R6B — WebMCP Catalog Compiler Deep Research

Date: 2026-08-28
Branch: `work/a2-browser-r6b-webmcp-catalog`
Baseline: R6A authoritative commit `9ebd5dbfcb76c08b339ad0d1eb64e1610462decc`

## Research question

How should A2 expose WebMCP tools to a planner without paying the context/token cost of embedding every full JSON Schema, while preserving the existing fail-closed causal and authority boundaries?

## Current evidence

R6A proved a typed read-only discovery path over Chromium's experimental CDP `WebMCP` domain without `Runtime.evaluate`, remote navigation, or `WebMCP.invokeTool`. Real Chrome returned `SUPPORTED` in CI. Tool metadata is tainted and annotations remain hints only.

The remaining inefficiency is context size: the R6A snapshot intentionally preserves full sanitized `input_schema` for correctness, but a page can expose many tools and schemas can be large. Passing the entire envelope to an external planner on every miss would erase part of the token/latency gain achieved by R5 caching and singleflight.

## External comparison

### Chromium WebMCP

Chrome's WebMCP guidance treats descriptions and schemas as model-facing interface material, warns that every additional tool occupies context and makes correct selection harder, and recommends keeping tools semantically distinct and dynamically registered only when useful. The API is dynamic: tools can be registered/removed and discovery state can change while the page is live. WebMCP metadata and tool output are untrusted page-originated data.

Implication for A2: preserve the complete sanitized discovery envelope as the truth source, but compile a deliberately lossy planner catalog. Never convert page annotations into authorization policy.

Sources:
- https://developer.chrome.com/docs/ai/webmcp
- https://developer.chrome.com/docs/ai/webmcp/best-practices
- https://developer.chrome.com/docs/agents/security
- https://chromedevtools.github.io/devtools-protocol/tot/WebMCP/

### MCP 2026-07-28

The 2026-07-28 MCP specification makes list results deterministic and cacheable and adds explicit cache hints. This reinforces treating a tool list/catalog as its own cacheable/discoverable representation rather than injecting full schemas into every model turn.

Source:
- https://blog.modelcontextprotocol.io/posts/2026-07-28/

### Stagehand v4

Stagehand v4 reports large token reductions from better context management and skips inference entirely on validated cache hits. Its WebMCP support uses first-party structured tools instead of inferring equivalent DOM actions where available.

Implication for A2: R5 should continue to eliminate repeat reasoning, while R6B should minimize the context cost of unavoidable misses. The two optimizations are orthogonal: R5 removes many model calls; R6B shrinks the context of the calls that remain.

Sources:
- https://www.browserbase.com/blog/stagehand-v4
- https://www.browserbase.com/changelog/caching-configurable
- https://www.browserbase.com/blog/stagehand-caching

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

Initial v1 limits after budget modelling:
- tool name preview: 64 characters
- description preview: 128 characters
- all tools retained up to the R6A 128-tool maximum
- schema represented only by root type/count hints plus a deterministic schema fingerprint
- final serialized catalog size: maximum 96 KiB; overflow fails closed rather than silently dropping tools
- `catalog_bytes` is a fixed-point measurement of the final JSON representation, including the size field itself

The first implementation used a 240-character description preview. Worst-case size modelling showed that 128 valid tools could exceed the 96 KiB catalog budget before full schemas were even present. Because exact hydration immediately follows shortlisting, the catalog preview was tightened to 128 characters rather than weakening the total context bound. This is an intentional information-budget trade-off, not silent truncation: every entry exposes a truncation flag and the exact description/schema remains available through fresh `describe`.

## Post-implementation benchmark

Dedicated R6B CI run `33180051054` executed a deterministic synthetic benchmark using schema-heavy tools and no provider model. Exact serialized JSON results:

| Tools | Full R6A envelope | R6B catalog | Byte reduction |
|---:|---:|---:|---:|
| 8 | 59,098 B | 6,140 B | 89.61% |
| 32 | 236,055 B | 23,068 B | 90.23% |
| 128 | 945,246 B | 90,807 B | 90.39% |

The 128-tool case remains below the 96 KiB hard catalog limit with every tool retained. These are serialized byte measurements, not token estimates; model/token savings will depend on tokenizer and planner prompt composition.

The same run passed 10 shared R6A/R6B tests, 50 Compute Browser tests, 35 R5 regression tests, extension safety labs, an R6A real-Chrome regression, and an R6B real-Chrome catalog smoke. Real Chrome reported WebMCP `SUPPORTED`; the empty `about:blank` catalog serialized to 538 bytes. No runtime evaluation, WebMCP invocation, remote navigation, raw engine identity, or actuation was used.

## Comparison after implementation

### Versus Stagehand caching

Stagehand's validated cache hits skip inference entirely, which is the strongest optimization for repeated tasks. A2 R5 already targets that same class of repeated-work elimination with causal namespace fencing and fresh revalidation. R6B is not a replacement for caching: it targets cold or cache-miss planning and reduces the amount of structured tool context by roughly 90% in the benchmark.

### Versus exposing all WebMCP tools directly

Direct full-schema exposure is semantically complete but scales linearly with schema verbosity and competes for model context. Chrome explicitly notes that more tools consume context and can make selection harder. R6B retains semantic discovery completeness in daemon memory while presenting only a compact shortlist surface to the planner.

### Versus embeddings/vector retrieval

The measured 128-tool catalog is 90,807 bytes and deterministic without any provider model. This is small enough to justify postponing embeddings: vector retrieval would add model/provider dependence, embedding cache identity, persistence/privacy questions, and another failure surface before there is measured need.

## Why not invoke WebMCP yet

Discovery and invocation have different authority semantics. `WebMCP.invokeTool` may cause consequential web effects. R6B remains read-only so that context optimization can be verified independently before a later milestone designs confirmation, actionability, idempotency, and receipt contracts for tool execution.

## Next architecture candidate: R6C planner routing

The next highest-leverage step is not invocation. It is a deterministic/provider-neutral router that decides which perception surface should feed the external planner:

1. R5 semantic-action cache hit -> skip planner.
2. R5 cold leader -> query R6B WebMCP catalog.
3. If WebMCP is supported and a structured-tool route is applicable -> provide compact catalog, shortlist, then fresh `describe` for only the selected tool.
4. Otherwise -> fall back to B4 semantic perception envelope.
5. Keep all outputs non-authoritative until a later execution milestone defines the exact action/tool authority fence.

R6C must benchmark routing accuracy, ambiguity, planner-context bytes, and provider calls without adding `WebMCP.invokeTool`.

## Verification status

R6B implementation is code-complete for catalog/describe and has a successful dedicated CI/provenance run at commit `1046ad45fc6ba0168986c90e7f64d9d1bd1ac3b8`. Because this document records post-run research, the branch must receive one final exact-head verification run before ledger promotion.
