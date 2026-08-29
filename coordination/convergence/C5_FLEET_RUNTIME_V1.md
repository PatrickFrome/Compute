# C5 Fleet Runtime V1 checkpoint

Branch: `work/convergence-fleet-runtime-v1`
Base: `integration/compute-unified-v1`

## Implemented slice

- Native Browser app substrate is imported from the proven native supervisor lineage without changing `main`.
- `FleetRuntimeStore` adds atomic file-backed durable C5 state.
- `FleetRuntime` adds exact assignment/attempt/worker-incarnation binding, trusted readiness proofs, immutable result/evidence receipts, terminal wake events, and an `AMBIGUOUS_EFFECT` retry barrier.
- `SupervisorKeepalive` owns durable logical supervisor binding, wake leases/idempotency, cooldown, watchdog, PAUSE/OFF, two-phase surface revalidation, and sticky `WAKE_AMBIGUOUS`.
- `NativeSupervisorKeepaliveTransport` uses only CDP accessibility + typed semantic input from `native-browser-control.mjs`; no page JavaScript eval is introduced.
- `main-c5.mjs` bootstraps the C5 runtime in the Electron native main process while leaving the existing native `main.mjs` lifecycle intact.
- Provisioner state is imported read-only into the runtime seam: only `BOUND_UNVERIFIED` physical worker incarnations are bound; LOST workers produce typed runtime loss transitions.
- Workers remain `browser_authority=false`, `direct_peer_messaging=false`, and cannot call the local C5 IPC ingress.

## Fail-closed boundary

The keepalive transport is inert until a trusted local supervisor conversation binding exists and exact semantic composer/send accessible names are configured. A send is confirmed only by native semantic readback; otherwise it becomes `WAKE_AMBIGUOUS` with no automatic retry.

Worker readiness/result transport is intentionally not inferred from tab/page/model text. The module API is the integration seam for a subsequent trusted worker transport adapter; that adapter must produce `TRUSTED_NATIVE_CONTROL_PLANE` readiness proof and exact assignment/attempt/incarnation result receipts.

## Trusted local configuration seam

- `METAENGINE_SUPERVISOR_CONVERSATION_ID`
- `METAENGINE_SUPERVISOR_CONVERSATION_URL`
- `METAENGINE_SUPERVISOR_ID`
- `METAENGINE_SUPERVISOR_EPOCH`
- `METAENGINE_SUPERVISOR_COMPOSER_ROLE`
- `METAENGINE_SUPERVISOR_COMPOSER_NAME`
- `METAENGINE_SUPERVISOR_SEND_ROLE`
- `METAENGINE_SUPERVISOR_SEND_NAME`
- `METAENGINE_SUPERVISOR_KEEPALIVE_STATE=ACTIVE|PAUSE|OFF`

The shell preload also exposes `c5Status()` and `c5Command()` only to the trusted `metaengine://shell/` renderer. Supported local commands include KEEPALIVE_STATUS/PAUSE/OFF/RESUME/BIND and FLEET_ASSIGNMENT_CREATE.

## Non-goals

- no production/main mutation;
- no main promotion;
- no browser authority for workers;
- no worker-to-worker/direct-peer channel;
- no authority derived from page/model/worker prose;
- no blind retry after ambiguous work or wake effects.
