# edge/ — Cloudflare Workers source-of-truth (R83 import)

## Why this exists

R83 live qualification (2026-09-26) proved that **2/2 registry workers had NO
source in the canonical repo** — the production edge was code living only
inside Cloudflare. This directory establishes the repo side of the
source → build → deploy → verify loop for both workers:

| worker | role | source character | live digest (normalized) |
| --- | --- | --- | --- |
| `fabric-worker-h205f21r4` | dispatch gateway (queue + workflow + AI; Supabase worker-gateway RPC PULL/HEARTBEAT/FAIL/PUBLISH) | original ESM modules, 7/7 readable | `9c55419e37b04d41` |
| `metaengine-h205f22-aop1` | operator authority (DO `ComputeFabricSupervisor` + workflow + queue; Supabase `h205f22_aop1_*` allowlist; GitHub writes) | esbuild bundle (per-module source lost pre-import) | `29b36254b0b4cb4f` |

## Layout

- `fabric-worker-h205f21r4/src/*` — **verbatim** live module bytes (module
  names preserved: `src/index.js` is the entry).
- `metaengine-h205f22-aop1/bundle/index.js` — **verbatim** live bundle bytes;
  `wrangler.jsonc` `main` points here so a repo-built deploy equals live bytes.
- `metaengine-h205f22-aop1/recovered/*` — esbuild `// src/*` section slices
  (review artifacts, not standalone modules; the bundle keeps them in order).
- `*/wrangler.jsonc` — stubs built from **live settings** (bindings, compat
  dates, observability). Secret bindings are listed as `secrets_hint` only.
- `PROVENANCE.json` — machine-readable digest binding (per-module sha256_12,
  snapshot provenance, policies).
- `tools/verify-digests.mjs` — promotion-gate verifier:
  `cd edge && node tools/verify-digests.mjs` must print `== LIVE ✓` for both.

## Policies

1. **Import only.** This PR deploys nothing. Promotion (deploy from repo)
   requires: operator review, digest re-verification, CF token rotation.
2. **No secrets in repo.** Live `secret_text` bindings are enumerated but
   never inlined; re-provision with `wrangler secret put <NAME>`.
3. **Digest contract.** Any edit to files under this tree breaks
   `tools/verify-digests.mjs` by design — the fix is to deploy the change and
   update PROVENANCE.json with the new live digest in the same review.
4. `enginetest` (v2, 275b probe leftover) is intentionally NOT imported —
   it is an unclassified remnant; disposition under operator review.
