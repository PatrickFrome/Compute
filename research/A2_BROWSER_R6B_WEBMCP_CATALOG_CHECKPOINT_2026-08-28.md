# R6B WebMCP Catalog Compiler — implementation checkpoint

Date: 2026-08-28

This checkpoint records the pre-RPC R6B core implementation.

Implemented:
- provider-neutral compact WebMCP catalog compiler;
- bounded name/description previews;
- full-schema exclusion from catalog;
- schema shape plus deterministic fingerprint;
- exact fresh hydration by document-bound opaque `tool_ref`;
- unsupported typed catalog behavior;
- synthetic 8/32/128-tool serialized-size benchmark;
- no invocation authority or WebMCP invocation path.

Next step:
- isolate into the R6B branch;
- run shared tests/benchmark;
- integrate read-only `webmcp.catalog` and `webmcp.describe` RPC;
- add dedicated R6B CI/provenance before ledger promotion.
