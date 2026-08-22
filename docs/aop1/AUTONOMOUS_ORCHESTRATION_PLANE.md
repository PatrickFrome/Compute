# METAENGINE H205F22 — AOP1 Autonomous Orchestration Plane

## Invariant

`NO_MANUAL_HANDOFF_V1`

A chat/session is not a persistence boundary. A model invocation is an execution slot. All continuation state is reconstructed from authoritative external state.

## Authority

Supabase remains the only roadmap/claim/directive/checkpoint authority. GitHub is code/evidence storage. Cloudflare is orchestration transport and durable execution. AOP rows are `canonical=false`; orchestration does not itself make semantic truth canonical.

## Roles

- W1_IMPLEMENTER
- T0_IMPLEMENTER
- F1_IMPLEMENTER
- R1_IMPLEMENTER
- A1_IMPLEMENTER
- INTEGRATION_ANALYST
- MAINLINE_SUPERVISOR

## Machine state transition

```text
IN_PROGRESS + aop1 claim -> IMPLEMENTER
IMPLEMENTER EVIDENCE_READY -> authoritative claim finish -> ANALYST
ANALYST any verdict -> SUPERVISOR
SUPERVISOR RETURN -> explicit authority bridge -> new aop1 claim -> IMPLEMENTER
SUPERVISOR ACCEPT -> supervisor seal/review continuation
authoritative VERIFIED -> AOP observes VERIFIED -> reconcile dependencies
blocked/executor unavailable -> WAITING_EVENT -> exact condition signal -> resume
```

`REQUEST_CHANGES`, `HOLD`, and `REJECT` never jump directly from Analyst to Implementer. This preserves Supervisor authority.

## Fencing

Every run is bound to role, milestone, claim id, directive id, semantic checkpoint/root, optional GitHub SHA, lease owner, and monotonically increasing lease generation.

An implementer run can be leased only when its ACTIVE claim holder is exactly `aop1:<ROLE_KEY>`. Legacy chat-holder claims are fenced and routed to Supervisor for explicit adoption.

## Evidence rules

Implementer `EVIDENCE_READY` is accepted only with object fields `summary`, `evidence`, and `research`. The AOP RPC then calls the existing authoritative claim-finish function. An auxiliary AOP string can therefore never masquerade as roadmap `EVIDENCE_READY`.

## Append-only audit

AOP event rows are immutable. Terminal run rows are immutable. Payloads and outputs receive SHA-256 digests. Duplicate event/run idempotency is insert-or-read and never mutates an existing row, which is required for at-least-once delivery.

## Cloudflare design

- one SQLite Durable Object per roadmap for wake de-duplication and serialization;
- Cloudflare Queue for at-least-once wake delivery plus DLQ;
- Cloudflare Workflow for durable lease/execute/complete steps;
- periodic reconciliation cron as the safe path if a webhook/wake is lost;
- GitHub webhook as fast path;
- Cloudflare AI Responses adapter for role execution;
- strict tool allowlist; no arbitrary SQL; no main write; no seal/merge tool in AOP1 v1.

## Current evidence boundary

Supabase AOP control plane is implemented. Rollback-only adversarial self-tests cover lease, lease-generation fencing, Analyst→Supervisor routing, terminal-run immutability, append-only events, duplicate event delivery, and duplicate terminal-run enqueue. ACL checks deny AOP RPCs to anon/authenticated and allow service_role. Performance-advisor FK findings were remediated with covering indexes.

Cloudflare runtime in this branch is implementation code, not a LIVE deployment claim until real account bindings/secrets and an end-to-end execution prove it.