# Installer file-use gate and controlled quit safety

Audit baseline: published source `a603cb3af4653a3c653cf451f3ca93c0a9f5552e`, tree `181c212fbc3c17c52962693b2d44204719eec7b4`. Local inspection and inert, temporary-directory fixtures only; no user-machine shutdown, installation, service operation, Owner publication, or live database test was performed.

## Corrected defects

1. `build/installer-shutdown.ps1` used a dead-PID daemon lock to delete a canonical daemon lock, control credential, and separately published compute bridge. It neither bound those files to the installation nor proved their generation; failed PID inventory also meant "dead". The installer no longer selects, reads, or deletes that user state.
2. `src/main-entry.mjs` stopped the local runtime Host before `main.mjs`'s native-worker/project drain. `single-instance-guard.mjs` then armed an unconditional five-second `app.exit(0)`, bypassing `before-quit`/`will-quit` fences. Native coding drain itself can take up to 25 seconds. The explicit control handler now requests only cooperative `app.quit()`: native drain occurs in `before-quit` with the Host capability alive; the existing exact-nonce/PID/instance Host shutdown barrier occurs in `will-quit`. Pending, rejected, or unconfirmed drains do not authorize forced exit.
3. `host-resilience-runtime.mjs` swallowed Sentinel stop exceptions and reported `STOPPED`. It now rejects with `host_resilience_stop_unconfirmed`, retains exact Sentinel custody and a heartbeat-only pump, and reports `STOP_UNCONFIRMED` while startup remains permanently fenced for that object lifetime. Ordinary Quit is held through the same stop path without automatic marker replay. Stop joins prior initial startup, resilience recovery, and explicit preparation operations before its last durable transition marker; pending work cannot overwrite a falsely terminal state later. Failed before-quit marker writes are caught and fenced rather than escaping Electron. A fresh runtime object is required after any stop; updater consumers cannot re-admit a stopped object. This establishes a failed planned-shutdown operation, not proof of physical Sentinel-worker exit.

## Transition restriction: not a zero-input upgrade qualification

The new installer would otherwise call the **currently installed** EXE. Repairing the destination code cannot change an old handler already executing. There is no independently authenticated old shutdown-protocol capability here; version ordering, disappearance, or a self-asserted marker is not one.

Consequently the NSIS install path is now **fresh-install-only**, followed by a read-only installation-file-use gate:

