# Active Owner read: source checkpoint, incomplete

Base: `104c25185bb841fe82e957f704373e6ee92bebcf` (`work/public-owner-read-wip-20261030`, PR #1386), whose public parent is `5d7ec74db1c72b15921a6e00a2826a09a72f4fb2`. This checkpoint contains only source, tests and this handoff. It does not contain private recovery history, installed identity, credentials or native qualification evidence.

The fixed signed `READ_RUN_OWNER_CUSTODY_V1` action is now mounted in the existing Host IPC maps and original physical inflight budget. Main has a loaded-only private composition using existing identity, W74, fixed W68 and W60 readers. It registers HOST_SCOPE cleanup before signing/dispatch. It does not expose a renderer endpoint, ensure/enroll/reseal, acquire a new key, create a new trust root or release execution capacity.

Host joins the active execution/reservation, project, pending admission, immutable activation and seed, current ADMIN pairing, original protected intents, physical Main/PG identity and runtime control. SELECT FOR SHARE retains the control fence in the caller's original transaction; an older SERIALIZABLE snapshot conflicts with a newly committed stop/reset instead of silently returning old control. No nested Host request or SQL transaction is used by the private seam.

## Private integration contract

`createNativeRunOwnerReader(...).readOwnerControl({permit, scope, tx, request})` returns `{owner, observed_at, sealed_owner_sha256, control, qualification, result, authority_effect:false}`. `owner` is the COMPLETE ORIGINAL sealed record with its immutable original `observed_at`; the top-level `observed_at` is a separate fresh observation. `tx` is the original monitored transaction and `request.runOwnerPhases` is its bounded original request phase. The result is not a cacheable admission boolean or send ticket. The standalone operation validates its signed request before opening the transaction.

Publication integration is NOT complete. The publication reader remains null and publication remains HOLD. The fixed phase currently accepts only the read action; adapting a publication request to this seam must retain its own original request/transaction and cannot call the standalone read recursively. Publisher freshness checks must not treat the immutable Owner timestamp as a fresh observation. Qualification stays `loaded_runtime_code_attested:false`, `production_qualified:false`, `execution_ready:false`.

## Completed checks

- Repeated WIP five-suite set: 72 tests, 71 passed, 1 skipped, 0 failed. The original 62-test subset is 61 passed plus the same skip. Windows symlink/reparse privilege was unavailable; no ACL or security change was made.
- New private Host reader source fixtures: 16 passed. Covers original seal timestamp, exact intents, reservation/project/Host/device/PG, revoked identity, stop/reset, stale evidence and refreshed seal, two independent invocations and transaction loss.
- New real owned ChildProcess IPC and loaded signer suite: 3 passed. Synthetic native evidence only. Covers two reads, shared inflight budget and retained callbacks after timeout; signer performs no ensure or persistence.
- Lifecycle/transaction regression selection including the 16 reader tests: 80 passed, 0 failed/skipped.
- Disposable PostgreSQL 17.11 control suite: 5 passed, 0 failed/skipped. The actual control table DDL and production locking query demonstrate blocked concurrent stop/reset, stale-snapshot serialization rejection and fresh disabled-control rejection. The disposable cluster was stopped and removed.
- Syntax checks of new/modified production modules completed before the final active-PG test additions.

## Incomplete and unresolved

- Active-project PG coverage was added to the existing pending-goal PG suite via `test/active-run-owner-pg-fixture.mjs`. It performs actual signed activation, browser-parent W30 lease, project child spawn, native provider registration, CLI W30 and reservation. Native/ACL data remain explicitly generated fixtures. It deliberately refuses native promotion at the phase boundary. Initial attempts exposed missing fixture control DDL and a missing fixture sandbox; those fixture repairs are saved. The final rerun was still in progress when this handoff was prepared; do not count it as passing without its result.
- Broad IPC/phase regression run: 105 tests, 102 passed, 3 failed. Two failures were timeouts in existing run-facet tests; one was the in-memory broker import transformation. A targeted unmodified public-base reproduction passed the two selected timing cases and reproduced the broker SyntaxError. Timing failures remain unresolved; no deadline was relaxed.
- Positive installed Windows native qualification was not performed. Existing STAGING data are not reclassified as genuine evidence. No live installed client, Guardian, enrollment, keys or database were changed.
- Complete default Main lifecycle/quit integration is source-mounted but requires a dedicated native-held callback and quit-order test of this new composition. Existing cleanup regression tests passed; that does not prove the new native end-to-end path.
- The activation selector relationship and full active-project success path need final review. No publication/send gate lift, capacity release, merge or deployment is included.

Development stopped at the requested collection checkpoint. This is reviewable WIP, not an overall PASS.
