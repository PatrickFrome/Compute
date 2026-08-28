# A2 Browser Operator R6C — WebMCP Planner Routing Checkpoint

Date: 2026-08-28
Architecture: `A2_BROWSER_OPERATOR_R6C_WEBMCP_PLANNER_ROUTING_V1_2026-08-28`
Baseline source of truth: authoritative R6B `5c2e35a4c53f400ba55f6ba5af7a54b30dbf231a`
Branch: `work/a2-browser-r6c-webmcp-planner-routing`
Protocol: `1.8.0`
Status: `IMPLEMENTED_GREEN_PENDING_FINAL_DOCUMENTATION_BOUND_EVIDENCE`
Next major roadmap milestone after R6: `R7_SKILL_RUNTIME_V1`

## Final implementation

R6C is now **adaptive progressive disclosure** on top of the existing R5 semantic cache/singleflight and R6A/R6B WebMCP discovery/compiler stack.

```text
fresh B4 semantic capture
  -> R5 lookup
     -> HIT: 0 planner bytes
     -> WAIT: 0 planner bytes
     -> MISS_LEADER
        -> fresh WebMCP catalog
           -> unsupported/0/invalid: fresh semantic fallback
           -> 1..8 tools: compact routing index
           -> >=9 tools: tiny search handle
                -> planning.tools.search(query)
                -> query + lease preflight
                -> fresh WebMCP catalog
                -> lease postflight + namespace fence
                -> deterministic lexical top<=5
                -> fresh describe exact schema OR semantic fallback
```

Implemented properties:

- `planning.tools.search` is typed `LOCAL_COORDINATION`, not web authority.
- Direct compact routing index is used only for toolsets of 1–8 tools.
- Deferred Tool Search is used for 9+ tools.
- Search handle target: <2 KiB.
- Query maximum: 512 characters / bounded normalized terms.
- Search result maximum: 5 candidates and <12 KiB.
- Search query is not persisted.
- Search uses deterministic lexical scoring only; no provider model or embeddings.
- Full tool list is not embedded in deferred-search context.
- Full JSON Schema is absent from routing/search and still requires fresh `webmcp.describe`.
- WebMCP annotations are absent from routing/search and remain non-authoritative hints only in discovery/catalog layers.
- `NO_MATCH` never guesses a tool.
- Semantic fallback remains fresh and exact-lease bound.
- Wrong lease and malformed query are rejected before browser work.
- Lease is rechecked after fresh WebMCP browser work to close expiry/revocation TOCTOU.
- Cross-document/namespace drift aborts stale unseen flights.
- WebMCP invocation remains absent.
- `Runtime.evaluate` remains absent.
- No provider credential or execution payload persistence was added.

## Reproducibility hardening

The final post-research pass removed locale-dependent `localeCompare()` ordering from the complete WebMCP metadata pipeline:

- R6A JSON-schema key canonicalization;
- R6A tool normalization order;
- R6B catalog order;
- R6C routing-index order;
- R6C search tie-breaking.

Unicode adversarial tests prove identical envelope/catalog/index ordering for differently ordered inputs containing `Zeta`, `alpha`, `Ångstrom`, and `äther`.

## Measured context profile

Pre-documentation exact-head benchmark from commit `2a41ab07b817062e3d4b85e23f49274ef44149c9`, workflow `33189726576`:

| Tools | Runtime choice | Planner first surface | Deferred total if searched | Reduction vs full |
|---:|---|---:|---:|---:|
| 8 | compact index | 3,005 B | not used by final runtime | 95.36% direct-index reduction vs full |
| 32 | deferred search | 694 B handle | 3,039 B | 98.82% |
| 128 | deferred search | 695 B handle | 3,046 B | 99.71% |

For 128 tools, deferred total context is 92.09% smaller than the 38,502-B internal routing index. The first-turn handle alone is 98.19% smaller than that index.

The 8-tool benchmark showed only 31.38% total deferred reduction versus the compact index while adding another planner/search round trip, which motivated the adaptive 8/9 threshold.

## Pre-documentation evidence

Exact code head: `2a41ab07b817062e3d4b85e23f49274ef44149c9`
Workflow run: `33189726576`
Conclusion: `success`

- shared R6A/R6B/R6C: **33/33**
- Compute Browser: **61/61**
- R5 regressions: **37/37**
- extension safety labs: PASS
- real Chrome R6A: PASS
- real Chrome R6B: PASS
- real Chrome R6C: PASS
- evidence tar: PASS
- Sigstore provenance: PASS

Evidence identifiers:

- artifact ID: `9693217005`
- artifact ZIP digest: `sha256:d56f6c1be8849680f5148c2a04b969a27b134af4a842c23ab9ea602af8a35268`
- attested tar digest: `sha256:41e73fe9a6d1690d81089a1df0e6085c4e4a67d388dc4cfa9174e2c432eb5bc1`
- attestation ID: `43703738`
- Rekor log index: `2627039509`

## Live-evidence boundary

GitHub-hosted Chrome reports WebMCP CDP support but the current live fixture registers `0` WebMCP tools. Consequently:

- live Chrome proves the WebMCP-domain path, zero-tool fallback, R5 singleflight, lease-bound semantic fallback, promotion/cache reuse and absence of authority/eval/invocation;
- non-empty 1–8 direct-index and 9+ deferred-search behavior is proven by typed unit/service/adversarial tests and benchmarks, not by live non-empty page registration.

Do not upgrade that statement to live non-empty WebMCP evidence without a future real page registration fixture.

## Final evidence gate before ledger promotion

Because both research/checkpoint documents are themselves included in the deterministic evidence tar, this documentation update changes the GitHub source head. Therefore R6C must **not** become Supabase `AUTHORITATIVE` until the new exact documentation-bound head passes the same full gate:

1. shared R6A/R6B/R6C tests;
2. Compute Browser suite;
3. R5 regressions and extension safety labs;
4. adaptive 8-tool / 9+ search adversarial tests;
5. query-preflight and lease-postflight race tests;
6. locale-independent Unicode ordering tests;
7. 8/32/128 benchmarks;
8. real Chrome R6A/R6B/R6C;
9. static absence of `Runtime.evaluate`, WebMCP invocation/cancel and remote debugging TCP;
10. deterministic tar + Sigstore provenance + uploaded artifact bound to the exact final source commit.

Only after that final exact-head green run may the ledger transaction supersede R6B and insert R6C as the sole `AUTHORITATIVE` checkpoint, with `next_milestone = R7_SKILL_RUNTIME_V1`.
