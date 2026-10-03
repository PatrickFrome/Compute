# METAENGINE Browser — Autonomous Soak Activation Phase Diagnostics Research

Date: 2026-10-03
Plane: research / source-only diagnostics
Physical retry authority: false
Release / promotion authority: false

## Problem statement

Physical candidate `219ebe989a4f7ce2adfeb205a394a47ee55037cf` is terminal 9/10 green. The only red workflow is Autonomous Soak:

- run `37144386167`
- 72/72 second-instance activations acknowledged
- duplicate Browser runtime: false
- working-set growth: 0
- handle growth: 12 / 24
- concurrent 8-way burst: 426.37 ms
- sequential activation p95: 1771.21 ms
- required p95: <= 1000 ms

The consumed package identity `0.7.0-dev.37139234564.1` must not be rerun.

## Historical control

The earlier physical SLSA candidate `b8f2f438bf3d9450a301ebb525eb95181f6d464d` passed the same soak family:

- run `37076381723`
- sequential activation p95: 157.56 ms
- 72/72 activation ACKs
- duplicate runtime: false
- working-set growth: 0
- handle growth: 5
- concurrent burst: 406.75 ms

Both used the same GitHub hosted runner image family/version:
- Windows Server 2025
- `windows-2025-vs2026`
- image `20260925.250.1`
- runner `2.337.0`

The physical VM/region differed, so machine-level scheduling or storage jitter is still possible, but runner-image drift is not supported by the evidence.

## Protocol comparison

The following activation-critical source files are byte-identical between the historical green and current red candidates:

- `src/main-entry.mjs`
- `src/browser-startup-observability.mjs`
- `src/primary-window-resurrection.mjs`
- `src/single-instance-guard.mjs`
- `src/host-resilience-runtime.mjs`

The current protocol is:

1. losing secondary starts;
2. `requestSingleInstanceLock(additionalData)` loses;
3. primary receives Electron `second-instance`;
4. primary restores/shows/focuses the existing window;
5. primary writes one durable `PRIMARY_WINDOW_ACTIVATED` event with exact launch_id;
6. secondary polls the durable journal every 25 ms;
7. secondary exits success only after exact ACK readback.

The soak SLO currently measures step 1 through step 7.

## Latency shape

The red run is not uniformly slow.

The current startup journal shows a localized contiguous burst of six slow sequential activation intervals around event sequences 71–76:

- about 1036 ms
- 1771 ms
- 1721 ms
- 2181 ms
- 1781 ms
- 1884 ms

The path then returns to roughly sub-400 ms behavior and the later concurrent burst completes in 426.37 ms.

Historical green activation intervals remain near the ~100–180 ms band.

This pattern points to a transient stall, but the old soak proof records only total launch→ACK-exit latency. It cannot tell whether the stall is:

A. host/process creation delay;
B. delay from secondary process start until primary activation event;
C. durable ACK write/readback or secondary shutdown delay.

## Durable ACK path

The exact ACK write is intentionally authoritative and must not be weakened.

`browser-startup-observability.mjs` serializes the `PRIMARY_WINDOW_ACTIVATED` event into the startup journal.

`durable-json-file.cjs` performs:

- unique temp-file create;
- payload write;
- temp file sync;
- rename to target;
- transient Windows rename recovery for EPERM/EACCES/EBUSY using bounded delays;
- committed-file sync.

The journal is bounded, and old/new physical startup journals are the same size class. Therefore blindly removing fsync, skipping durable ACK, or treating an advisory event as sufficient would weaken correctness without evidence.

## Windows durability cost is a real candidate, not yet a diagnosis

The durable ACK implementation performs two Node/libuv fsync operations per committed JSON write: one on the temporary file before rename and one on the committed file after rename.

On Windows, libuv implements `uv_fs_fsync` / `uv_fs_fdatasync` with `FlushFileBuffers`:
https://github.com/libuv/libuv/blob/v1.x/src/win/fs.c

Microsoft documents that Windows normally uses write-back caching and that forcing buffers to storage changes the normal caching path:
https://learn.microsoft.com/en-us/windows/win32/fileio/file-caching

Microsoft also notes that `FlushFileBuffers` can be inefficient when invoked after every individual write because of disk-cache interactions:
https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers

