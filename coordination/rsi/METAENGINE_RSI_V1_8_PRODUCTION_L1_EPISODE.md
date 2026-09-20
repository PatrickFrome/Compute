# METAENGINE RSI V1.8 — Production-Derived Command-Plane L1 Episode

Status: IMPLEMENTED AS SHADOW EVIDENCE CLASSIFIER / NO LIVE AUTHORITY

Frozen convergence base:

- release parent: `2b8b4b4e040423babdfe0cfbe696d7ee13380809`
- RSI parent: `f65f7d4ddbf16260fd8ae1ed3c848b08def00723`
- clean signed merge snapshot: `b71075d3534fd2cd4709c5ad17fd7d47f60c545f`
- implementation branch: `work/metaengine-rsi-v1-l1-command-stall`

## Why this episode exists

The installed release produced a real command-plane liveness failure that was independently visible in durable supervisor command readback. A `SCROLL` command was leased at `2026-09-17T05:09:48Z`, effect-bound at `05:09:49Z`, and did not obtain a result receipt before the command cycle stopped making progress. Heartbeat and perception continued to advance while later commands remained unleased. Recovery later expired the stranded command with `lease_timeout_no_retry`.

The RSI lesson is not "retry the command". The effect had already crossed the effect-binding boundary, so replaying the physical action would violate one-attempt ambiguity semantics. The useful improvement target is the liveness and receipt-delivery machinery around the already-bound effect.

## New bounded observer

`rsi-command-plane-liveness-observer.mjs` consumes only a sanitized, zero-authority projection:

- exact source SHA
- observation/heartbeat/perception/command-progress timestamps
- bounded active-command identity, action, lane and status
- effect-bound and receipt timestamps
- pending command count
- explicit privacy and authority-denial flags

It never consumes command payload, page text, input values, raw network data or DOM state.

The observer can emit two P0 `BROWSER_RUNTIME` opportunities:

1. `RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING`
   - active command is still in an execution/result-delivery state;
   - command progress is older than the predeclared stall threshold;
   - effect binding exists;
   - result receipt does not exist.

2. `COMMAND_PLANE_STALL_WITH_HEALTHY_HEARTBEAT`
   - heartbeat is fresh;
   - perception is fresh;
   - command progress is stale;
   - there is an active or queued command.

The second signal prevents a healthy heartbeat from falsely proving command-plane liveness.

## DevOS handoff

The existing RSI → DevOS bridge now accepts the new command-plane observation schema. It still creates only a pre-lease experiment plan. It does not create a task lease, assign an agent, bind a workspace, issue a Browser command, invoke self-update or mutate production.

Two explicit constraints are added to every RSI experiment:

- `ambiguous_effect_reconciliation_before_followup_mutation`
- `result_delivery_retry_must_not_reexecute_effect`

These preserve R4/R5/R6 semantics while allowing a candidate to improve result transport, durable receipt reconciliation or command-progress health.

## Acceptance contract

The slice is acceptable only if tests prove:

- the production-derived L1 shape emits both expected P0 opportunities;
- fresh command progress emits no stall opportunity;
- stale heartbeat is not mislabeled as a healthy-heartbeat zombie supervisor;
- authority-bearing/private/impossible-time projections are rejected;
- the resulting DevOS plan remains zero-authority and pre-lease;
- result-delivery retry can never be interpreted as permission to replay the physical effect.

## Next slice

Build an isolated candidate for the first L1 opportunity against the frozen source SHA. Candidate scope should be limited to bounded result-delivery transport + independent receipt readback + command-progress liveness telemetry. Promotion, install and production DDL remain out of scope until evaluator/tournament evidence is independently complete.
