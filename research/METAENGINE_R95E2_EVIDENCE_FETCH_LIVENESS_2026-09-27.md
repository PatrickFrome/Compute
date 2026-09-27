# METAENGINE R95E.2 — evidence fetch liveness and persistent exact selection

Date: 2026-09-27
Base: R95E.1 exact-task stream fence ceb5e415d2291ed427f7dd76d20210221c806c6e

## Critical audit after R95E.1

R95E.1 correctly introduced generation + exact task identity fencing, but two liveness gaps remained:

1. The task-scoped /events request had no timeout. A dead REST path could leave the selected evidence history in an implicit, indefinitely incomplete state.
2. closeTask() cleared the bounded exact stream and invalidated its request even though inspectedTaskId intentionally remained selected. Closing the Task Sheet is a presentation action, not evidence deselection; OBSERVE should keep the same exact selected task and bounded history.

## Research

React documents out-of-order network completion as a race condition and recommends ignoring stale responses. R95E.1 already uses a stronger monotonic request generation plus exact identity fence because this fetch lives in a Zustand action rather than an Effect.

The Web platform exposes AbortSignal.timeout() specifically to bound fetch duration. METAENGINE uses 8 seconds, matching other UI read paths, and treats timeout/network failure as DEGRADED rather than as an empty exact history.

Kubernetes resourceVersion separates identity from state revision so a response can be rejected when a newer revision already exists. METAENGINE's taskStreamRequestSeq + inspectedTaskId + streamTaskId is the analogous local presentation fence.

OpenTelemetry correlates by execution context such as TraceId/SpanId, not temporal proximity. METAENGINE continues to correlate causal event rows only by exact task_id; ambient CI/OTel stay explicitly ambient.

## Implementation

- add streamState = UNBOUND | LOADING | EXACT | DEGRADED;
- add an 8s AbortSignal.timeout() to exact task history fetch;
- accept success/failure state only after the existing generation+identity fence;
- keep live events accumulated during the fetch when exact history arrives;
- keep exact stream, binding and inspected task after Task Sheet close;
- opening another task remains the only normal action that advances the stream generation and replaces exact history;
- no retry loop, polling loop, cache backend, task mutation or authority plane is added.
