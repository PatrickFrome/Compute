# R82 Supervisor Liveness Checkpoint 2 — Maintenance/DevOS phase ordering

Date: 2026-09-26
Branch: `work/r81-browser-release-convergence-v1`
Exact pre-checkpoint head: `3647d422c2eda5045a3f4853d1822008650c28ba`

## Live defect carried into R82

The installed Browser continues to project
`native_supervisor_idle_maintenance_wait_timeout` while the command lane, heartbeat,
Compute and Development Plane remain alive.

## Source-level causal reconstruction

The base client's empty command turn calls `#kickMaintenance()` asynchronously and returns.
The derived DevOS client then sees the same empty batch and immediately starts `#kickIdleWork()`.
That idle work waits for `control_fast_lane.maintenance_in_flight` to clear with a 15 second cap.

The maintenance pass itself contains mesh reconcile, supervisor lifecycle cycle, mesh recovery,
optional auth healing, and self-update cycle. The GLM lifecycle path alone can spend up to
8 × 1800 ms on bounded root hydration recapture before later work is counted. Therefore a
correctly bounded maintenance pass can legitimately overlap essentially the entire historical
15 second wait budget.

The previous completion-relative cooldown fix prevents back-to-back maintenance passes, but it
does not stop this same-empty-turn collision.

## Repair

R82 changes admission ordering instead of increasing a timeout:

1. after `super.cycle()`, DevOS idle work is launched only when the command batch was empty
   AND base maintenance is already not in flight;
2. if that empty turn started maintenance, DevOS simply waits for the next command turn;
3. the base completion-relative cooldown guarantees the next empty turn is a genuine maintenance-free idle window;
4. the existing bounded wait remains as a race guard, not the primary sequencing mechanism;
5. once the barrier succeeds, the historical `idleWorkLastError` is cleared. DevOS execution
   failures remain independently projected as `devos_last_error`.

## Invariants preserved

- remote command leasing retains first admission;
- no second scheduler or timer is created;
- no Browser action is replayed;
- no ambiguous physical effect is retried;
- the maintenance timeout is not inflated;
- maintenance and DevOS remain serialized for mutation authority.

## Verification

Updated `native-supervisor-maintenance-cooldown.test.mjs` now asserts both halves of the
contract: completion-relative cooldown in the base client and derived-client DevOS admission
only after maintenance has settled.

Physical closure still requires an installed candidate and fresh live readback showing the
idle timeout no longer recurs while useful DevOS/supervisor cycles advance.
