# METAENGINE R95C.2 — Native-authoritative RUN telemetry geometry

Date: 2026-09-27  
Base: R95C.1 `19ca6863658eab11eb7d4e5c9ef04de85f6db94e`  
Scope: presentation geometry/readback only.

## Defect found after R95C.1

R95C.1 removed the original 1024-vs-native geometry mismatch by aligning the renderer breakpoint with the native 1124px threshold.

A second critical review found that this still duplicated authority: the Electron main process derived the safe threshold from native constants, while the renderer independently embedded a literal `min-[1124px]` media breakpoint. The two values matched today, but future geometry changes could drift again without either layer being wrong in isolation.

## Primary-source research

Electron WebContentsView:
https://www.electronjs.org/docs/latest/api/web-contents-view

Electron documents WebContentsView as a Main-process View positioned with `setBounds()`.

Electron Web Embeds:
https://www.electronjs.org/docs/latest/tutorial/web-embeds

Electron explicitly notes that WebContentsView is not a DOM element and accurate positioning against DOM content requires coordination between Main and Renderer processes.

Electron View:
https://www.electronjs.org/docs/latest/api/view

View bounds are native layout state controlled through `setBounds()` in the Main process.

## R95C.2 decision

The process that owns native WebContentsView bounds also owns the telemetry-visibility decision.

- `planShellLayout()` now exposes `me2_run_inspector_effective_visible`.
- the existing presentation-only context-drawer IPC readback returns `run_inspector_visible`;
- the renderer store consumes that exact readback under the existing generation/workspace/page stale-response fence;
- BrowserPage renders telemetry from `runTelemetryInspectorVisible` rather than a Tailwind width breakpoint;
- Right Utility Panel still suppresses telemetry before native Browser width is consumed;
- web-only fallback may use a local width threshold because no native WebContentsView exists there; it cannot create a renderer/native overlap.
- no scheduler, browser-command, update, release, DB or production authority is added.

This removes a duplicated geometry policy rather than adding another control plane.


## Follow-up race audit: page transition must precede geometry readback

A later audit found a causal race in the first R95C.2 draft. Renderer navigation invoked `setPrimaryPage("browser")` and immediately invoked the context-drawer/layout readback without waiting for the first IPC result. Both calls were asynchronous, so the second readback could observe the previous Main-process page and incorrectly return `run_inspector_visible=false` until a later resize or drawer action.

Electron's official IPC contract defines `ipcRenderer.invoke()` as returning a Promise resolved with the `ipcMain.handle()` response. R95C.2 now uses that acknowledgement as a causal fence:

`primary-page invoke → await acknowledgement → RUN geometry readback → generation/page fence → renderer projection`.

The same ordering is applied to restored Browser page state and history navigation. A failed page acknowledgement fails the telemetry projection closed instead of guessing native geometry.

Primary sources:
- https://www.electronjs.org/docs/latest/api/ipc-renderer
- https://www.electronjs.org/docs/latest/tutorial/ipc


## Follow-up ABA audit: history navigation is also a new presentation generation

A second async review found an ABA case in Alt+Left/Right history navigation. That path changed `page` without advancing `contextDrawerSyncSeq`. A delayed RUN reply from browser→other→browser could therefore see the same page/workspace again and pass a fence that had not changed generation.

R95C.2 now increments the presentation generation before every history page transition. This follows the same concurrency principle used by revisioned control planes: identity/value equality alone is not enough after an intervening generation. Kubernetes uses `resourceVersion` to reject stale updates, and etcd exposes monotonically increasing revisions/compare predicates for the same reason.

Primary sources:
- https://kubernetes.io/docs/reference/using-api/api-concepts/
- https://etcd.io/docs/v3.7/learning/api/


## Physical harness falsification: default last-window exit masked the real error

The first diagnostic rerun still reported only `r85_visual_evidence_json_missing`.
The new phase log proved the harness reached `DOCK_RUN_UTILITY_RIGHT` and then entered
`SHUTDOWN`, so an assertion failed before evidence serialization. However the Electron
process still returned exit 0 and `main().catch()` never printed the underlying error.

Electron's current `app` contract explains the mechanism: if no
`window-all-closed` listener is registered, closing the last window quits the app by
default. The harness cleanup destroyed its last `BaseWindow` inside `finally`, so the
process could terminate during exception unwinding before the Promise rejection reached
the outer catch.

The harness now:
- registers a no-op `window-all-closed` listener so only the harness controls terminal exit;
- preserves cleanup in `finally`;
- lets the original assertion reach `main().catch()`;
- writes `r85-visual-failure.json` with the exact phase/error before `app.exit(1)`;
- still exits 0 only after successful evidence serialization.

Primary source: https://www.electronjs.org/docs/latest/api/app