- Any existing target-root contents, exact installation/uninstall registry key in HKCU/HKLM (32-bit or 64-bit view), or uncertain registry read: HOLD before the old uninstaller can run. Only a missing/empty target with absent exact registrations can proceed as fresh installation. The new uninstaller omits this fresh-only precheck but keeps its read-only file-use gate.
- Exact Browser or packaged runtime process present: exit 23 before any shutdown signal or process kill.
- Relevant process inventory fails or a relevant image has missing/invalid executable identity: HOLD, not absence.
- No exact installation processes observed **and fresh-install precheck satisfied**: the installer may proceed to its fresh file-installation stage. This is **not** a native-worker-tree drain, application readiness, or rollback receipt.
- The committed NSIS check still precedes old-version removal/extraction and aborts on invocation error or nonzero result. `ClearErrors` / `IfErrors` precede examination of the output variable: [NSIS documents that its value is undefined when ExecWait fails](https://nsis.sourceforge.io/Reference/ExecWait). Preview/cancel does not signal the client or replace installation files; the framework may create an empty target directory during initialization.

A separately controlled ordinary Quit plus independently verified cleanup is necessary but **not sufficient** for the old generation. The old uninstaller is another old executable: the frozen `installUtil.nsh` invokes it with `/S /KEEP_APP_DATA --updated`, and its silent `un.onInit` invokes the old custom helper even with no live processes. That old empty-process branch can delete the token/bridge. The patched installer therefore refuses an existing installation even after full drain; upgrading `.4594` needs a separately reviewed and artifact-qualified migration. No uninstall bypass is provided. If that proof cannot be obtained, retain the installed image and HOLD. Do not use its old installer-control flag to obtain the proof. Do not stop Guardian or attached PostgreSQL speculatively, kill image names broadly, or retry an ambiguous install. Automatic cooperative installer upgrades remain unqualified until a pinned protocol/custody mechanism is designed and verified.

### Residual boundaries

`runtime-host.mjs` stages Deno into `<state_directory>/deno-runtime/<sha>/deno.exe`; this is outside the helper's package-root inventory. Native workers can also run from other roots. Neither is hidden by a claim that the Browser disappeared. An attached PostgreSQL executable inside the installation root prevents replacement while it remains live; do not kill it to satisfy the file-use gate. Inventory and replacement are also not an atomic cross-process lock.

`runAfterFinish` remains true. An Owner/runtime digest mismatch still rejects normal startup rather than rebinding automatically; successful file replacement alone cannot make the new provider admissible.

## QA Owner upgrade effects at baseline

`qa-owner-runtime-upgrade.mjs` is an explicit operator workflow, **not a read-only probe**:

- **prepare:** verifies/pins the old stopped runtime, image and NSIS effects; creates a private sibling QA state directory; copies old Owner/config (including private connection settings); snapshots image/NSIS; derives new configs and starts the candidate Host on the same database URLs, PGDATA, cluster identity, API and Edge ports (`makeUpgradeConfigs`, lines 263–269; `qualify`, 328–365; prepare, 368–414). Attached mode does not own/start/stop the keeper PostgreSQL, and checks keeper incarnation/PID-file/Vault continuity (304–316). Nevertheless real API/Edge listeners are temporarily exposed against the current DB; other local consumers are not globally excluded by `noBrowser()`. Do not describe this as isolation from live workload effects or schema compatibility proof. Guardian's private ticket consumer is lazy and is not requested by qualification; no SCM/service shutdown is implied.
- **publish:** verifies evidence, creates a launch gate/journal, and replaces the canonical Owner with the proposed provider **before NSIS** (489–560). This is an external authority-bearing file mutation despite `authority_effect:false` metadata. The metadata limits release/production qualification; it does not erase filesystem effects.
- **finalize:** verifies actual installed resources and whole image/NSIS, unchanged keeper, absent Browser/API/Edge; retires the gate and writes completion evidence, then commits the final admission marker (640–689). It does not launch a Browser or reconcile historical/ambiguous task effects.
- Recovery of Owner bytes alone is not whole-image rollback. Preserve the exact predecessor snapshot, config and installation-effect evidence. All uncertain outcomes require readback, not automatic replay.

The `publishOwnerFile` read-check/rename sequence (470–486 at baseline) is not an OS-level compare-and-swap against an unrelated concurrent writer. The workflow's exclusive gate serializes cooperating operations only. Never infer permission to overwrite a concurrent Owner merely from a prior matching hash.

## Regressions and remaining qualification

Portable tests use an inert child with the production Host controller and real drain module, but stub Electron lifecycle/UI. They cover normal and startup-race cooperative shutdown, drain-before-Host ordering, pending/rejected worker drain, missing/foreign terminal nonce, no forced fallback, and failed Sentinel planned shutdown. Source checks bind the fixture's event ordering to the production `before-quit` / `will-quit` placement.

From repository root:

```sh
node --test apps/metaengine-browser/test/host-resilience-stop-fence.test.mjs apps/metaengine-browser/test/host-resilience-runtime.test.mjs apps/metaengine-browser/test/installer-resident-shutdown.test.mjs apps/metaengine-browser/test/installer-managed-runtime-shutdown.test.mjs apps/metaengine-browser/test/installer-commit-shutdown-stage.test.mjs apps/metaengine-browser/test/installer-upgrade-identity.test.mjs apps/metaengine-browser/test/local-provider-singleton-admission.test.mjs apps/metaengine-browser/test/managed-runtime-drain.test.mjs
(cd apps/metaengine-browser && node scripts/check-source.mjs)
```

The same command on a **fresh isolated Windows checkout** enables the ten PowerShell fixture groups. The harness replaces all process-inventory/signal/kill calls, uses inert files and a temporary USERPROFILE, records forbidden mutations, and never starts the installed Browser. It covers live legacy/unknown protocol HOLD, exact packaged runtime orphan, absent EXE, private credential preservation, foreign paths, missing executable identity, inventory failure, empty/missing fresh targets, existing registration, and registry UNKNOWN. For fresh-install checks only, the test substitutes the exact native registry facade with inert objects; it reads no actual user registry and performs no registry writes. Linux skips these ten groups; source tests are not a substitute for running Windows PowerShell.

Remaining separate qualification: native Electron prevented-quit behavior, physical Sentinel/worker-tree cleanup with a disposable profile, the pinned built artifact's NSIS stage and preservation/abort behavior, and the exact old-to-new Owner/PG/Guardian transition. None has been established by these portable tests, and they must not be attempted on live state merely because this repair exists.

Historical first mitigation commit `8b3d4edd` (not the later lifecycle correction): combined targeted command **61 passed, 0 failed, 9 skipped** (8 Windows PowerShell groups and the unavailable bundled NSIS Modern UI callback fixture). Separate Host controller/terminal/Sentinel-evidence set: **44 passed, 0 failed**. Source syntax checker: **243 passed**. These are focused checks, not the full repository suite or Windows install qualification.


### Additional correction regressions

`host-resilience-stop-fence.test.mjs` uses production HostResilienceRuntime and BrowserSentinelHost with inert child handles. It fails only the exact planned-state rename, advances virtual time beyond the real 120-second stale-progress horizon, and proves the retained scheduler writes heartbeat without recovery, restart, preparation, ordinary-quit replay, or updater re-admission. Delayed real candidate-binding and expected-restart rename tests prove stop does not resolve before prior writes settle. Initial-start and dual native/Sentinel quit-fence orderings are covered. No physical process spawn or signal occurs.

The ordinary installer gate runs before extraction. The frozen `.onInit` can create an empty `$INSTDIR`, which is permitted; this configuration has no debug logging into it. The helper itself is extracted only into `$PLUGINSDIR`. The empty-root and missing-root fixture cases are distinct. Native NSIS compilation/execution and Windows PowerShell execution remain separate required checks, not inferred from the portable source/control-flow tests.

Correction-worktree verification: expanded Sentinel/resilience/installer/provider/Host/drain set **149 passed, 0 failed, 11 skipped** (10 Windows PowerShell fixture groups and unavailable bundled NSIS MUI fixture). Updater handoff/control/effect set **23 passed, 0 failed**. The final Host lifecycle edit was rechecked separately: **17 passed, 0 failed**. Source syntax checker: **243 passed**. No Windows execution or installation result is implied.

A subsequent exact-binding correction rejects absent/foreign Sentinel state before a planned marker and independently reads back its token, parent PID, lifecycle and expected revision after the durable write. Cached snapshots are not stop receipts. The retained parent-progress lease also reads the original Sentinel generation's durable binding rather than authorizing writes from cached identity; missing/foreign identity holds without overwriting a successor's heartbeat. After a confirmed terminal marker, new heartbeat admission stops and all already-owned progress writes settle before custody and quit fences are released. A pending write remains HOLD. Explicit same-custody revalidation is still required to release an unconfirmed shutdown fence. Inert negative tests change only fixture state before stop, at the internal reread, or after the actual marker rename; none signals or spawns a real process. These read checks are not an OS compare-and-swap against an unrelated concurrent writer.

Exact-binding/heartbeat-tail delta verification: expanded Sentinel/resilience/installer/provider/Host/drain set **159 passed, 0 failed, 11 skipped**; updater set **23 passed, 0 failed**; source syntax checker **243 passed**. The ten added real-Sentinel inert cases include pre/post-write binding loss and an actual delayed parent-progress rename that must settle before `STOPPED`. The same Windows and artifact qualification limits still apply.
