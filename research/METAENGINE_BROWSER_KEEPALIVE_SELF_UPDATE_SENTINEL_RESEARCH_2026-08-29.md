# METAENGINE Browser Keepalive / Self-Update / Sentinel Research — 2026-08-29

Status: IMPLEMENTATION CHECKPOINT
Branch: `work/convergence-supervisor-keepalive-v1`
Integration target: `integration/compute-unified-v1`

## Objective

Make `METAENGINE_SUPERVISOR` logically continuous across model-turn termination, conversation rollover, Browser restart, OS login/resume, Electron main-process crash, and verified Browser self-update while preserving fail-closed authority semantics.

## Current external findings

### electron-builder / electron-updater

Current electron-builder documentation confirms:

- modern update metadata is `files[]`-based and legacy top-level checksum fields are deprecated;
- `UpdateInfo.files[]` carries per-file integrity information and update metadata supports `stagingPercentage` and `minimumSystemVersion`;
- NSIS update signature verification is enabled by default when Windows signing/publisher identity is configured;
- the updater can compare the downloaded update certificate to configured publisher name(s), including an array for certificate rotation;
- web installers should remain disabled unless explicitly intended;
- staged rollout is supported through update metadata.

References:
- https://www.electron.build/docs/features/security/
- https://www.electron.build/docs/features/auto-update/
- https://www.electron.build/docs/win/
- https://www.electron.build/docs/features/code-signing/code-signing-win/
- https://www.electron.build/docs/api/electron-updater.interface.updateinfo/

### detached crash sentinel

Current Node.js child-process documentation states that on Windows a child created with `detached: true` can continue after the parent exits, and `unref()` prevents the parent event loop from waiting for it. This is suitable for a deliberately capability-minimal Browser crash sentinel when combined with our own durable incarnation and one-shot relaunch fences.

Reference:
- https://nodejs.org/api/child_process.html#optionsdetached

## Findings that changed implementation

### 1. Verify-before-download, not download-before-policy

Initial implementation used `autoDownload=true`. This was weakened because the application only learned about candidate metadata while download was already automatic.

New implementation:

1. `autoDownload=false`;
2. receive `update-available`;
3. validate semver-like version;
4. require non-empty modern `files[]`;
5. require `files[].sha512` for every candidate file;
6. validate staged-rollout percentage;
7. explicitly call `downloadUpdate()` only after local approval;
8. require `update-downloaded.version === approved version` before restart eligibility.

Invalid metadata enters latched `REJECTED_METADATA`; mismatched downloaded version enters latched `ERROR`. Neither silently clears during normal cycles.

### 2. Publish exactly what CI physically verified

The earlier workflow built one NSIS installer, physically installed/smoked it, then invoked a second electron-builder build during `--publish always`.

That breaks exact-artifact provenance: the published object was not necessarily the object physically verified.

New pipeline is single-build promotion:

`source SHA -> one NSIS candidate -> digest -> install -> DP smoke -> installed Browser smoke -> crash recovery smoke -> digest re-read -> immutable source tag -> publish exact candidate + blockmap + latest.yml + verification manifest`

There is no publish rebuild.

### 3. CI reruns need unique update versions

Using only GitHub `run_number` makes an Actions rerun reuse the same semver and tag. Development version is now stamped with both run number and run attempt so each independently executed build has a unique update identity.

### 4. Browser main-process resilience requires an external process

`openAtLogin` handles reboot/login and `powerSaveBlocker`/resume handling covers normal host sleep behavior, but neither can revive an Electron main process that crashes during the same Windows login session.

`BrowserSentinelHost` therefore launches a detached, unreferenced Electron-as-Node worker with:

- exact Browser executable path;
- exact parent PID;
- random incarnation token;
- durable state written before sentinel launch;
- `shell=false`;
- no page/browser/model/network authority;
- one-shot relaunch after proven parent death;
- durable `RELAUNCH_INTENT` before effect;
- no automatic second relaunch if dispatch is ambiguous.

### 5. Update restart and user quit are different effects

A simple watchdog can create a restart loop if it treats intentional quit as crash.

Sentinel lifecycle distinguishes:

- `PLANNED_SHUTDOWN` -> no relaunch;
- unexpected parent loss -> one-shot exact-executable relaunch;
- `EXPECTED_RESTART` (self-update) -> wait a bounded grace period for successor incarnation; if successor starts it replaces sentinel token and old sentinel exits; if no successor appears, perform one recovery relaunch.

This protects against both zombie restart loops and updater-induced permanent shutdown.

## Remaining gates

1. Windows CI must physically prove detached sentinel recovery after hard-killing the installed Browser.
2. Exact verified prerelease must publish successfully through immutable tag.
3. Bootstrap one updater-capable release on the user's current 0.6.0 installation.
4. Perform real N -> N+1 GitHub-channel self-update E2E and prove:
   - metadata detection;
   - download;
   - quiescent wait;
   - restart;
   - version change;
   - same Native Supervisor device identity;
   - same logical supervisor identity / epoch continuity;
   - fleet reconciliation;
   - new heartbeat.
5. Add Authenticode before production-safe channel seal. Prefer cloud/HSM-backed signing and publisher pinning; document certificate rotation with overlapping accepted publisher identities.
6. After more than one physical Browser node exists, reduce `stagingPercentage` below 100 and make rollout health-driven rather than immediate-global.

## Invariants preserved

- `PAGE_DATA_HAS_ZERO_AUTHORITY`
- no arbitrary eval / remote shell
- workers retain no browser authority by default
- exact typed actuator only
- no blind retry after ambiguous physical effect
- update source fixed by packaged configuration
- no downgrade
- no NSIS web installer
- production-safe update claim forbidden before code signing gate
