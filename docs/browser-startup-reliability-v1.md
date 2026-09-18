# METAENGINE Browser startup reliability V1

Date: 2026-09-05

## Incident boundary

The installed `0.6.6-dev.10.1` candidate exposed two distinct failures with the same UX: a losing Electron secondary exited silently when another process owned the singleton, while a normal primary could catch `import('./main.mjs')`, keep HostResilience alive, and expose the error only on GUI `stderr` with no Browser window.

The old Windows Package Smoke was therefore a package/version probe, not a user-launch proof. V1 changes the acceptance criterion from "the EXE starts a probe" to "the installed EXE, with no test flags, produces a durable startup trace and a stable visible top-level Browser window".

## V1 invariants

1. A normal user launch has a unique `launch_id` before requesting the singleton lock.
2. Losing the lock is not success by itself. The primary must acknowledge the exact `launch_id` after restoring/showing/focusing a visible window.
3. A secondary never starts a second Browser runtime, kills the primary, or mutates the primary journal.
4. A mixed-version/old primary that cannot produce the activation ACK becomes an explicit native error, not a silent exit.
5. Main-runtime import success is not UI readiness. A stable visible `BaseWindow` readback is required.
6. Main-runtime import failure is durably recorded and surfaced through a native dialog while the recovery host may remain alive.
7. Observability I/O never blocks release of the Browser bootstrap barrier.
8. Startup history is bounded, append-sequenced and durably replaced; stack text is represented by digest in the durable event rather than copied wholesale.
9. Package CI exercises the same no-flag path a Start Menu/Desktop launch uses and separately proves second-instance activation.
10. `stderr` is supporting evidence only on Windows GUI builds; it is never the sole startup health signal.

## Architecture synthesis from primary sources and mature analogs

1. **Electron `app` / `requestSingleInstanceLock` / `second-instance`** — the supported singleton flow forwards `additionalData` to the primary. V1 uses a random launch nonce as a causal ACK key rather than treating lock loss as proof that a window was surfaced.  
   https://www.electronjs.org/docs/latest/api/app
2. **Electron BaseWindow** — `restore()`, `show()` and `focus()` are distinct window-state transitions. V1 explicitly restores minimized windows, shows hidden windows and focuses them.  
   https://www.electronjs.org/docs/latest/api/base-window
3. **Electron dialog** — `showErrorBox` is designed for early-start errors and is safe before `ready` on Windows. V1 uses it for a stale/old primary that cannot ACK UI activation.  
   https://www.electronjs.org/docs/latest/api/dialog
4. **Electron crashReporter / Crashpad** — crash collection should start early and is separate from application-level startup state. Future V2 can add Crashpad correlation, but a JS import rejection still requires the explicit startup journal because it is not a native crash.  
   https://www.electronjs.org/docs/latest/api/crash-reporter
5. **Electron userData/log paths** — application diagnostics belong under application-owned `userData`/logs storage. Follow-up hardening should move the journal into a dedicated startup subdirectory to avoid Chromium directory-name collisions.  
   https://www.electronjs.org/docs/latest/api/app
6. **Electron webContents lifecycle** — `render-process-gone`, `unresponsive` and `responsive` are typed lifecycle evidence. V2 should extend the same startup/outcome vocabulary to post-window renderer loss rather than infer health from process presence.  
   https://www.electronjs.org/docs/latest/api/web-contents
7. **Electron Process Model** — the main process, renderers and utility processes have different failure domains. HostResilience being alive cannot prove the Browser renderer/UI is usable.  
   https://www.electronjs.org/docs/latest/tutorial/process-model
8. **Electron application debugging** — main-process errors require explicit main-process diagnostics; renderer DevTools do not cover them. The durable journal closes that operator-observability gap for installed builds.  
   https://www.electronjs.org/docs/latest/tutorial/application-debugging
9. **Electron main-process inspector** — `--inspect`/`--inspect-brk` are valuable development tools but cannot be the production startup diagnostic contract.  
   https://www.electronjs.org/docs/latest/tutorial/debugging-main-process
10. **Electron command-line logging** — on Windows child-process logs are more reliably collected to files than stderr. This reinforces not using GUI stderr as the only failure signal.  
    https://www.electronjs.org/docs/latest/api/command-line-switches
11. **Electron netLog** — network diagnostics are a separate bounded evidence stream and may contain sensitive data in expanded modes. Startup V1 intentionally records no network payloads.  
    https://www.electronjs.org/docs/latest/api/net-log
