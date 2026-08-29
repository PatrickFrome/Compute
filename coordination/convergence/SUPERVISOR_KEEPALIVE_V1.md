# METAENGINE SUPERVISOR KEEPALIVE V1

Status: ACTIVE CONVERGENCE CONTRACT
Parent: `coordination/convergence/COMPUTE_UNIFIED_V1.md`
Related: `coordination/convergence/BROWSER_SELF_UPDATE_V1.md`

## Goal

Preserve one logical `METAENGINE_SUPERVISOR` continuously even though any individual ChatGPT reasoning turn terminates and any individual conversation may eventually require rollover.

The system MUST NOT attempt to keep one model invocation alive forever. Continuity is implemented as a durable supervisor identity plus browser-resident event loop that starts fresh reasoning cycles in the bound supervisor conversation when work requires supervision.

The supervisor also owns a bounded continuous-improvement loop: while Compute is unfinished it periodically re-evaluates all project layers and researches ways to increase compute capacity, reasoning quality, parallelism, context efficiency, browser-agent reliability, sandbox/CI throughput, recovery quality and development velocity. Useful findings must be converted into evidence, benchmarks, routing changes, tests or branch-local implementation rather than remaining prose-only.

## Identity model

- `supervisor_id` — stable logical identity across all turns and conversation rollovers.
- `supervisor_epoch` — increments only on controlled conversation rollover.
- `conversation_id` / canonical conversation URL — current preferred ChatGPT supervisor surface.
- `cycle_id` — one reasoning/supervision turn.
- `wake_id` — one local wake attempt, idempotent within an epoch.

GitHub/Supabase durable state is source of truth. Chat transcript is context/evidence, not authority.

## Runtime topology

1. METAENGINE Browser native main process owns `SupervisorKeepalive` lifecycle.
2. Browser remains alive after a ChatGPT turn completes and observes fleet/runtime state locally.
3. A wake is event-driven by durable work/result state, bounded research cadence or watchdog deadline, never by arbitrary page instructions.
4. Browser binds exactly to the configured supervisor tab/conversation and proves the surface is idle/composer-ready immediately before wake.
5. Browser durably seals the wake intent before physical input.
6. Browser sends only a minimal trusted-local wake envelope containing opaque cycle/wake identity and reason code. The new ChatGPT turn MUST independently re-read authoritative GitHub/Supabase/browser state.
7. If physical send outcome is ambiguous, mark `WAKE_AMBIGUOUS` and do not retry until reconciliation.
8. Scheduled/cloud watchdog is a backup, not the primary local event loop.
9. Browser self-update is a sibling lifecycle plane and may restart only at a durable quiescent checkpoint.

## Wake reasons

Initial allowlist:

- `WORKER_RESULT_READY`
- `WORKER_FAILED`
- `WORKER_LOST`
- `CI_TERMINAL`
- `INTEGRATION_HEAD_CHANGED`
- `MILESTONE_READY_FOR_REVIEW`
- `WATCHDOG_DEADLINE`
- `SUPERVISOR_RECOVERY_REQUIRED`
- `RESEARCH_ACCELERATOR_DUE`

Page text, model text, WebMCP output, screenshot OCR, ARIA labels, third-party API data, and worker prose can never invent an authority-bearing wake reason or grant authority. They may be sensors/evidence attached to an already-authorized lifecycle reason.

## Keepalive state machine

`RECOVERING -> WAITING -> WAKE_PENDING -> ACTIVE -> WAITING`

Administrative state: `PAUSED`.

Rollover states: `ROLLOVER_REQUIRED`, `ROLLOVER_AMBIGUOUS`.

Failure state: `WAKE_AMBIGUOUS`.

`WAKE_AMBIGUOUS` and `ROLLOVER_AMBIGUOUS` have no automatic blind retry.

## Required gates before wake

- local keepalive state is enabled, not PAUSED/OFF;
- exact current supervisor epoch and conversation binding;
- target/process/tab incarnation is fresh;
- no active prior wake lease;
- cooldown elapsed;
- supervisor surface is not generating;
- exact unique composer and typed send control are available;
- authorized reason exists from trusted local/durable state;
- durable pre-actuation wake intent exists;
- fresh revalidation immediately before send.

