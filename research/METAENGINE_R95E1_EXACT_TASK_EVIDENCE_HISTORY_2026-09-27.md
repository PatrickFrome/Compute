# METAENGINE R95E.1 — exact task evidence history

Date: 2026-09-27  
Base: R95E evidence timeline `fddb8ee142308b44fd57a93585a729a981e6e827`  
Scope: read-only evidence completeness and identity fencing.

## Critical audit finding

The first evidence timeline correctly refused heuristic causal joins, but its EVENT rows came only from the global in-memory recent-event ring. That ring is intentionally bounded across all tasks. A selected task with older evidence could therefore appear to have a sparse or empty history even though the daemon already exposes a task-scoped bounded event route.

A second risk is stale asynchronous readback: switching inspected tasks while a task-history request is in flight must never let the older response populate the newer task's evidence surface.

## Research

### Temporal Event History
https://docs.temporal.io/workflow-execution/event

Temporal treats a workflow's Event History as the durable ordered record used both for recovery and debugging. The important lesson is identity: history belongs to one exact execution, not to whichever global events happen to still be in a recent ring.

### Browserbase Observability
https://www.browserbase.com/observability

Browserbase groups replay, logs, network and console around one browser session so operators debug the exact run rather than reconstructing causality from unrelated recent logs.

### OpenTelemetry log correlation
https://opentelemetry.io/docs/specs/otel/logs/

OpenTelemetry explicitly warns that time/origin-only correlation is fragile. Robust correlation uses execution context identifiers such as TraceId/SpanId. METAENGINE applies the same principle with exact `task_id`: ambient CI/OTel remain ambient until a persisted binding exists.

### Cursor artifacts/worktrees
https://cursor.com/docs/cloud-agent/capabilities
https://prod.cursor.com/docs/configuration/worktrees

Cursor attaches screenshots/videos/log references to the concrete agent task/PR and isolates parallel tasks in worktrees. The transferable idea is not a new artifact backend, but keeping proof attached to the exact work identity.

## Implementation

- one bounded task-scoped read: `/events?task=<exact>&limit=200`;
- 8s timeout, no polling loop;
- request generation + current `inspectedTaskId` fence before accepting the response;
- response is re-filtered by exact `task_id` even though the route is task-scoped;
- exact historical rows are deduplicated by event sequence with recent live rows;
- merged event input remains bounded to 80 before the existing 48-row final timeline cap;
- read failure is surfaced as `DEGRADED`; it does not manufacture missing evidence or widen causality;
- no command, scheduler, Browser, DB, update or release authority is added.
