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
