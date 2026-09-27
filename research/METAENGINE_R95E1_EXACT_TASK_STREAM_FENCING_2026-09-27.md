# METAENGINE R95E.1 — exact-task fetched event stream fencing

Date: 2026-09-27  
Base: R95E evidence timeline PR #1014 exact head `fddb8ee142308b44fd57a93585a729a981e6e827`  
Scope: read-only evidence identity/freshness. No scheduler, task, Browser, release or production authority.

## Defect found

`openTask(id)` starts an asynchronous `/events?task=<id>` request and previously applied its result unconditionally.

A fast A → B task switch could therefore complete in this order:

1. request A starts;
2. task B becomes the inspected task and request B starts;
3. B resolves;
4. delayed A resolves last and overwrites `stream`.

The UI would then hold B as the selected identity while the fetched event stream belonged to A. The first R95E timeline happened to consume only the bounded global event window, so it avoided displaying the stale stream, but it also could not use deeper exact task history safely.

## Primary-source research

### React — ignore stale network responses
https://react.dev/reference/react/useEffect
https://react.dev/learn/you-might-not-need-an-effect
https://react.dev/learn/synchronizing-with-effects

React's official guidance explicitly describes out-of-order network responses as a race condition and requires stale results to be ignored. R95E.1 uses a stronger store-level generation + exact identity fence because the fetch is issued by a Zustand action rather than a component Effect.

### Kubernetes — resourceVersion
https://kubernetes.io/docs/reference/using-api/api-concepts/

Kubernetes uses resource versions to identify state revisions and express freshness/consistency requirements. Equality of object identity alone is not sufficient after a newer generation exists. R95E.1 mirrors that principle with a monotonically increasing task-stream request generation.

### Temporal — durable execution history
https://docs.temporal.io/

Temporal's execution model is built around durable workflow history so recovery resumes from persisted execution state rather than an unrelated latest response. METAENGINE does not add a second history backend here; it exposes more of the existing exact task event route only after identity fencing.

### OpenTelemetry — causal identity
https://opentelemetry.io/docs/specs/otel/overview/
https://opentelemetry.io/docs/specs/otel/context/

OpenTelemetry correlates causality through propagated context and trace/span identifiers, not temporal proximity. R95E.1 likewise admits fetched events into the selected task timeline only when their explicit `task_id` and stream binding match the selected task.

## Implementation

- add monotonically increasing `taskStreamRequestSeq`;
- bind `stream` to explicit `streamTaskId`;
- each `openTask` gets a new request generation;
- delayed response is applied only when generation, selected task and stream task identity all still match;
- `closeTask` advances the generation and clears the stream binding;
- fetched rows are filtered again by exact `task_id` even though the endpoint is task-scoped;
- live task events that arrived while the fetch was in flight are preserved and win over duplicate fetched sequence numbers;
- OBSERVE merges the bounded global event window with fetched history only through the shared exact-task contract;
- event sequences are deduplicated and the displayed timeline remains bounded.

## Acceptance

This branch is not a proof point until its exact head passes the full Browser qualification matrix. The parent R95E #1014 must also remain independently terminal-green; this successor cannot retroactively qualify its parent.