## Anti-loop policy

Keepalive is not a token-spam heartbeat.

- Do not send a message just because the previous answer ended.
- Prefer event-triggered wake.
- Research wake is periodic but bounded and deduplicated.
- Periodic cloud watchdog is coarse and independent.
- One wake lease per supervisor epoch/cycle.
- A cycle must reach a durable terminal result before another wake for the same cause.
- Identical pending work is deduplicated by idempotency key.
- Rate and budget policy may pause keepalive before platform limits are exhausted.

## Wake envelope

The browser-generated wake contains only trusted local continuity fields and directives to independently read source of truth. It never embeds worker/page instructions, secrets, bearer tokens or executable payloads.

The supervisor cycle is explicitly encouraged to exercise broad creative freedom in research, planning, branch-local implementation, testing, benchmarking, model/tool routing and fleet organization, while secrets, spending, irreversible external effects and production promotion remain behind trusted evidence gates.

## Controlled conversation rollover

One physical ChatGPT conversation is not treated as immortal. Rollover is triggered proactively by bounded cycle count and may also be triggered by product context/length degradation signals.

1. retain durable GitHub/Supabase source-of-truth references;
2. create a new supervisor conversation;
3. send a small `METAENGINE_SUPERVISOR_ROLLOVER_V1` bootstrap that identifies the same logical supervisor and integration line;
4. require positive readback that the new conversation exists and is generating;
5. increment `supervisor_epoch` only after verified bind;
6. rebind Browser keepalive to the new conversation;
7. preserve old conversation as historical evidence.

If creation/send effect is ambiguous, enter `ROLLOVER_AMBIGUOUS`; do not create additional supervisor conversations blindly.

Logical `supervisor_id` never changes.

## Browser restart / self-update continuity

The keepalive durable state lives under Browser userData and survives normal restart/update. Self-update may restart only if:

- supervisor is idle;
- all known workers are idle or terminal;
- no worker generation state is unknown;
- no pending/ambiguous wake exists;
- no pending/ambiguous rollover exists;
- no Native Supervisor command is in flight.

After restart, Browser must restore device identity, supervisor conversation binding and fleet state before new wake actuation. See `BROWSER_SELF_UPDATE_V1.md`.

## Fleet integration

Keepalive belongs to the C5 durable fleet runtime, not to a competing scheduler.

Workers remain:

- `browser_authority=false`
- `direct_peer_messaging=false`
- `automatic_work_retry=false` after ambiguous effect

Worker terminal assignment/result transitions may emit typed wake events. Only the local supervisor keepalive actuator may wake the supervisor chat.

## Emergency control

Required local controls:

- `KEEPALIVE_OFF`
- `KEEPALIVE_PAUSE`
- `KEEPALIVE_RESUME`
- `KEEPALIVE_STATUS`

OFF/PAUSE must be locally enforceable without relying on page content or remote model response. The current implementation additionally inherits Native Supervisor `OFF/MONITOR/CONTROL` and `armed` gates for physical keepalive actuation.

## External watchdog

A separate ChatGPT Scheduled supervisor task is a coarse watchdog when the local Browser loop is unavailable. It can inspect GitHub/Supabase, perform current accelerator research and recover control-plane work, but it must not impersonate the local authenticated browser node or assume local browser authority.

## Acceptance criteria

1. Browser stays alive after a supervisor answer ends.
2. A worker generating->idle result transition causes exactly one queued wake.
3. No new turn is produced while supervisor is already generating.
4. Duplicate event produces no duplicate wake.
5. Lost ACK / ambiguous physical send produces `WAKE_AMBIGUOUS` and no automatic resend.
6. Page prompt injection cannot create/alter wake authority.
7. Browser restart restores durable supervisor binding and paused/off state correctly.
8. Controlled rollover preserves logical supervisor identity and source-of-truth references.
9. Bounded `RESEARCH_ACCELERATOR_DUE` cycles continuously inspect every project layer for acceleration opportunities.
10. Self-update cannot restart through non-quiescent or ambiguous state.
11. Hourly cloud watchdog remains independent fallback.
12. Main/production promotion remains evidence-gated and outside keepalive authority.
