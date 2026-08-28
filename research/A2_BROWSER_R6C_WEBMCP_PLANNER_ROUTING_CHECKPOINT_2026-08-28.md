# A2 Browser Operator R6C — WebMCP Planner Routing Checkpoint

Date: 2026-08-28
Baseline: authoritative R6B `5c2e35a4c53f400ba55f6ba5af7a54b30dbf231a`
Branch: `work/a2-browser-r6c-webmcp-planner-routing`
Status: IMPLEMENTED_PENDING_EVIDENCE

## Implemented

- Added `webmcp-routing-index-v1.mjs`, a deterministic selection-only index compiled from the R6B catalog.
- Hard routing-index budget: 48 KiB final serialized JSON including its own byte counter.
- Routing entries omit full JSON Schema, annotations, frame/backend/session identity, and invocation capability.
- R5 semantic cache/singleflight remains the first planning gate.
- `HIT_REVALIDATED` and `WAIT_FOR_PROMOTION` return no planner context and zero planner-context bytes.
- `MISS_LEADER` tries fresh WebMCP discovery only after the R5 leader election.
- Supported non-empty WebMCP -> compact routing index.
- Unsupported/zero/malformed WebMCP -> semantic perception fallback with a typed degraded reason.
- Fatal target/context/document/incarnation routing drift aborts the newly created unseen flight before returning the failure.
- Added shared `SemanticPlanningBroker.revalidateContext()` for exact-leader, same-document, non-consuming context validation.
- Added RPC `planning.context`, which performs a fresh B4 capture and returns it only after exact flight + lease + namespace revalidation.
- Protocol bumped to `1.7.0`.
- WebMCP invocation remains absent; `Runtime.evaluate` remains absent.

## Verification added

- 128-tool routing-index boundedness and forbidden-metadata tests.
- Exact final byte accounting.
- Routing-index benchmark versus full R6A envelope and R6B catalog at 8/32/128 tools.
- Lease-bound planning-context tests.
- Cold leader / waiter / cache-hit routing service tests.
- Unsupported, empty and malformed WebMCP progressive fallback tests.
- Orphan-flight recovery test after fatal routing namespace mismatch.
- Real-Chrome R6C routing smoke: 8 cold requests -> one leader + seven waiters, zero waiter context, fresh lease-bound semantic context, promotion, then zero-context cache hit.

## Evidence gate requirements

Before ledger promotion, the exact head must pass:

1. R6A/R6B/R6C shared unit and adversarial tests.
2. R5 planning/cache regression suite.
3. All Compute Browser tests.
4. Existing extension authority/OOPIF/perception regressions.
5. Real Chrome R6A WebMCP support regression.
6. Real Chrome R6B catalog regression.
7. Real Chrome R6C planner routing smoke.
8. R6C 128-tool routing-index benchmark under 48 KiB and >=45% smaller than the R6B catalog.
9. Static absence of `Runtime.evaluate`, `WebMCP.invokeTool`, `WebMCP.cancelInvocation`, remote debugging TCP, and raw engine identity exposure.
10. Deterministic tar evidence, Sigstore build-provenance attestation, and uploaded artifact bound to the exact source commit.

No Supabase ledger promotion is allowed before all gates are green. Post-implementation benchmark research must be recorded and the final exact head re-run after that documentation change so the research itself is included in provenance.
