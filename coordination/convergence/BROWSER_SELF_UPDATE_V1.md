# METAENGINE BROWSER SELF UPDATE V1

Status: ACTIVE CONVERGENCE CONTRACT
Parent: `coordination/convergence/COMPUTE_UNIFIED_V1.md`
Related: `coordination/convergence/SUPERVISOR_KEEPALIVE_V1.md`

## Goal

Allow METAENGINE Browser to continuously evolve, install verified development releases from inside itself, restart, recover the same logical supervisor/fleet state, and resume work without manual re-bootstrap.

## Trust model

Self-update is a trusted lifecycle plane, not page authority.

- Page, model, worker, WebMCP, screenshot or remote website data can never choose an update artifact or bypass update policy.
- Update source is fixed by packaged configuration.
- Downgrade is forbidden.
- NSIS web installer is forbidden.
- Update metadata/digest verification is mandatory; Authenticode publisher verification becomes mandatory before production channel promotion.
- Development prerelease may remain explicitly non-production while unsigned.
- Main/canonical promotion and update installation are separate gates.

## Runtime states

`DISABLED -> IDLE -> CHECKING -> CURRENT | DOWNLOADING -> READY_RESTART -> RESTARTING`

Failure state: `ERROR`, fail closed. No arbitrary fallback URL and no downgrade.

## Quiescent restart gate

Browser may restart only when all are true:

- no current Native Supervisor command;
- supervisor conversation is idle;
- no worker generation is active or unknown;
- no `WAKE_PENDING` or `WAKE_AMBIGUOUS`;
- no `ROLLOVER_REQUIRED` or `ROLLOVER_AMBIGUOUS`;
- durable fleet and supervisor keepalive state has been written;
- update is fully downloaded and verified by updater policy.

## Restart continuity

After installer requests restart:

1. preserve persistent user session partition and Browser userData;
2. preserve P-256 Native Supervisor device identity;
3. preserve fleet durable state;
4. preserve `METAENGINE_SUPERVISOR` keepalive state and conversation binding;
5. start new Browser process;
6. verify installed version and update state;
7. restore supervisor tab if missing;
8. reconcile fleet physical tabs/incarnations;
9. re-establish signed heartbeat/enrollment;
10. resume event-driven supervisor cycles only after continuity readback passes.

## Development update channel

Initial implementation uses electron-updater + electron-builder GitHub prerelease publishing.

- package channel allows prereleases;
- `allowDowngrade=false`;
- `autoDownload=true`;
- `autoInstallOnAppQuit=false`;
- `disableWebInstaller=true`;
- update check is coarse/rate-bounded;
- installation occurs only through quiescent restart gate;
- `quitAndInstall(false, true)` is used so the updated Browser restarts automatically.

Before production-quality autonomous updates are sealed, add Windows Authenticode signing, publisher pinning/certificate rotation policy, rollback evidence and release provenance/SBOM.

## Acceptance criteria

1. Packaged Browser contains update feed configuration.
2. New semver prerelease is detected without manual browser download.
3. Downloaded update does not restart while supervisor/worker is generating.
4. Pending or ambiguous wake blocks restart.
5. Verified quiescent state permits install/restart.
6. Browser starts automatically after update.
7. Device identity, supervisor binding and user session survive restart.
8. Fleet is reconciled rather than blindly retried.
9. Updated Browser heartbeat exposes new version and continuity state.
10. Unsigned development channel cannot be promoted as production-safe until Authenticode gate is satisfied.
