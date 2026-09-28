# fabric-worker-h205f21r4 (dispatch gateway)

Imported verbatim from the live Cloudflare worker (v15, compat 2026-08-19).
Module map:

- `src/index.js` — entry: exports `FabricWorkflow` (WorkflowEntrypoint) and
  default `{ fetch, queue }`.
- `src/handlers.js` — fetch/queue routing (dispatch wake + capability proof).
- `src/gateway.js` — Supabase worker-gateway RPC client
  (`pullDispatch`, `heartbeat`, `runtimeFail`, `publishEvent`, `workerStatus`).
- `src/workflow.js` — fabric workflow steps (agent turns via AI binding).
- `src/ai.js` — AI model calls.
- `src/auth.js` — wake-token auth.
- `src/core.mjs` — shared core helpers.

Digest binding: `tools/verify-digests.mjs` (repo root `edge/`) recomputes the
sorted-module normalized digest and compares with live `9c55419e37b04d41`.
