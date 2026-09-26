# R82 Supervisor Liveness Checkpoint 1

Date: 2026-09-26
Branch: `work/r81-browser-release-convergence-v1`
Current exact head before this checkpoint: `bdbe84a0602a56b03ca162296ca6c5fdc9d34a51`
Release ancestry: `release/self-update-ambiguity-live-v2 @ cf747798a285f113ac3ae1563da4be8bd4e56705`

## Fresh live evidence

The installed Browser remained alive and signed into the control plane, but the useful supervisor loop was not progressing:

- keepalive state: `ROLLOVER_AMBIGUOUS`
- rollover reason: `TYPE_EFFECT_AMBIGUOUS`
- rollover attempt: `rollover_90c77dca-7f24-4888-85dc-d7635c9660e8`
- durable rollover tab id: `tab_82cfe647-8ecc-4c79-afd9-47cf5d0f05b9`
- recovery action: `ROLLOVER_AMBIGUOUS_NO_PROGRESS_REREQUEST`
- cycle sequence: `2109`
- last completed cycle: `2026-09-24T22:35:42.944Z`
- residual DevOS idle error: `native_supervisor_idle_maintenance_wait_timeout`

A single read-only CAPTURE diagnostic was issued with exact idempotency key
`r82-capture-rollover-90c77dca-20260926`.
Command `a1b80624-7429-40ce-b1db-c1d001ee4c08` reached a terminal FAILED state with
`native_supervisor_target_view_unavailable`. It was not retried.

That terminal readback proves a concrete split-brain condition: the signed TabRegistry projection still advertised the rollover tab while the physical WebContentsView was no longer available.

## Root cause in current source

`ExactBrowserTabViewMap` already removes its exact tab↔WebContents binding when Electron emits `webContents.destroyed`.
However, `wireRemoteView` previously never retired the corresponding `TabRegistry` row on that event. `nativeSupervisorState()` projects `registry.snapshot().tabs`, so a destroyed physical target could survive indefinitely as a logical ghost tab.

The rollover ambiguity code then continues to reason over that stale row, while CAPTURE correctly fails because the physical view is gone.

## External research

Electron documents `webContents.destroyed` as the event emitted when the WebContents is destroyed. It documents `render-process-gone` separately for an unexpected renderer disappearance, so R82 does not treat renderer loss alone as proof that the owning WebContents/tab should be retired. Electron also places WebContentsView lifetime management on the main process / BaseWindow owner.

References:
- https://www.electronjs.org/docs/latest/api/web-contents
- https://www.electronjs.org/docs/latest/api/web-contents-view
- https://www.electronjs.org/docs/latest/api/base-window

## Implemented

1. Added `src/tab-view-lifecycle.mjs` with idempotent logical-tab reconciliation from exact physical WebContents destruction proof.
2. `main.mjs` now listens to `webContents.once('destroyed')` and retires the matching TabRegistry row, updates selected/perception state, notifies the existing fleet lifecycle owner and republishes state.
3. Explicit close races remain safe: if `closeTab()` retired the registry row first, the destroyed-event reconciliation is a no-op.
4. `render-process-gone` remains observation-only; it does not falsely retire a WebContents that Electron has not destroyed.
5. Added regression tests for one-time cleanup, selected-tab fallback, fleet notification idempotence, main-shell wiring, and separation of render-process-gone from destroyed.

## Authority and ambiguity discipline

This fix does not resend the ambiguous rollover, bind a replacement conversation, close a user tab, issue a second scheduler, or reinterpret an unknown effect as failure/success. It repairs the local identity projection for future physical lifecycle events. The existing ambiguous attempt remains fenced until fresh installed-runtime evidence can reconcile it.

## Remaining R82 gates

- exact-head CI must pass;
- physical candidate must be installed/self-updated before claiming live closure;
- stale logical tab must disappear when its WebContents is physically destroyed;
- rollover must obtain positive seed/submit/readback and bind a real conversation;
- `cycle_seq` and `last_completed_cycle_at` must resume advancing;
- residual `native_supervisor_idle_maintenance_wait_timeout` still requires a separate root-cause repair, not a timeout increase.