This makes durable storage latency a credible source of occasional outliers, but it is still only a hypothesis. The historical green candidate used the exact same ACK code and durability path, so removing fsync or weakening the write is not justified. The phase diagnostics must first show whether the slow time is concentrated after the primary activation event.

## Guardian hypothesis falsification

A first hypothesis was that the live Guardian EPERM error caused an every-heartbeat retry storm.

Deeper inspection falsified that for the currently observed path.

`createBrowserGuardianMachineBootstrapLauncher().status()` catches the pipe EPERM and returns a valid fail-closed launcher result:

- state `HOLD`
- reason `GUARDIAN_OWNER_OBSERVATION_FAILED`
- ready=false
- automatic_retry_allowed=false

The shared Guardian observer accepts that valid HOLD and caches it using the normal observation TTL. Live readback also shows `observation_error=null`, consistent with a valid cached negative status rather than a thrown observer failure.

The separate `work/guardian-observation-failure-backoff-v1` source-only fix is still useful for genuinely thrown deadline/malformed/rejection failures, but it is not evidence of the p95 root cause and should not be promoted as the soak fix.

## Diagnostic successor

Branch:
`work/autonomous-soak-latency-diagnostics-v1`

Current exact source head:
`21dc926b3ed9bb1fdacd7061e6eb8739fea727a2`

Changes are evidence-only. Runtime product behavior and the 1000 ms p95 SLO are unchanged.

For each of the 64 sequential activation samples the soak now records:

- launch_requested_at
- process_started_at
- primary_activation_at
- process_exited_at
- launch_to_process_start_ms
- process_start_to_primary_activation_ms
- primary_activation_to_process_exit_ms
- total_elapsed_ms
- exact launch_id and durable event sequence

Aggregate evidence adds:

- p50
- p95
- maximum
- count/indexes over budget
- longest consecutive over-budget run
- process-start→primary-event p95
- primary-event→secondary-exit p95
- all 64 bounded samples

The existing failure remains:

`if ($p95Ms -gt $ActivationP95BudgetMs) { throw ... }`

No budget relaxation was made.

## How to interpret the next physical evidence

### Case A — launch→process-start dominates

Likely class:
- hosted VM process creation
- executable image load
- endpoint/antivirus or filesystem launch delay
- OS scheduling

Product code should not be changed until host-level evidence distinguishes a repeatable product cost from runner jitter.

### Case B — process-start→primary-event dominates

Likely class:
- secondary Electron startup before lock resolution
- OS IPC scheduling
- primary Electron main-thread starvation
- periodic product work blocking event-loop dispatch

Then inspect exact periodic main-process work added since the historical green control, with timing instrumentation around the second-instance callback and no weakening of activation proof.

### Case C — primary-event→secondary-exit dominates

Likely class:
- durable journal temp write / fsync / rename / committed sync
- secondary journal polling
- secondary shutdown delay

Then instrument the durable JSON outcome and readback loop, but preserve exactly-once launch_id binding and one durable authoritative ACK.

## Why an evidence-only successor is justified

The present physical failure is performance-only and localized. Editing runtime code from an unproven causal theory risks introducing a second bug while masking the original stall.

The diagnostic successor adds enough causal boundaries to choose the next runtime change from evidence instead of intuition.

It is not itself a reason to allocate a fresh physical version immediately. Before consuming another package identity, source qualification must be terminal green and the team should decide whether the next physical attempt is sufficiently informative to justify the one-shot cost.

## Source qualification

The diagnostic branch is wired into the existing source-only qualification workflow.

It additionally parses the PowerShell soak script with the PowerShell AST parser on Windows, while retaining:

- full Browser regression on Linux/Windows
- R97 source visual proof
- ME2 UI production build
- one-producer/SLSA topology tests
- exact source unchanged guard

Source qualification is now terminal green:
- `37147874369` / #16 / attempt 1 — SUCCESS
- Linux contract — SUCCESS
- Windows contract — SUCCESS
- full Browser regression — SUCCESS on both platforms
- Windows PowerShell AST parse of the modified soak script — SUCCESS
- Windows R97 Client source visual proof — SUCCESS
- one-producer/SLSA topology — SUCCESS
- exact-source unchanged — SUCCESS

## Decision

Do not rerun `37144386167`.
Do not reuse `0.7.0-dev.37139234564.1`.
Do not weaken the 1000 ms SLO.
Do not remove durable ACK semantics.

Continue with source-only diagnostics and causal narrowing first.
