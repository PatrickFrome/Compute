# METAENGINE Browser — Autonomous Soak Diagnostics Source Checkpoint

Date: 2026-10-03
Authority: evidence/checkpoint only
Release/tag/merge/user-install/promotion authority: false
Physical retry authority: false

## Physical predecessor remains consumed

Exact predecessor:
- source `219ebe989a4f7ce2adfeb205a394a47ee55037cf`
- package `0.7.0-dev.37139234564.1`
- physical matrix: 9/10 green
- sole red: Autonomous Soak `37144386167` / #2690 / attempt 1
- failure: sequential second-instance p95 `1771.21 ms` > `1000 ms`

The predecessor package identity is consumed and MUST NOT be rerun or rebuilt.

No release, tag, merge, user-machine install or promotion was authorized by that matrix.

## Qualified evidence-only successor

Branch:
- `work/autonomous-soak-latency-diagnostics-v1`

Exact qualified head:
- `21dc926b3ed9bb1fdacd7061e6eb8739fea727a2`

Delta from consumed predecessor is exactly three files:
1. `.github/workflows/browser-agent-result-installer-source-qualification.yml`
2. `apps/metaengine-browser/scripts/windows-autonomous-session-soak.ps1`
3. `apps/metaengine-browser/test/browser-windows-autonomous-soak-contract.test.mjs`

No runtime Browser module, activation protocol, durable ACK implementation, package version or release authority was changed.

## Diagnostic contract added

For every sequential activation the soak now records:

- launch_requested_at
- process_started_at
- primary_activation_at
- process_exited_at
- launch_to_process_start_ms
- process_start_to_primary_activation_ms
- primary_activation_to_process_exit_ms
- total_elapsed_ms
- exact launch_id
- exact durable event_sequence

Aggregate evidence adds:

- p50 / p95 / max
- count and indexes above the existing 1000 ms budget
- longest consecutive over-budget run
- process-start -> primary-event p95
- primary-event -> secondary-exit p95
- all bounded activation samples

The existing gate remains unchanged:
- `activation_latency_p95_budget_ms = 1000`
- p95 above budget still throws `soak_activation_p95_budget_exceeded`

No evidence-only field can convert a failed SLO into success.

## Source-only qualification

Workflow:
- Browser Agent Result Installer Source Qualification

Exact run:
- `37147874369` / #16 / attempt 1 — SUCCESS

Jobs:
- Linux contract — SUCCESS
- Windows contract — SUCCESS

Qualified gates include:
- full Browser regression on Linux/Windows
- Windows PowerShell AST parse of the changed soak script
- Windows R97 Client source visual flow
- isolated ME2 UI production build on Linux
- one-producer/SLSA topology
- Windows updater physical-push environment verification
- qualification-is-source-only
- exact-source-unchanged

No Package Smoke / NSIS package identity was consumed by this source qualification.

## Research conclusion

The historical green physical control `b8f2f438...` and current red physical candidate `219ebe...` have byte-identical activation-critical files:

- main-entry
- browser-startup-observability
- primary-window-resurrection
- single-instance-guard
- host-resilience-runtime

Both also used the same GitHub runner image version.

The current red journal exhibits a localized burst rather than uniform slowdown, while 72/72 exact ACKs, zero duplicate runtime and resource budgets remain healthy.

The previous hypothesis that live Guardian EPERM causes a 2-second observer retry storm was falsified: the launcher catches that EPERM and returns a valid HOLD, which the shared observer caches with normal TTL. The separate failed-observer backoff branch is a useful robustness change but is not qualified as the p95 causal fix.

Windows/libuv durability remains a credible but unproven contributor because Node/libuv fsync maps to `FlushFileBuffers`, and Microsoft documents nontrivial performance cost for repeated forced flushes. The historical green run used the same durability path, so durability MUST NOT be weakened without phase evidence.

## Related source-only robustness successor

`work/guardian-observation-failure-backoff-v1 @ a942c4e8604b75c409c9527b07f5dca4940b4623`

Source qualifier:
- `37147396254` / #15 / attempt 1 — SUCCESS

This branch:
- backs off genuinely thrown background Guardian observer failures for one TTL;
- preserves explicit force diagnostics;
- remains HOLD/not-ready on failure;
- keeps automatic retry and authority false.

It is not promoted as the soak p95 fix.

## Next safe step

Do not advance the physical producer yet merely because diagnostics are source-green.

Before spending another package identity, use the qualified diagnostic contract to define the exact next physical question:

- if launch->process-start dominates, investigate host/process-creation jitter;
- if process-start->primary-event dominates, inspect Electron main-thread / IPC scheduling and periodic work;
- if primary-event->secondary-exit dominates, instrument durable JSON sync/rename/readback while preserving the exact durable ACK.

A fresh physical run, if later justified, MUST use:
- a new source SHA if any further source changes are made;
- a fresh monotonic package identity;
- Package Smoke as sole producer;
- exact immutable downstream artifact consumption;
- no rerun of the consumed predecessor.
