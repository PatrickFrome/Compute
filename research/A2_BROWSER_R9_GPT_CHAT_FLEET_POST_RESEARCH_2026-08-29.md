# A2 Browser R9 — GPT Chat Fleet — Post-Implementation Research

Date: 2026-08-29
Parent authoritative milestone: R8D `4d6d6afe7b97e1972cb01aed1ab24054bd761cce`
Green candidate: `c6ba73aeb5ea39e6a3fce8ab2cc1595494238234`
Workflow: `33237135924` SUCCESS
Artifact: `9710246433`
Artifact digest: `sha256:66f7b835bf01bcee5bca446afaa88cb63e7a5d530bab16176f10731c8bbf0702`

## Implemented result

R9 provides a provider-neutral, browser-authority-free fleet substrate outside MV3:

- stable logical `agent_id` registry;
- explicit lifecycle state machine;
- manager-owned assignment;
- one active assignment per agent;
- rollover that preserves `agent_id` while advancing conversation/generation epochs;
- LOST/rollover invalidation with `automatic_retry_allowed=false`;
- append-only digest-only evidence blackboard;
- deterministic SIMPLE/MEDIUM/HARD/CRITICAL spawn planning;
- reuse of compatible READY workers before spawn requests;
- no direct peer messaging primitive;
- no network, model, browser or process side effects in fleet core.

## Post-implementation research

### Manager vs handoff

Current OpenAI Agents SDK documentation continues to distinguish manager orchestration from handoffs. A manager keeps control and provides a central point for guardrails/rate limits, while handoffs transfer active ownership. The implemented R9 manager-owned assignment model matches the first pattern and deliberately does not allow a worker to inherit user/browser authority by assignment.

### Actor failure and ordering

Ray documents at-most-once actor tasks by default and warns that concurrent/async actors can execute out of order. This reinforces two R9 decisions:

1. one active assignment per logical agent;
2. assignment validity is bound to a monotonic generation epoch rather than assumed runtime ordering.

A LOST worker invalidates active work and returns an explicit non-retry receipt. Any reschedule must be a new manager decision.

### Graceful draining

The first implementation review found a lifecycle edge: a BUSY agent could enter `DRAINING`, but completion initially accepted only `BUSY`. This would strand legitimate in-flight cognitive work. The state machine was corrected so a DRAINING agent may finish its existing assignment, but completion must remain DRAINING; it cannot silently return itself to READY. Retirement is then explicit.

### Immutable planning output

The first R9 CI failure was test-only: the test attempted `.sort()` on a deliberately frozen scheduler result. All product lifecycle, blackboard and other scheduler tests passed. The test was corrected to sort a copy; immutable public planning outputs were retained.

## Architecture outcome

R9 does not multiply chat tabs automatically. `planAgentFleet()` only emits bounded spawn requests. A later runtime may satisfy those requests through local/remote agents, but that mechanism cannot be mistaken for the scheduler itself.

The evidence blackboard intentionally stores digests and references, not raw response bodies. R10 may retrieve role-relevant source material separately; R12 will formalize taint propagation. This prevents R9 from becoming an accidental unbounded conversation-history database.

## Confirmed invariants

- `MANAGER_OWNS_ASSIGNMENT`.
- `ONE_AGENT_ONE_ACTIVE_ASSIGNMENT`.
- `AGENT_ASSIGNMENT_IS_BOUND_TO_GENERATION_EPOCH`.
- `LOST_WORK_IS_NOT_AUTOMATICALLY_REPLAYED`.
- `ROLLOVER_PRESERVES_AGENT_ID_AND_INVALIDATES_OLD_ASSIGNMENT_EPOCH`.
- `DRAINING_WORK_MAY_FINISH_BUT_MAY_NOT_SELF_RETURN_TO_READY`.
- `WORKERS_SHARE_EVIDENCE_NOT_DIRECT_MESSAGES`.
- `BLACKBOARD_STORES_DIGESTS_NOT_RESPONSE_BODIES`.
- `SCHEDULER_OUTPUT_IS_IMMUTABLE_AND_SIDE_EFFECT_FREE`.
- `FLEET_CORE_HAS_ZERO_BROWSER_AUTHORITY`.
- `PROVIDER_LABELS_ARE_OPAQUE_POLICY_METADATA`.

## R10 handoff

R10 should compile role-specific context from explicit typed sources rather than replaying full chat history. Session storage and LLM-visible context must remain separate concepts. Compaction must generate a new capsule/summary object without rewriting or deleting authoritative source evidence.
