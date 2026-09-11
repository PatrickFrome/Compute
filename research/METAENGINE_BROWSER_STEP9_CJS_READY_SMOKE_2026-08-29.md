# METAENGINE Browser — Step 9 CommonJS ready-event smoke harness

Date: 2026-08-29
Branch: `work/metaengine-browser-shell-v1`

## Evidence before change

Run 17 (`9bdf98f8233949bf0e1e2aa4eb2eaec0874176f3`) failed on Linux, Windows Server 2022, and Windows latest. The Windows stage trace contained `MODULE_LOADED` but no `APP_READY`, so the isolated ESM smoke never reached `utilityProcess.fork`. Linux likewise timed out before producing the physical receipt.

This falsifies the hypothesis that the remaining red gate is caused by Development Plane request or shutdown semantics.

## Research

Electron documents that the `ready` event is emitted once after initialization and that `app.whenReady()` is a Promise convenience around that event. Electron also has a confirmed ESM bug report where `app.whenReady()` never resolves while an explicitly registered `ready` listener does.

Sources:
- https://www.electronjs.org/docs/latest/api/app
- https://github.com/electron/electron/issues/40719

## Correction

The isolated physical smoke is now a CommonJS main process entry (`smoke/dp/main.cjs`). It registers `app.once('ready', ...)` synchronously before yielding the event loop, then dynamically imports the ESM `DevelopmentPlane` only after Electron is ready.

The harness also:
- writes stage markers synchronously to a trace file;
- has a bounded app-ready watchdog;
- keeps `app.enableSandbox()` enabled;
- passes only a minimal OS environment allowlist plus `METAENGINE_REPO_ROOT` to the utility process;
- still requires exact capability handshake, read-only DP0 requests, cooperative `SHUTDOWN_ACK`, observed process exit, and `STOPPED` state.

## Security / authority

No new capability is introduced. The smoke has no renderer, no network navigation, no arbitrary code execution surface, no direct promotion, and no browser actuation authority. This is a harness correction only.

## Verification rule

Do not advance the authoritative Supabase checkpoint until an exact-head workflow proves the physical DP smoke on Linux and the mandatory pinned Windows runner. The rolling Windows image remains a diagnostic canary.
