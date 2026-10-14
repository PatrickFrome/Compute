# METAENGINE W14 — Browser renderer readiness, source-only proof

Scope: read-only classifier `apps/metaengine-browser/src/browser-renderer-readiness-proof.mjs`, adversarial test and independent focused CI. **Not wired into installed Browser, Guardian, DevFleet, or any observer API.** Nothing here restarts, navigates, reloads, captures pixels, executes effects, creates tasks, or touches PostgreSQL. Historical cloud-named code is neither called nor used as fallback.

## Existing source / limits

- `src/browser-realtime-process-plane.mjs` already emits `RENDER_PROCESS_GONE`, `WEB_CONTENTS_UNRESPONSIVE`, `WEB_CONTENTS_RESPONSIVE` and `WEB_CONTENTS_DESTROYED` from Electron Main lifecycle. Its process metrics expose PID *and* creation time, but PID or event existence alone do not prove UI readiness.
- `src/browser-native-semantic-lifecycle.mjs` already invalidates semantic bindings on renderer loss, navigation and destruction. W14 does not change that existing owner.
- `docs/browser-startup-reliability-v1.md` distinguishes process/window startup from usable renderer and explicitly asks for typed renderer failure and recovery evidence.
- Existing `src/tab-health-registry.mjs` allows arbitrary state marks and is not independent pixel/readiness proof. W14 deliberately does not call `mark('HEALTHY')`.

## Contract for a future trusted, native-only adapter

`classifyBrowserRendererReadiness({expected, sample, events, surface, now_ms})` is a pure synchronous reducer. `expected` is the *independently verified* current owner incarnation + exact 40-hex source commit SHA + WebContents ID + OS PID + OS process creation time (milliseconds) + main-frame navigation generation. A sample must repeat this identity with a fresh bounded native timestamp, event cursor and explicit native visibility (`VISIBLE`, `HIDDEN`, `BACKGROUND`). Events are a bounded ordered native Electron lifecycle window, not page/model text. The `surface` is separately sampled by the trusted Main process, with matching identity, an observed timestamp, event sequence fence, `kind=NATIVE_FRAME_PIXELS`, `pixel_state` (`NON_BLANK` or `BLANK`) and aggregate pixel-count/distinct-color evidence.

Only a current visible, nonblank native frame with coherent owner/source/process/navigation/time/event fences yields renderer `READY`. A black or uniform screenshot may remain BLANK even when a deliberately blank application is correct. `READY` does **not** assert full Browser/Host/Owner health, accessibility readiness, functional task execution, real user-visible display, valid permissions or production qualification. A rendered page can be misleading; binding/provenance must come from native code, not a response body.

A frozen Main/WebContents event, crash/destroyed event, hidden/background visibility, blank frame, PID reincarnation and loss of fresh surface proof classify negatively. `WEB_CONTENTS_RESPONSIVE` alone cannot clear a freeze: an entirely new frame after the adverse edge is necessary. On process replacement, the coordinator must fence the old identity; new `expected` and independently collected new native sample+frame are required. Old frames cannot make the new process READY. Missing/contradictory/stale/overlong evidence remains `UNKNOWN`/`RECOVERING`; no blind retry.

## Critical provenance limitation

This function cannot authenticate arbitrary JavaScript argument objects. It is deliberately unwired. A caller who passes forged `kind=NATIVE_FRAME_PIXELS`, timestamps, or identity fields would not have proven anything physical. Future integration must use a trusted in-process Main observer and independently source-bind the owner, process start time, navigation generation, event cursor and native framebuffer sample, with reentrancy and lifecycle fencing. Do not expose it directly through HTTP, renderer IPC, web content, a model agent or worker claims.

No raw pixel data, DOM content, navigation URL, credentials or page text are returned. `authority_effect=false`, `automatic_retry_allowed=false` and `system_health=UNKNOWN` are invariant.

## Source qualification

Run from `apps/metaengine-browser`:

```
node --check src/browser-renderer-readiness-proof.mjs
node --check test/browser-renderer-readiness-proof.test.mjs
node --test test/browser-renderer-readiness-proof.test.mjs
```

The isolated `.github/workflows/browser-renderer-readiness-proof.yml` triggers on W14-only paths, pins exact PR head, has read-only permissions and no package installation or runtime side effects. A green job is hermetic source proof **only**. Windows packaged renderer cold-start, blank/freeze/hidden/background, PID-reuse and physical recovery experiments, trusted Main adapter integration, source/build/installed SHA match and exact Windows artifact evidence remain **UNKNOWN** pending separate authorization and proof. No installed Browser/DevFleet may be restarted or modified by this W14 PR.
