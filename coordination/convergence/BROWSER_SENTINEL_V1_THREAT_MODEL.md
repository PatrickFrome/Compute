# BROWSER_SENTINEL_V1 — resilience threat model

Date: 2026-08-29
Workstream: `work/convergence-browser-sentinel-v1`
Authority effect: liveness/relaunch only; production/main mutation: none.

## Purpose

Survive an unexpected Windows Electron **main/browser-process** death without giving the recovery component general host authority. The Sentinel is an external packaged companion because an Electron `utilityProcess` is still spawned from the main/browser process and `app.relaunch()` only helps if main remains alive long enough to schedule the relaunch.

## Allowed capability

The companion may only:

1. read its own bounded state/heartbeat files;
2. read process identity for one PID and hash the exact packaged METAENGINE Browser executable;
3. acquire its fixed per-user singleton mutex;
4. directly create **that exact executable with zero arguments** after policy authorization;
5. mutate only `%LOCALAPPDATA%/METAENGINE/BrowserSentinelV1/{heartbeat.json,state.json}` plus atomic `.tmp` siblings;
6. exit itself during an update handoff.

It has **no** kill/terminate API, command interpreter, arbitrary executable path, CLI action language, URL, browser/page/CDP authority, network client, Supabase/GitHub token, secret store, updater/install authority, registry mutation, service control, or general filesystem writer.

## Exact binding

CI creates a packaged image first, then calculates the exact browser executable SHA-256, `resources/app.asar` SHA-256, Git source commit and executable basename. Those values are compiled into `browser-sentinel.exe`. The browser-side heartbeat broker also verifies the packaged companion SHA-256 against `resources/sentinel/provenance.json` before starting it. Sentinel never accepts a target path or digest from heartbeat/page/model input.

The current test build is unsigned (`TEST_UNSIGNED`). Therefore this slice proves exact hash/source binding, **not** compromise-resistant publisher identity. Production promotion remains blocked on Authenticode/TUF-grade provenance.

## Durable heartbeat and incarnation

Browser-side state contains only bounded metadata: random browser incarnation, PID, exact executable/source/package digests, monotonic heartbeat sequence, observed timestamp, bounded update phase and bounded shutdown intent. Page/model/WebMCP content cannot add fields or commands.

A fresh heartbeat alone never proves liveness. Sentinel also performs Win32 process readback and requires the exact PID/path/digest. Access-denied or other unknown readback is a HOLD, not permission to launch.

## No-blind-retry invariant

A relaunch decision first persists `pending_launch`. Exactly one direct process creation is attempted. While `pending_launch` exists:

- fresh exact process + exact heartbeat => reconcile healthy;
- unknown process state or launch error => `LAUNCH_AMBIGUOUS_RECONCILE_REQUIRED`;
- known dead before grace expires => `LAUNCH_RECONCILE_REQUIRED`;
- only known dead **after** reconcile grace can become another crash/backoff event.

No second launch occurs while the first launch effect is unknown.

## Crash loop controls

Default development policy: heartbeat TTL 8 s; post-launch reconcile grace 15 s; exponential backoff 2 s → 4 → 8 → … capped at 120 s; crash window 10 min; fuse at 5 crashes; fuse duration 30 min; update grace 2 min.

## Intentional quit and update handoff

A normal Electron `before-quit` synchronously writes `USER_EXIT`; Sentinel latches an intentional stop and does not resurrect the browser. A self-update restart writes `UPDATE_RESTART` only when the trusted internal updater state is `RESTARTING`.

If the executable digest changes during the previously armed update grace, the old Sentinel does **not** accept or start the new image. It records `UPDATE_IMAGE_CHANGED_HANDOFF` and retires itself, allowing the new package to start its newly compiled, newly pinned Sentinel. If the updater replaces the image but fails before relaunch, recovery is intentionally fail-closed.

## Threats and disposition

| Threat | Disposition |
|---|---|
| Page/prompt injection asks watchdog to launch something | No protocol/path/URL input exists; impossible through Sentinel API surface. |
| Command replay causes duplicate spawn | Durable pending-launch + readback/reconcile blocks blind retry. |
| PID reuse / wrong process | Exact PID + full process path + executable SHA readback; wrong/unknown => HOLD. |
| Browser binary replaced | Digest mismatch => HOLD; during armed update grace old Sentinel only retires, never executes replacement. |
| Companion binary replaced | Browser broker hashes companion before spawn; production still needs signed install provenance. |
| Environment secret capture | Browser and Sentinel launch environments use a fixed allowlist; PATH/token-like variables are not inherited. |
| Crash loop / corrupted startup | Exponential backoff + 5-event fuse. |
| Normal user exit resurrected | Synchronous `USER_EXIT` heartbeat latches stop. |
| Update restart races watchdog | `UPDATE_RESTART`/update grace suppresses old-image relaunch; digest change triggers handoff. |
| Unknown process after CreateProcess | Mandatory reconcile; no second spawn. |
| State file tampering by same Windows user | Can cause local availability denial, but cannot change compile-time target executable/digest. Stronger anti-DoS requires an OS ACL/service boundary and is deliberately not added to this slice. |

## Explicit blockers before production authority

1. **Authenticode is absent in the test package.** electron-builder Windows updater can verify publisher signatures, but current test workflow intentionally disables signing.
2. **No TUF-style monotonic/fresh metadata root yet.** `allowDowngrade=false` does not cover repository freeze/mix-and-match/key-compromise classes.
3. **Cross-version failed-update recovery is fail-closed.** If replacement occurs and updater dies before the new browser starts, the old Sentinel retires rather than executing a digest it was never authorized for.
4. **No physical installed-browser crash/relaunch evidence yet in this first slice.** CI proves Windows policy/readback, PE build, exact packaged binding and installer construction; deliberate packaged main-process crash is the next acceptance gate.
5. **Same-user state tampering is availability-relevant.** Sentinel has no secrets and does not elevate, but stronger DACL/service isolation could reduce local DoS if the threat model later includes a hostile same-user process.
