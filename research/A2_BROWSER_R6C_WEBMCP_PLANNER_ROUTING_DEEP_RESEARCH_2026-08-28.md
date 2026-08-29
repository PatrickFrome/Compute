# A2 Browser Operator R6C — WebMCP Planner Routing Deep Research

Date: 2026-08-28
Branch: `work/a2-browser-r6c-webmcp-planner-routing`
Baseline source of truth: authoritative R6B `5c2e35a4c53f400ba55f6ba5af7a54b30dbf231a`
Target milestone: `R6C_WEBMCP_PLANNER_ROUTING_V1`
Protocol after implementation: `1.8.0`

## Research question

How should the R5 planning broker use R6A/R6B WebMCP discovery while simultaneously preserving all of the following properties?

1. R5 cache hits and singleflight waiters must continue to consume zero planner context.
2. The daemon must not guess the user's natural-language semantics from an `intentId` and `actionKind` alone.
3. WebMCP names, descriptions, annotations, schemas and page state remain tainted page data and never become authority.
4. Large tool libraries must not re-inflate context by shipping every schema or even every compact tool entry to the planner.
5. Every deferred read must remain bound to the exact leader lease and exact target/context/conversation/document namespace.
6. WebMCP remains discovery/selection only in R6C; invocation and browser actuation authority are still absent.
7. Output ordering and schema fingerprints must be reproducible across runtimes and must not depend on locale/ICU collation.

## Starting constraints inherited from R5/R6A/R6B

R5 deliberately captures a fresh B4 semantic perception envelope before semantic cache lookup. That fresh envelope supplies causal identity and revalidation evidence. R6C therefore does **not** remove this internal capture merely to save CDP work: doing so would weaken an already proven cache and singleflight fence.

R6A provides typed WebMCP discovery with document-loader fencing, tainted metadata and no invocation. R6B compiles discovery into a deterministic bounded catalog and hydrates a full schema only through a fresh `webmcp.describe` operation.

R6B is already much smaller than the full schema-heavy discovery representation. Its 128-tool benchmark is:

- full WebMCP envelope: 945,246 bytes
- R6B catalog: 90,807 bytes
- reduction: 90.39%

That is a strong discovery compiler, but a 90-KiB catalog is still too expensive to place into every cold planner turn.

## External comparison

### Anthropic Tool Search / advanced tool use

Anthropic's Tool Search architecture follows the same important principle: keep tool definitions out of context until the model actually needs them, then return only a few relevant tools. Their published examples report approximately 85% reduction in tool-token overhead and improved tool-selection accuracy for large libraries. Their guidance also notes that the strongest return appears when tool libraries are large (roughly 10+ tools or high aggregate schema token cost), while small libraries can be cheaper to expose directly.

Implication for A2: deferred search is a strong large-library path, but applying it unconditionally would add an extra planner/search round trip where a tiny compact index is already cheaper.

Source:
- https://www.anthropic.com/engineering/advanced-tool-use

### Chrome WebMCP

Chrome describes WebMCP as a progressive enhancement over manual interaction. Available tools are dynamic and page-scoped. Chrome's best-practices and security guidance emphasize that every additional tool consumes model context and can make selection harder, and that malicious page-owned tool names/descriptions/parameters can carry prompt-injection content.

Implication for A2:
- minimize the untrusted metadata exposed to the planner;
- bound every string and result set deterministically;
- never interpret annotations as authorization or safety policy;
- preserve semantic fallback instead of allowing malformed page metadata to deny service;
- keep invocation outside R6C.

Sources:
- https://developer.chrome.com/docs/ai/webmcp
- https://developer.chrome.com/docs/ai/webmcp/best-practices
- https://developer.chrome.com/docs/ai/webmcp/secure-tools
- https://developer.chrome.com/docs/ai/webmcp/agent-security

### Model Context Protocol

MCP tool specifications state that tool annotations should be treated as untrusted unless the server itself is trusted. The 2026 MCP evolution also strengthens deterministic/cacheable list behavior, which makes stable ordering and compact discovery representations more valuable.

Implication for A2: annotations stay out of the planner routing/search surface, and catalog/index/search ordering must be runtime-independent.

Sources:
- https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- https://blog.modelcontextprotocol.io/posts/2026-07-28/

### Playwright MCP / CLI / skills

Playwright distinguishes always-exposed MCP tool schemas from lower-context, on-demand CLI/skill discovery. A smaller exposed tool surface reduces token usage and also reduces opportunities for incorrect tool selection.

Implication for A2: progressive disclosure should stop at the smallest useful surface instead of making the full compact catalog the planner API.

Sources:
- https://playwright.dev/mcp/introduction
- https://playwright.dev/agents

### Reproducible-build guidance

Locale-aware collation can vary with `Intl.Collator`/ICU implementation and environment. Reproducible-build guidance therefore avoids locale-dependent ordering for identity-producing artifacts.

