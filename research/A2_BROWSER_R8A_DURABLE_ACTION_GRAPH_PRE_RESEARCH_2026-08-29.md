# A2 Browser R8A — Durable Action Graph Core — Pre-Implementation Research

Date: 2026-08-29
Parent verified: R7M `e4da88a5c79d3e0c4f86c5378c5bfa19a93973cb`
Milestone: `R8_DURABLE_ACTION_GRAPH_V1` / slice `R8A_APPEND_ONLY_CAUSAL_GRAPH`

## Problem

R7 completed a read-only, authority-free skill source chain. The browser roadmap now requires durable action state. The central risk is that persistence/replay can accidentally become authority to repeat a physical browser effect after a crash or ambiguous transport failure.

A click, form submission, navigation or other consequential action is not generally idempotent. Durable history must therefore restore *knowledge* about what was intended and observed, while never converting an old journal entry into permission to actuate again.

## Existing project precedents

The Compute Browser B2/B3 line already persists pre-effect intent before engine calls and intentionally quarantines ambiguous operations instead of blindly retrying them. R5/R6 also require fresh causal namespace and actionability evidence before actuation and explicitly mark planning/cache results `authority_effect=false`.

R8 must preserve those invariants rather than introduce a second replay model.

## Primary-source comparison

### Temporal durable execution

Temporal reconstructs workflow progress from durable history and resumes after process/infrastructure failure. This is a strong analogue for append-only history and deterministic state reconstruction. It is not a sufficient actuation policy by itself: external activities still require careful idempotency semantics.

Source: https://docs.temporal.io/

### Azure Durable Functions / Durable Task

Durable orchestrators use event sourcing and replay. Microsoft explicitly requires deterministic orchestrator code and documents that activities are at-least-once: an activity may execute again when completion occurred but its result was not recorded. That is unacceptable as the default semantic for browser physical effects.

Sources:
- https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-orchestrations
- https://learn.microsoft.com/azure/azure-functions/durable/durable-functions-types-features-overview

### AWS Step Functions Standard Workflows

Standard Workflows persist state between transitions and advertise exactly-once workflow execution unless Retry is configured, making them suitable for non-idempotent operations. This validates explicit transition durability and durable execution history, but adopting an external workflow service would add a large dependency/control plane and would not eliminate the need for browser-local fresh authority/actionability checks.

Source: https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html

### Playwright actionability

Playwright resolves the current locator and checks current actionability before each physical action. R8 must keep the same class of freshness property: historical graph state may order actions, but it cannot establish that the target is still visible, enabled, stable, receiving events or otherwise safe to actuate.

Source: https://playwright.dev/docs/actionability

## Options

### A. Mutable state-machine snapshot only

SECURITY: simple but weaker auditability; a torn or overwritten state can erase the distinction between intent and observed effect.

RELIABILITY: easy restart, poor forensic history.

TCB/COMPLEXITY: smallest.

FAILURE MODE: lost transition provenance, dangerous around ambiguous effects.

Decision: reject as source of truth.

### B. External durable workflow engine now

SECURITY/RELIABILITY: mature durability systems, but activity retry semantics still need browser-specific safety.

TCB/SUPPLY CHAIN: very large compared with the current dependency-free Node shared layer.

PORTABILITY/OPERATIONS: introduces another service and deployment dependency before the action model itself is proven.

Decision: defer; later R15/R16 infrastructure may benefit from a distributed workflow backend.

### C. Append-only causal action DAG with small local durable journal

SECURITY: strongest fit for `NO_BLIND_RETRY_AFTER_AMBIGUOUS_EFFECT` and `PRE_ACTUATION_DURABLE_BEFORE_EFFECT`.

RELIABILITY: deterministic replay reconstructs state; hash chain detects modified history; fsynced journal survives process restart.

TCB: Node built-ins only, no new package dependency.

OBSERVABILITY: every semantic transition has a monotonic sequence and digest.

TESTABILITY: crash-window, corruption, dependency and ambiguity semantics can be tested on a real filesystem.

Decision: choose.

## Decision

Implement R8A as two layers:

1. `durable-action-graph-core-v1.mjs`: deterministic, append-only causal state machine with no filesystem or browser authority.
2. `durable-action-graph-store-v1.mjs`: private JSONL journal with `O_NOFOLLOW`, hardlink rejection, file `fsync`, atomic head receipt and directory `fsync`.

Lifecycle:

`DECLARED -> EFFECT_INTENT_SEALED -> COMMITTED | AMBIGUOUS`

or, only before effect intent:

`DECLARED -> ABORTED`

`AMBIGUOUS`, `COMMITTED`, and `ABORTED` are terminal in R8A. There is no retry transition.

Dependencies reference already-declared actions, making cycles impossible by construction. An effect intent may seal only after every dependency is `COMMITTED`.

## Authority model

The graph stores only bounded identifiers, action kind, exact causal namespace and SHA-256 digests of intent/pre-effect/effect/uncertainty evidence. It does not store action payload, typed text, cookies, credentials, CDP node/session/process ids or browser executable authority.

Every receipt and snapshot has:

- `authority_effect=false`
- `actuation_eligible=false`

A sealed effect intent additionally has `fresh_authority_required=true`.

The durable seal proves only that intent was persisted before a possible physical effect. A later actuator integration must still perform fresh target/document/actionability/lease checks.

## Crash ordering

For each transition:

1. validate transition against current graph;
2. append one JSONL event;
3. `fsync` journal;
4. atomically replace compact head receipt and `fsync` directory;
5. update in-memory state.

If journal `fsync` succeeds but head sealing fails, the live store becomes poisoned and requires reopen. Reopen may advance a stale head only through a complete, hash-valid journal suffix. It never blindly retries a browser effect.

## Rejected shortcuts

- no automatic action retry;
- no `COMMITTED` inference from an old intent seal;
- no action payload persistence;
- no mutable snapshot as authoritative history;
- no Temporal/AWS/Azure runtime dependency in R8A;
- no Browser/CDP actuator integration in the same slice;
- no skill metadata becoming actuation authority;
- no distributed consensus claim.

## New invariants

- `ACTION_GRAPH_IS_APPEND_ONLY`.
- `DEPENDENCIES_REFERENCE_ONLY_PRIOR_ACTIONS`.
- `EFFECT_INTENT_MUST_BE_DURABLE_BEFORE_EFFECT`.
- `AMBIGUOUS_EFFECT_IS_TERMINAL_NO_RETRY`.
- `ABORT_AFTER_EFFECT_INTENT_IS_FORBIDDEN`.
- `DEPENDENCIES_MUST_COMMIT_BEFORE_CHILD_SEAL`.
- `GRAPH_HISTORY_NEVER_GRANTS_ACTUATION_AUTHORITY`.
- `FRESH_AUTHORITY_REQUIRED_AFTER_DURABLE_INTENT_SEAL`.
- `JOURNAL_HASH_CHAIN_DETECTS_MUTATION`.
- `TRUNCATED_JOURNAL_FAILS_CLOSED`.
- `STALE_HEAD_MAY_ADVANCE_ONLY_FROM_VALID_DURABLE_JOURNAL_SUFFIX`.
- `R8A_ADDS_ZERO_EXTERNAL_PACKAGE_DEPENDENCIES`.

## R8A non-claims

- no distributed/multi-host graph durability;
- no actuator integration yet;
- no automatic recovery policy for ambiguous effects;
- no malicious-root filesystem threat protection for the journal directory itself;
- no exactly-once claim for external browser effects;
- no graph compaction/retention policy yet.
