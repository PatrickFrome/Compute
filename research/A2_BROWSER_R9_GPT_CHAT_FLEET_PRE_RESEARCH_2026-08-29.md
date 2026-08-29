# A2 Browser R9 — GPT Chat Fleet — Pre-Implementation Research

Date: 2026-08-29
Parent authoritative milestone: R8D `4d6d6afe7b97e1972cb01aed1ab24054bd761cce`
Roadmap milestone: `R9_GPT_CHAT_FLEET_V1`

## Goal

Implement the cognitive fleet substrate defined by the authoritative V1 architecture without multiplying browser authority or turning chats into an O(N^2) peer mesh.

R9 owns:
- stable agent identity and lifecycle;
- manager-owned work assignment;
- rollover preserving `agent_id` while changing browser target/conversation epoch;
- deterministic adaptive spawn planning;
- shared append-only evidence blackboard.

R9 does NOT own browser actuation, context compilation, swarm voting, formal taint propagation, trace replay, remote browser allocation, or model routing. Those remain R8/R10/R11/R12/R13/R15/R16 boundaries.

## Research findings

### Manager-owned orchestration

Current OpenAI Agents SDK documentation distinguishes a manager pattern from handoffs. In the manager pattern, a central agent retains control and invokes specialists for bounded subtasks; this provides one place to enforce guardrails and rate limits. Handoffs transfer active ownership to a specialist.

A2 should use the manager pattern for R9 because browser authority, budgets, evidence collection, lifecycle and final synthesis must remain centrally governable. Workers therefore never acquire browser authority merely by being registered or assigned work.

### Failure and retry semantics

Ray actors default to zero automatic restarts and actor tasks default to at-most-once semantics. At-least-once retry is appropriate only when replay is safe. A2 must remain stricter for consequential work: a LOST worker or transport ambiguity never causes automatic replay of an assignment. The manager may issue a new assignment explicitly after reconciliation.

### MV3 lifecycle

Chrome MV3 remains an event-driven executor surface. Long-lived fleet scheduling and blackboard state must not depend on a service worker remaining alive. R9 core is therefore browser-agnostic and lives in `coordination/browser-shared`.

## Architecture decision

```text
GLOBAL MANAGER
   |
   +-> Fleet Registry / lifecycle
   +-> Deterministic Spawn Planner
   +-> Work Assignment
   +-> Evidence Blackboard
            ^
            |
      specialist workers
```

No worker-to-worker messaging primitive is introduced. Cross-agent collaboration occurs only through evidence references on the blackboard and later R11 critique/jury policy.

## Stable identity model

`agent_id` is the durable logical identity. Browser identity is subordinate:

```text
agent_id
  -> provider policy label
  -> surface
  -> target_id (nullable)
  -> conversation_epoch
```

Rollover preserves `agent_id`, changes `target_id` and/or increments `conversation_epoch`, and invalidates any active assignment epoch.

## Lifecycle

States:
- `REGISTERED`
- `READY`
- `BUSY`
- `DRAINING`
- `LOST`
- `RETIRED`

Core transitions are explicit and fail closed. There is at most one active assignment per agent. `LOST` does not replay work. Rollover is an explicit event rather than a permanent lifecycle state.

## Evidence blackboard

The blackboard stores metadata and content digests, not sensitive response bodies. Evidence items are append-only and immutable by `evidence_id`.

Minimum shape:
- `evidence_id`
- `point_id`
- `author_agent_id`
- `kind`
- `content_digest`
- bounded evidence references
- `tainted` metadata flag
- `created_at`

Formal information-flow propagation is intentionally deferred to R12.

## Adaptive spawn policy

Deterministic templates implement the authoritative roadmap:
- SIMPLE: one generic worker;
- MEDIUM: three workers plus an integrator;
- HARD: six to twelve specialists, bounded by `max_workers`;
- CRITICAL: blind proposal ensemble plus falsifier, security reviewer and evidence jury/integrator.

The planner emits spawn requests only. It does not open tabs, invoke models, call providers or create browser authority.

## Security invariants

- `MANAGER_OWNS_ASSIGNMENT`.
- `ONE_AGENT_ONE_ACTIVE_ASSIGNMENT`.
- `LOST_WORK_IS_NOT_AUTOMATICALLY_REPLAYED`.
- `ROLLOVER_PRESERVES_AGENT_ID_AND_INVALIDATES_OLD_ASSIGNMENT_EPOCH`.
- `WORKERS_SHARE_EVIDENCE_NOT_DIRECT_MESSAGES`.
- `FLEET_CORE_HAS_ZERO_BROWSER_AUTHORITY`.
- `PROVIDER_LABELS_ARE_OPAQUE_POLICY_METADATA`.
- `BLACKBOARD_STORES_DIGESTS_NOT_RESPONSE_BODIES`.
- `SPAWN_PLANNER_HAS_NO_NETWORK_OR_MODEL_SIDE_EFFECT`.

## Implementation slices

1. `agent-fleet-core-v1.mjs` — registry/lifecycle/manager assignments/rollover.
2. `evidence-blackboard-v1.mjs` — append-only evidence metadata.
3. `agent-fleet-scheduler-v1.mjs` — deterministic adaptive spawn plans.
4. adversarial/unit tests and exact-parent CI/provenance.
5. post-implementation research and authoritative checkpoint.