12. **Electron Security Checklist** — remote content must not gain Node/main-process authority. Startup recovery/activation remains entirely in the trusted main process and exposes no renderer/page command channel.  
    https://www.electronjs.org/docs/latest/tutorial/security
13. **Electron Context Isolation** — UI diagnostic surfaces must not bridge raw Electron APIs into remote pages. The startup journal/dialog remain main-process-only.  
    https://www.electronjs.org/docs/latest/tutorial/context-isolation
14. **VS Code Electron focus practice** — VS Code explicitly treats a second invocation as a reason to focus the already-running application, while being cautious about unsolicited background focus. METAENGINE therefore focuses only in response to a concrete second user launch nonce.  
    https://github.com/microsoft/vscode/issues/102997
15. **VS Code multi-window focus handling** — mature Electron apps treat focus/foreground transfer as its own host operation rather than assuming DOM/window focus is enough.  
    https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/window.ts
16. **Microsoft Restart Manager** — installation/update and running GUI processes are one lifecycle problem; installers should coordinate shutdown/restart rather than leave opaque old processes indefinitely. This motivates a future installer preflight/readback, not automatic `taskkill` from the app.  
    https://learn.microsoft.com/en-us/windows/win32/rstmgr/about-restart-manager
17. **Microsoft Restart Manager application guidelines** — GUI applications should participate in orderly restart/shutdown protocols. Future installer work should use an explicit planned-shutdown handoff instead of relying on a new version to defeat an old singleton.  
    https://learn.microsoft.com/en-us/windows/win32/rstmgr/guidelines-for-applications
18. **Windows Application Recovery and Restart** — Windows distinguishes unhandled failure/unresponsiveness from recovery and restart work. METAENGINE likewise keeps failure evidence separate from authority to retry an effect.  
    https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-registerapplicationrecoverycallback
19. **Windows ETW** — production startup diagnostics benefit from structured point-in-time events that can be consumed without restarting the application. The startup journal uses the same event/checkpoint mental model locally; ETW is a later optional export, not a new authority plane.  
    https://learn.microsoft.com/en-us/windows/win32/etw/about-event-tracing
20. **Windows AppUserModelID** — Windows groups processes/windows/shortcuts by stable application identity. The existing `com.metaengine.browser.test` identity remains stable across the hotfix and is set before normal UI use.  
    https://learn.microsoft.com/en-us/windows/win32/shell/appids
21. **Sysinternals Handle / Process Explorer** — operator tooling can identify processes retaining files/objects, useful for diagnosing an old installed process. It is evidence tooling, not an application auto-kill mechanism.  
    https://learn.microsoft.com/en-us/sysinternals/downloads/handle
22. **OpenTelemetry exception semantics** — startup exceptions should be classified as explicit exception events, with severity based on impact. V1 stores bounded error identity/message plus a stack digest; a later exporter can map this without changing runtime semantics.  
    https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-logs/
23. **OpenTelemetry event semantics** — lifecycle state changes such as service startup are appropriate named events. The journal's `BOOT_STARTED`, `RUNTIME_IMPORT_OK/FAILED`, `PRIMARY_WINDOW_STABLE` and activation ACK are intentionally event-shaped.  
    https://opentelemetry.io/docs/specs/semconv/general/events/
24. **Kubernetes startup/readiness probes** — startup completion and readiness are different from process liveness. METAENGINE now mirrors that distinction: host process alive != Browser ready; visible stable window is a separate startup/readiness proof.  
    https://kubernetes.io/docs/concepts/workloads/pods/probes/

## Consequences for the next slices

- **Immediate acceptance:** do not publish `0.6.6-dev.11.1` until exact-head Windows Package Smoke proves no-flag normal UI boot and exact second-instance activation.
- **Installer lifecycle:** add read-only Restart Manager/process census evidence before install; planned shutdown/restart should be journaled and explicit. Do not introduce blind process killing.
- **Crash observability:** evaluate early Crashpad initialization plus Windows LocalDumps/ETW as independent crash evidence. Neither can replace application-level import/readiness events.
- **Renderer health:** after startup is green, journal typed `render-process-gone` / bounded unresponsive transitions and require recovery to preserve the one-attempt/no-blind-retry model.
- **Storage hygiene:** move the startup journal into a dedicated app subdirectory under `userData`, with migration/readback tests, once the launch hotfix is proven.
- **CI:** keep version-probe as a cheap package identity check, but never again treat it as evidence that a user-visible Browser can start.
