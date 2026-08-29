# A2 Browser R8B — Action Graph Actuation Fence — Pre-Implementation Research

Date: 2026-08-29
Parent verified: R8A `c7d8fa332f83310b81098611ff8c6f8664a03122`
Milestone: `R8B_ACTION_GRAPH_ACTUATION_FENCE_V1`

## Problem

R8A proves durable intent/history, but it intentionally does not call a browser actuator. The next correctness gap is the dual boundary between durable state and a physical browser effect.

A remote/local actuator can produce three materially different outcomes after the durable pre-effect seal:

1. the effect definitely occurred;
2. the actuator definitely rejected before any physical effect;
3. the effect may have occurred but confirmation is uncertain.

R8A models (1) as `COMMITTED` and (3) as `AMBIGUOUS`, but lacks an exact terminal state for (2). Treating a known no-effect rejection as ambiguous loses useful liveness; treating it as pre-seal `ABORTED` is historically false because the durable effect intent already exists.

The extension actuator currently performs live semantic/actionability validation immediately before CDP Input dispatch. It can therefore discover a definite rejection after a Node-side durable seal but before any physical input call.

## Primary-source comparison

### Playwright actionability

Playwright performs fresh actionability checks immediately before click, including visibility, stability, event reception and enabled state. It also exposes `trial` semantics that run actionability checks without performing the action. This validates separating *fresh preflight authority/evidence* from historical graph state.

Sources:
- https://playwright.dev/docs/actionability
- https://playwright.dev/docs/api/class-elementhandle

### Chrome DevTools Protocol Input

CDP dispatches mouse input as distinct `mousePressed` and `mouseReleased` messages. A transport/session failure around these calls creates a real ambiguity window: after a dispatch request crosses the boundary, failure to observe the response does not prove no page-visible effect occurred.

Source:
- https://chromedevtools.github.io/devtools-protocol/tot/Input/

### AWS transactional outbox

Transactional outbox solves a database/event dual-write problem by durably recording an event before asynchronous delivery, but AWS explicitly notes duplicate delivery and recommends idempotent consumers. A browser click is not naturally an idempotent consumer operation, so automatic outbox redelivery would violate `NO_BLIND_RETRY_AFTER_AMBIGUOUS_EFFECT`.

Source:
- https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html

### AWS idempotent API/retry guidance

AWS retry guidance makes retries safe by giving the target service an idempotency contract/token. The browser DOM and arbitrary web applications do not provide a general idempotency-token contract for physical clicks or typing. Therefore the A2 fence must be at-most-once by default after seal and never infer retry permission from a timeout.

Sources:
- https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/
- https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_prevent_interaction_failure_idempotent.html

## Architecture options

### A. Transactional outbox with automatic redelivery

SECURITY: poor fit for non-idempotent browser effects.
RELIABILITY: good message delivery, unsafe effect duplication semantics.
TCB/COMPLEXITY: adds dispatcher/retry state.
FAILURE MODE: duplicate click/type after ambiguous acknowledgement.

Decision: reject.

### B. Put durable graph inside MV3 extension

SECURITY: mixes durable state with physical executor.
RELIABILITY: MV3 service workers are not the project's durable brain and can be suspended/restarted.
TCB: duplicates filesystem/store semantics in a constrained runtime.

Decision: reject. Preserve `MV3_IS_EXECUTOR_NOT_DURABLE_BRAIN`.

### C. Node-owned typed transaction fence with injected actuator

SECURITY: durable state and physical authority remain separate. The graph never contains the live authority object or action payload.
RELIABILITY: exact outcome classification and no automatic retry.
TCB: one small dependency-free module over R8A.
TESTABILITY: fake actuator can prove ordering/call cardinality/crash windows before real transport integration.

Decision: choose.

## Decision

Add a Node-only `DurableActionFence` around an injected trusted preflight and actuator.

Order:

1. append `ACTION_DECLARED`;
2. run fresh preflight;
3. if preflight definitely rejects/errors before effect, append `ACTION_ABORTED`; actuator call count remains zero;
4. if ready, append+fsync `EFFECT_INTENT_SEALED` and durable head;
5. invoke actuator exactly once with ephemeral fresh authority and payload/context not persisted in graph;
6. map typed actuator outcome:
   - `COMMITTED` -> `ACTION_COMMITTED`;
   - `NO_EFFECT` -> new terminal `ACTION_NO_EFFECT`;
   - `AMBIGUOUS` -> `ACTION_AMBIGUOUS`;
7. untyped exception or malformed post-seal outcome -> conservative `AMBIGUOUS`;
8. if terminal graph persistence itself fails after actuator invocation, return recovery-required error and never perform a compensating/retry actuator call.

## Why `ACTION_NO_EFFECT` is necessary

`NO_EFFECT` is a terminal historical fact: a durable effect intent existed, the trusted actuator was consulted, and that actuator guarantees no physical effect was attempted/accepted. It is distinct from:

- `ABORTED`: stopped before durable effect intent;
- `AMBIGUOUS`: effect may have occurred;
- `COMMITTED`: effect definitely occurred.

Automatic retry remains forbidden for the same action ID in all terminal states. A future replan may create a **new action node/new intent**, never replay the old one.

R8B upgrades the graph format additively from `1.0.0` to `1.1.0`. Replay accepts legacy R8A `1.0.0` events/heads, preserves their original event hashes, upgrades only the compact head receipt, and writes new events as `1.1.0`.

## Authority model

The fence passes the preflight-produced authority object only in memory to the actuator callback. It never serializes it into the graph.

Graph/fence outputs remain:

- `authority_effect=false`;
- `actuation_eligible=false`;
- `automatic_retry_allowed=false`.

This means even a `COMMITTED` receipt is evidence of past effect, not reusable permission.

## Required verification

- R8A 14-test regression remains green;
- legacy v1.0 journal/head replays and upgrades safely;
- preflight reject -> ABORTED, actuator zero calls;
- durable seal is readable from disk before actuator callback begins;
- COMMITTED / NO_EFFECT / AMBIGUOUS map to distinct terminal graph states;
- untyped throw/malformed outcome -> AMBIGUOUS;
- same action ID concurrency invokes actuator at most once;
- terminal persistence failure after actuator does not call actuator again or write an alternative terminal state;
- ephemeral secret/payload never appears in journal;
- R7M Node/native source-boundary regressions remain green;
- zero new dependency packages;
- deterministic artifact + Sigstore provenance.

## Explicit non-claims

- no real MV3/Chrome actuator transport integration yet;
- no browser-effect exactly-once guarantee;
- no automatic retry/redelivery;
- `NO_EFFECT` is trusted only when produced by the owner-injected typed actuator boundary;
- no distributed writer coordination;
- no graph compaction/retention in this slice.

## Next step if R8B seals

R8C should add a typed extension outcome protocol at exactly one semantic click boundary, preserving the existing live AX/DOM/hit-test checks. Only then can a real Chrome controlled-page action prove `seal -> fresh extension checks -> physical dispatch -> typed terminal outcome` end to end.
