# METAENGINE Browser Sentinel V1 — recovery research checkpoint

Date: 2026-08-29

## Decision

Use a **separate native Windows companion** rather than Electron `app.relaunch`, a renderer, or `utilityProcess` as the primary crash survivor. Electron documents one main process as the application-lifecycle owner, while utility processes are spawned by main. `app.relaunch()` is useful for controlled restarts but requires the current process to schedule the restart and repeated calls schedule multiple new instances.

Windows WER/Application Restart is a useful secondary OS facility, but it is not selected as the authoritative relaunch mechanism for V1 because METAENGINE needs stricter semantics: exact executable digest/source binding, durable incarnation heartbeat, bounded exponential retry, crash-loop fuse, update grace, and explicit ambiguous-launch reconciliation.

## Windows process semantics applied

A successful process-creation call is not treated as proof that the browser is healthy. Microsoft documents that process creation returns before full initialization; callers needing readiness must perform subsequent synchronization/readback. V1 persists launch intent before spawning and then requires process + heartbeat reconciliation before any further launch.

## Update-security implications

PR #71 uses `electron-updater`, `allowDowngrade=false`, disables web installer where supported, and restarts only at a quiescent supervisor state. Those are useful controls but not a TUF-equivalent update trust root.

TUF explicitly models arbitrary/wrong software, rollback, freeze, mix-and-match and signing-key compromise. A future production update chain should bind a monotonic release counter/version, target hashes/lengths, metadata expiry, channel/device policy and threshold/compartmentalized signatures. Sentinel V1 intentionally refuses to learn a new executable digest from ordinary mutable state.

On Windows, electron-builder documents Authenticode verification of NSIS update payloads against publisher identity. The current development package is unsigned, so Sentinel V1 marks that provenance class `TEST_UNSIGNED` and does not claim production-grade publisher provenance.

## Least-privilege consequences

The Sentinel contains no HTTP client, no updater, no shell, no command parser, no URL, no CDP, no browser automation and no credential integration. It launches only a compile-time named executable derived relative to its own packaged location, with zero arguments and a scrubbed environment. It cannot terminate browser processes; a liveness ambiguity is a HOLD.

## Sources reviewed

- Electron Process Model and `utilityProcess` documentation.
- Electron `app.relaunch()` API behavior.
- Microsoft `CreateProcess` and Application Restart/Recovery documentation.
- electron-builder Windows security, Authenticode and NSIS updater documentation.
- The Update Framework security/metadata guidance for rollback, freeze, mix-and-match and key-compromise resistance.

## Next falsification targets

1. Crash `process.crash()` in an installed Windows package and prove exactly one new incarnation appears.
2. Kill or stall the relaunched process between process creation and first heartbeat and prove no duplicate spawn.
3. Replace the browser image during update grace and prove old Sentinel retires but does not execute it.
4. Tamper heartbeat/state/provenance independently and prove only availability loss, never arbitrary execution.
5. Add Authenticode publisher verification and TUF-style release metadata before any production self-update seal.
