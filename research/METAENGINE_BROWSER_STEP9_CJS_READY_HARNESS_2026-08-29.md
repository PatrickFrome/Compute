# METAENGINE Browser — Step 9 CommonJS readiness harness

Date: 2026-08-29
Branch: `work/metaengine-browser-shell-v1`

## Falsification result

Both the direct `.mjs` harness and the packaged ESM smoke harness timed out before producing the first application stage marker. The production Development Plane implementation and its unit contracts were unchanged, so the failure was localized to Electron main-process readiness/bootstrap rather than DP RPC semantics.

## Research

Electron documents that the `ready` event is emitted only after the main process completes its first event-loop tick and that listeners needed for startup-sensitive APIs should be registered synchronously in top-level main-process code.

A confirmed Electron issue (`electron/electron#40719`) reports `app.whenReady()` never resolving in an ESM main process while a synchronously registered `app.on('ready')` handler fires. The issue was closed as stale/not-planned, so the harness must not assume the Promise path is universally reliable.

Sources:
- https://www.electronjs.org/docs/latest/api/app/
- https://github.com/electron/electron/issues/40719
- https://www.electronjs.org/docs/latest/api/utility-process

## Patch

The physical DP smoke becomes a minimal CommonJS Electron application:

- `smoke/dp/main.cjs` is the main process entry;
- `app.once('ready', ...)` is registered synchronously before the first event-loop tick;
- stage trace writes are synchronous so `MODULE_LOADED` survives later hangs/crashes;
- `DevelopmentPlane` is dynamically imported only after `ready`;
- `utilityProcess.fork()` still runs only after the ready event as Electron requires;
- a bounded readiness watchdog writes `READY_TIMEOUT` and fails closed;
- the same DP0 request and cooperative-shutdown proof is retained.

## Security / authority

This is a test-harness lifecycle correction only. It does not:

- expose Node/Electron APIs to remote pages;
- enable arbitrary commands;
- add browser actuation authority;
- add promotion/update authority;
- relax sandboxing;
- weaken `NO_BLIND_RETRY_AFTER_AMBIGUOUS_EFFECT`.

DP0 remains read-only and cannot promote the current browser.