Implication for A2: no WebMCP envelope, schema canonicalization, catalog, routing index or search ranking may depend on `localeCompare()`.

Sources:
- https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String/localeCompare
- https://reproducible-builds.org/docs/locales/

## Architecture evolution during R6C

### Iteration 1 — complete compact routing index

The first R6C implementation compiled R6B into an even smaller selection-only index. At 128 tools it measured approximately 44.5 KiB and removed schemas and annotations. This was substantially better than the R6B catalog, but it still made planner context scale linearly with the entire tool library.

### Iteration 2 — deferred deterministic Tool Search

Post-implementation research showed that large tool libraries should be searched on demand rather than shipped wholesale. R6C therefore added:

- tiny `WEBMCP_TOOL_SEARCH` handle;
- lease-bound RPC `planning.tools.search`;
- bounded query: at most 512 characters / 24 normalized terms;
- fresh WebMCP discovery for every search;
- deterministic lexical scoring only — no provider model, embeddings or hidden LLM call;
- maximum five returned candidate hints;
- final search-result budget of 12 KiB;
- `NO_MATCH` instead of guessing an unrelated tool;
- exact schema still requires fresh `webmcp.describe`;
- semantic B4 fallback remains available.

### Iteration 3 — adaptive disclosure

The benchmark showed that deferred search has excellent scaling but an avoidable extra round trip for tiny toolsets. Therefore R6C now adapts by cardinality:

- **1–8 WebMCP tools:** expose the compact routing index directly.
- **9+ WebMCP tools:** expose only the tiny search handle, then use `planning.tools.search` for top-K disclosure.
- **0/unsupported/malformed:** use semantic B4 fallback.

The threshold is deliberately conservative relative to public Tool Search guidance and is directly supported by the measured 8/32/128 crossover.

## Final adaptive R6C flow

```text
fresh B4 semantic capture
        |
        v
R5 semantic cache / singleflight
        |
        +-- HIT_REVALIDATED ------> planner context = 0 bytes
        |
        +-- WAIT_FOR_PROMOTION ---> planner context = 0 bytes
        |
        `-- MISS_LEADER
                |
                v
         fresh WebMCP catalog
                |
     +----------+------------------+
     |                             |
unsupported / zero / invalid    tools available
     |                             |
     v                         tool_count?
fresh B4 semantic              /          \
context                       1..8         >=9
                               |             |
                               v             v
                         compact index   tiny search handle
                         (no schemas,     (<2 KiB, no tool list)
                          no annotations)       |
                               |                v
                               |       planning.tools.search(query)
                               |                |
                               |       query + lease preflight
                               |                |
                               |       fresh WebMCP catalog
                               |                |
                               |       lease postflight + namespace
                               |                |
                               |       deterministic lexical top<=5
                               |       (<12 KiB, no schemas/annotations)
                               |                |
                               +-------+--------+
                                       |
                          selected tool / no match
                               |                |
                       fresh describe      lease-bound fresh
                       exact schema        semantic fallback
```

## Lease and TOCTOU hardening

### Cheap preflight before browser work

A wrong or expired `flightId + leaseToken` is rejected before an expensive WebMCP or semantic capture. This reduces the compute-DoS surface.

The same principle applies to malformed search queries: the query is normalized and bounded before fresh WebMCP work begins.

### Postflight lease fence

A lease can expire, be revoked, or be swept while fresh browser work is in progress. Checking it only before capture would create a TOCTOU hole. `planning.tools.search` therefore validates the exact lease again after the fresh catalog is captured and before returning any search result.

Adversarial tests explicitly advance the broker clock during fresh catalog work and require the postflight fence to reject the expired lease.

### Causal namespace fence

Every deferred result must remain within the exact:

`target_id + context_id + conversation_epoch + document_epoch`

A document mismatch during initial routing or deferred search aborts the stale unseen planning flight. The next caller must elect a new leader instead of waiting on an orphaned flight.

## Prompt-injection / taint policy

WebMCP metadata is page-owned and tainted. R6C therefore does not attempt to "sanitize prompt injection" into trust. Instead it reduces exposure and prevents metadata from becoming authority:

- large libraries expose at most five candidate hints;
- description hint is at most 64 characters in the routing/search index;
- annotations are excluded from routing/search payloads;
- full JSON Schema is excluded until fresh exact describe;
- `tainted_page_data=true` is retained;
- `authority_effect=false` and `actuation_eligible=false` remain explicit;
- `NO_MATCH` never guesses a tool;
- invocation is absent;
- semantic fallback is always available to the lease owner.

This is intentionally stronger than treating annotations or descriptions as safety signals.

## Locale-independent determinism

Post-green reproducibility research found an inherited defect: R6A schema-key normalization/tool ordering and R6B/R6C metadata ordering used `localeCompare('en')`. That can depend on ICU/locale implementation and is inappropriate for identity-producing or provenance-bound structures.

The final R6C branch replaces locale-dependent collation with simple code-unit comparison throughout:

1. R6A JSON-schema object-key canonicalization.
2. R6A normalized tool ordering.
3. R6B catalog ordering.
4. R6C routing-index ordering.
5. R6C lexical-search tie-breaking.

Unicode adversarial tests use `Zeta`, `alpha`, `Ångstrom`, and `äther` in different discovery orders and require identical normalized envelope, catalog and routing index ordering. This makes schema fingerprints and metadata bundles independent of discovery order and locale collation.

## Final benchmark

Exact measured values from workflow run `33189726576`, source commit `2a41ab07b817062e3d4b85e23f49274ef44149c9`:

| Tools | Full envelope | R6B catalog | Internal index | Search handle | Top-K result | Deferred total | Reduction vs index | Reduction vs full |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 8 | 64,750 B | 6,160 B | 3,005 B | 693 B | 1,369 B | 2,062 B | 31.38% | 96.82% |
| 32 | 258,476 B | 23,045 B | 10,095 B | 694 B | 2,345 B | 3,039 B | 69.90% | 98.82% |
| 128 | 1,034,823 B | 90,636 B | 38,502 B | 695 B | 2,351 B | 3,046 B | 92.09% | 99.71% |

For 8 tools, the final runtime intentionally uses the 3,005-B compact index instead of paying an extra search round trip. For 32/128 tools, deferred search gives the materially better context profile.

The first large-toolset turn is especially small: the 128-tool handle is only 695 B, a 98.19% reduction versus the internal index before a search is requested.

## Verification evidence before documentation seal

Exact head: `2a41ab07b817062e3d4b85e23f49274ef44149c9`
Workflow run: `33189726576`
Conclusion: `success`

Passed:

- shared R6A/R6B/R6C unit + adversarial tests: **33/33**
- Compute Browser tests: **61/61**
- R5 regressions: **37/37**
- extension semantic/OOPIF/perception/authority/disarm labs: PASS
- real Chrome R6A: PASS
- real Chrome R6B: PASS
- real Chrome R6C planning/fallback/singleflight: PASS
- deterministic evidence tar: PASS
- Sigstore build-provenance attestation: PASS

Evidence identifiers:

- artifact ID: `9693217005`
- artifact ZIP digest: `sha256:d56f6c1be8849680f5148c2a04b969a27b134af4a842c23ab9ea602af8a35268`
- attested tar digest: `sha256:41e73fe9a6d1690d81089a1df0e6085c4e4a67d388dc4cfa9174e2c432eb5bc1`
- Sigstore attestation ID: `43703738`
- Rekor log index: `2627039509`

Because this research document changes the source head and is itself part of the evidence tar, ledger promotion requires one more exact-head workflow run after this documentation seal.

## Real-Chrome evidence boundary

The current GitHub-hosted Chrome supports the WebMCP CDP domain, but the R6A/R6B/R6C real-Chrome fixture page registers **0 WebMCP tools**. Therefore live Chrome currently proves:

- typed WebMCP-domain support and clean zero-tool result;
- semantic progressive fallback;
- one cold leader + seven waiters;
- zero context for waiters;
- lease-bound fresh semantic context;
- fresh promotion and zero-context cache hit;
- absence of `Runtime.evaluate`, WebMCP invocation, raw engine identity, remote navigation and actuation.

The **non-empty** 1–8 compact-index and 9+ deferred-search paths are proven by typed service/adversarial tests using sanitized WebMCP catalog fixtures, not by a live page registration fixture. This limitation is recorded explicitly and must not be represented as live non-empty WebMCP evidence.

## Final invariants

- R5 fresh semantic capture/cache/singleflight remains first.
- Cache hit still skips model work entirely.
- Waiters still receive zero planner context.
- Small toolsets receive only the compact lossy index.
- Large toolsets receive a tiny handle and at most five search hints.
- Full schemas are never embedded in routing/search surfaces.
- Annotations never become routing authority.
- Search query is never persisted.
- Search query + lease are preflighted before browser work.
- Lease is checked again after browser work.
- Semantic fallback is fresh and exact-lease bound.
- Cross-document drift fails closed and aborts stale flights.
- WebMCP invocation remains absent.
- `Runtime.evaluate` remains absent.
- Provider credentials and execution payloads are not stored.
- All identity-producing metadata ordering is locale-independent.
- Promotion still requires fresh semantic/actionability revalidation.

## Roadmap implication

R6C completes the planner-routing portion of `R6_WEBMCP_ADAPTER_V1`. The authoritative roadmap's next major milestone after this line is `R7_SKILL_RUNTIME_V1`. R6C deliberately does not pre-implement R7 execution/skill authority.
