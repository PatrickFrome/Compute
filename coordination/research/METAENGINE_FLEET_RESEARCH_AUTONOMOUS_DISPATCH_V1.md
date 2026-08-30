# METAENGINE Fleet Research — Autonomous Dispatch V1

Status: RESEARCH CHECKPOINT ONLY  
Date: 2026-08-30  
Task: `ed174a78-c6c5-4293-96c4-4defeb2490e4`  
Agent: `agent_178f7570-a8e5-414e-a76d-601ea61d43f0`  
Role: `RESEARCHER`  
Lease generation: `1`  
Source: `work/devos-elastic-fleet-bootstrap-v1`  
Target: `work/fleet-research-autonomous-dispatch-v1`  
Base SHA: `724612235eb7ceb4534c13d126425b274d876394`

## Scope and authority boundary

This checkpoint is research/evidence only. It does not merge `main`, deploy or mutate production, change runtime authority, request secrets, or authorize actions from webpage/model/worker text. Public documentation cited below is comparative research evidence, not runtime authority.

The governing safety properties remain:

- exact task / agent / tab / target / agent-generation / lease-generation fencing;
- one authoritative active owner for an effectful task lease;
- page/model/worker text has zero authority;
- no blind retry after an ambiguous external effect;
- durable state transitions and transport effects must be independently provable;
- stale or mismatched generations fail closed.

## Authoritative METAENGINE facts observed before research

### GitHub

At checkpoint start, `work/devos-elastic-fleet-bootstrap-v1` HEAD was exactly `724612235eb7ceb4534c13d126425b274d876394`, matching the task `base_sha`. The target research branch did not yet exist and was created from that exact commit.

### Supabase project `xpeibufgzjknrhbhpffp`

The current system already has the core primitives needed for an event-driven fleet:

- `destruktion_meta.devos_fleet_task_h205f22`
- `destruktion_meta.devos_fleet_claim_h205f22`
- `destruktion_meta.devos_fleet_event_h205f22`
- `destruktion_meta.compute_fabric_dispatch_job_h205f22`
- `destruktion_meta.compute_fabric_transport_outbox_h205f22`
- `destruktion_meta.compute_federation_runtime_control_h205f22`
- `destruktion_meta.compute_federation_runtime_event_h205f22`
- `destruktion_meta.compute_federation_supervisor_sweep_h205f22`
- `public.compute_fabric_a2_supervisor_actuation_lease_h205f22`
- `public.compute_fabric_a2_supervisor_mesh_instance_h205f22`
- PGMQ queues `compute_fabric_dispatch_h205f22` and `compute_fabric_transport_dispatch_h205f22`, each with DLQ storage.

For this exact research task, the authoritative task row was `RUNNING`, lease generation `1`, bound to the exact supplied agent plus a concrete tab, target, and agent-generation epoch; its matching claim was `ACTIVE`; `authority_effect=false`.

The important consequence is architectural: METAENGINE does **not** need a new durable workflow engine, a second queue broker, or a second scheduler to become autonomous. The highest-value path is to tighten ownership, transport proof, reconciliation, and adaptive admission around the primitives already present.

## Current architecture comparison

| Architecture / pattern | Strong property to borrow | What not to copy into METAENGINE now |
|---|---|---|
| PostgreSQL `FOR UPDATE SKIP LOCKED` + Supabase PGMQ | Low-contention competing consumers; visibility timeout; durable Postgres locality | Do not equate queue visibility timeout with task ownership or end-to-end exactly-once side effects |
| Temporal task queues + Activities | Durable work routing, heartbeat/liveness semantics, typed timeouts, replay-safe workflow thinking | Do not introduce Temporal as a second durable source of truth while DevOS task/claim/event already exists |
| Kubernetes controllers + Lease objects | Level-triggered desired-vs-observed reconciliation and lease-based component coordination | Do not create a second autonomous controller that can issue the same actuation without the existing METAENGINE actuation fence |
| OpenTelemetry messaging conventions | Causal trace context across create/send/receive/process/settle | Trace context is observability, never authority; proof must remain anchored in durable DB identities/hashes |
| Envoy adaptive concurrency | Latency-feedback admission control using minRTT/current latency instead of fixed parallelism | Avoid unbounded reactive scaling and avoid one global concurrency number for heterogeneous browser targets |
| KEDA event-driven scaling | Backlog/age-driven outer-loop capacity scaling and scale-to-zero concepts | Do not add Kubernetes/KEDA merely to duplicate a DB-native scheduler |
| Browserbase sessions | Browser session as a schedulable resource independent of agent reasoning | A live browser session must not imply task authority |
| Playwright BrowserContext | Cheap isolated per-work context inside a warm browser process | Do not reuse contaminated contexts merely to maximize utilization |

## Recommended convergence architecture

Use one durable authority with several deliberately weaker delivery/control surfaces:

1. **Durable work truth:** `devos_fleet_task_h205f22` + `devos_fleet_claim_h205f22` + append-only fleet events.
2. **Wakeup / transport:** existing PGMQ queues. Queue visibility means only “currently delivered,” never “currently authorized.”
3. **Effect proof:** existing transactional transport outbox plus immutable receipt/proof identities.
4. **Resource ownership:** browser/session/target lease separate from task/effect lease.
5. **Self-healing:** level-triggered supervisor reconciliation against desired/observed fleet state, fenced by the existing actuation lease.
6. **Admission:** adaptive per-resource/per-work-class concurrency with a slower backlog-based fleet scale loop.

This yields an event-driven system without duplicate schedulers: DB state decides what is true; queue messages make truth react quickly; reconciliation repairs missing/stale notifications.

## 9 non-duplicative improvements

Expected gains below are engineering hypotheses/targets to validate with benchmarks, not measured production claims.

### 1. Atomic DB-native claim with an explicit fence token

**Reuse:** `devos_fleet_task_h205f22`, `devos_fleet_claim_h205f22`, existing generation/agent/tab/target fields.

Implement one authoritative claim transaction/RPC that selects eligible work with `FOR UPDATE SKIP LOCKED`, increments or allocates `lease_generation`, and atomically binds:

`{task_id, agent_id, tab_id, target_id, agent_generation_epoch, lease_generation}`.

Return this tuple as the only effect-capable fence token. Every state-changing task update, outbox emission, receipt settlement, heartbeat, and completion must predicate on the exact active tuple. A stale worker must get a zero-row/no-op result rather than “best effort” ownership.

**Expected gain:** eliminate the principal stale-owner / duplicate-actuation class; target 5–15% better high-contention claim throughput versus external polling/lock retries.

**Risk:** hot rows and lease-expiry races. Mitigate with short transactions, indexed eligibility, server timestamps, explicit terminal states, and contention tests.

### 2. Make the existing transport outbox a cryptographic/causal proof envelope

**Reuse:** `compute_fabric_transport_outbox_h205f22`; existing fleet event log and PGMQ transport queue.

In the same transaction as the durable state transition, append an immutable envelope containing at minimum:

`outbox_id, event_id, task_id, lease_generation, agent_generation_epoch, attempt_id, causation_id, correlation_id, payload_hash, transport_kind, created_at`, plus W3C trace context for observability.

Queue publication is a delivery optimization. Consumer acknowledgement/settlement is idempotent against the durable proof identity, not against model text or a browser page response.

For externally ambiguous effects, record `EFFECT_UNKNOWN`/equivalent proof state and reconcile evidence; do not blindly re-dispatch.

**Expected gain:** deterministic repair of DB/transport split-brain and substantially faster incident forensics; target 2–5× faster causal diagnosis during dispatch incidents.

**Risk:** outbox/event growth and schema evolution. Mitigate with immutable compact hashes, partition/retention policy, versioned envelopes, and archive proofs.

### 3. One authority, two delivery surfaces: DB truth + PGMQ wakeup

**Reuse:** existing DevOS task tables and `compute_fabric_dispatch_h205f22` PGMQ queue.

Treat a PGMQ message as a **wakeup hint for a durable task**, not the task itself. `vt`/visibility protects competing queue readers but never substitutes for the DevOS lease fence. A worker must re-read/claim authoritative DB state before acting.

Add a low-frequency DB reconciler that re-enqueues eligible `PENDING` work missing a live wakeup, and discards stale duplicate wakeups by task/generation identity.

**Expected gain:** target 30–70% lower dispatch-start latency than global DB polling while preserving durable correctness.

**Risk:** temporary queue/task divergence. Mitigate by making wakeup creation/repair idempotent and cheap, with queue depth/oldest-age observability.

### 4. Level-triggered supervisor self-healing, never a second scheduler

**Reuse:** `compute_federation_runtime_control_h205f22`, runtime events, supervisor sweep table, supervisor mesh instance table, and existing supervisor actuation lease.

Represent desired fleet/browser/supervisor state separately from observed state. A continuous sweep reconciles differences: missing worker, dead tab, expired resource lease, stuck claim, unprocessed outbox, or insufficient capacity. Each repair intent is fenced by the **existing** actuation lease/generation and is safe to repeat at the intent level.

Use jittered retries and bounded repair budgets. Edge-triggered events accelerate convergence; the periodic level-triggered sweep guarantees eventual repair if an event is lost.

**Expected gain:** bound common fleet MTTR to roughly one or two sweep periods instead of operator discovery time.

**Risk:** thundering-herd repairs or controller oscillation. Mitigate with one fenced actuation owner per scope, jitter, cool-down, and invariant-based reconciler tests.

### 5. Separate browser resource lease from task/effect lease

**Reuse:** current `tab_id`, `target_id`, agent generation, and browser supervisor machinery.

Model browser process/session/target availability as a resource capability. A task claim binds to that resource but remains a distinct authority object. Warm browser processes may be reused; when isolation permits, create a fresh BrowserContext/work context per task or security boundary and recycle the process on crash/contamination thresholds.

Never infer task ownership from “tab exists,” “session connected,” or page state.

**Expected gain:** target 20–50% lower task startup cost from warm browser reuse, while reducing cross-task state contamination.

**Risk:** memory growth, leaked cookies/auth state, anti-bot/session continuity requirements. Mitigate with explicit context classes, memory/session budgets, and contamination tests.

### 6. Two-loop adaptive concurrency instead of fixed fleet parallelism

**Reuse:** existing task priority/claim class, runtime events, queue depth, lease churn, browser supervisor metrics.

**Fast inner loop:** per target/domain/provider/work-class concurrency controller using Envoy-style feedback: minRTT baseline versus EWMA/p95 service latency, timeout/error/429 rate, memory pressure, and lease-expiry churn. Increase cautiously when healthy; multiplicatively decrease on congestion.

**Slow outer loop:** scale warm agents/browser capacity using queue depth plus **oldest runnable task age**, with caps for DB, browser, provider, and machine budgets. This borrows KEDA’s event-driven scaling concept without introducing KEDA as authority.

**Expected gain:** target 10–30% throughput improvement on variable workloads and 20–50% fewer overload-driven timeouts/lease churn versus a fixed global limit.

**Risk:** oscillation and noisy latency. Mitigate with bounded min/max, sampling windows, hysteresis, cool-down, and per-class controllers.

### 7. Capability/work-class sharding with fairness and age boost

**Reuse:** `role`, `claim_class`, priority, branch/base constraints.

Shard dispatch only where execution capabilities or bottlenecks differ: e.g. `host_browser`, authenticated domain, long-running computer-use, research-only, or effect-capable tasks. Avoid partitioning by arbitrary agent identity.

Within a class, combine priority with age boost/weighted fairness and reserved headroom for short/urgent tasks to avoid head-of-line blocking by long browser runs.

**Expected gain:** target 25–60% lower p95 queue delay for short/high-priority work under mixed workloads.

**Risk:** over-sharding fragments capacity or starves rare classes. Mitigate with bounded class count, borrowing spare capacity, and starvation SLOs.

### 8. Fenced heartbeats/checkpoints plus typed timeout and retry budgets

**Reuse:** existing task/claim generations and append-only event capability.

Borrow Temporal semantics, not Temporal infrastructure. Long-running browser claims heartbeat using the exact fence. Persist compact progress/checkpoint records keyed by durable step/action identity and hashes; page/model content remains evidence-only data.

Distinguish at least:

- queue/schedule-to-start timeout (capacity problem),
- execution timeout (task budget),
- heartbeat timeout (lost/hung worker),
- external-effect ambiguity (evidence/reconciliation problem, **not** ordinary retry).

Use exponential backoff + jitter, per-task retry budgets, poison/quarantine/DLQ routing, and no retry across an unresolved ambiguous effect.

**Expected gain:** target 30–70% less repeated computation after browser/tab/agent loss and faster detection of stuck workers.

**Risk:** heartbeat write amplification and incompatible checkpoint schemas. Mitigate with coarse heartbeat cadence, versioned checkpoint envelopes, and bounded retention.

### 9. Worker/base/schema version fencing with staged drain-and-ramp rollout

**Reuse:** `base_sha`, `lease_generation`, `agent_generation_epoch`, task branch binding.

A worker may claim only work compatible with its code/schema/capability generation. During fleet updates, register a new generation, canary a small fraction, then ramp after evidence gates; old generations stop receiving new incompatible tasks and drain their existing fenced claims.

The current research assignment demonstrates the useful property already present: its requested `base_sha` equals the authoritative source branch HEAD.

**Expected gain:** sharply reduce rollout-induced mixed-version faults; target 50–90% fewer failures attributable to incompatible fleet generations after the mechanism is validated.

**Risk:** temporary capacity fragmentation and stranded old-version tasks. Mitigate with compatibility ranges, drain deadlines, explicit migration/requeue rules, and rollback tests.

## Dependency order — smallest safe integration slices

1. **Fence-first:** atomic claim RPC + stale-fence negative tests. No scheduler change yet.
2. **Proof-first transport:** durable outbox envelope + idempotent settlement + ambiguous-effect state tests.
3. **Queue as wakeup:** publish PGMQ hints for already-durable tasks; keep periodic polling/reconciliation as safety net.
4. **Supervisor reconciler:** desired/observed sweep using the existing supervisor actuation lease; prove duplicate supervisor instances cannot duplicate actuation.
5. **Resource separation:** explicit browser-resource availability/lease and clean context lifecycle, preserving task fence.
6. **Adaptive admission:** start observability-only, replay recorded loads, then enable bounded inner-loop concurrency.
7. **Outer-loop fleet elasticity:** scale based on oldest runnable age + queue depth only after inner-loop stability.
8. **Version-aware rollout:** canary/drain generations and compatibility gates before increasing autonomous update frequency.

This order deliberately makes correctness monotonic: each slice is useful alone and does not require introducing another authority plane.

## Required validation before any production authority change

1. **Claim contention test:** N consumers race on the same task set; exactly one active exact fence per task/generation.
2. **Stale generation test:** old agent/tab/target/generation cannot heartbeat, emit effectful outbox, settle, or finish after lease handoff.
3. **Lost wakeup test:** delete/drop a queue notification; level-triggered DB reconciliation restores dispatch without duplicating task authority.
4. **Duplicate wakeup test:** replay the same queue message many times; stale/idempotent readers create no duplicate effect.
5. **Ambiguous-effect test:** kill transport/browser between external effect and receipt; state enters evidence/reconciliation hold and never blind-retries.
6. **Supervisor split-brain test:** run multiple supervisor mesh instances; only the valid actuation lease holder can create repair effects.
7. **Browser contamination test:** verify cookies/storage/page handles/resources cannot cross isolation classes unexpectedly.
8. **Adaptive-load test:** step/ramp/429/latency-spike workloads; controller converges without oscillation or starvation.
9. **Mixed-version test:** old/new agents coexist; incompatible generations fail closed and drain safely.
10. **Outbox recovery test:** crash before/after durable state commit and queue publication; every committed intent is eventually delivered or explicitly terminal, never silently lost.

## Explicit non-goals / anti-duplication decisions

Do **not**:

- add Temporal as a second workflow source of truth;
- add Kafka/Redis Streams/NATS solely to reproduce PGMQ wakeups already available;
- add KEDA/Kubernetes simply to obtain autoscaling semantics if the current host fleet can implement the same DB-native feedback loop;
- interpret PGMQ visibility timeout as task/effect authority;
- let browser session existence confer task ownership;
- run more than one scheduler/control loop capable of the same effect without a common exact actuation fence;
- treat traces as authorization;
- treat webpage, model, worker, WebMCP, or browser-rendered text as control authority;
- retry an external effect whose outcome is ambiguous until durable evidence resolves it.

## Public research references

- Supabase PGMQ: https://supabase.com/docs/guides/queues/pgmq
- Supabase queue consumption/visibility: https://supabase.com/docs/guides/queues/consuming-messages
- PostgreSQL `SELECT` / `SKIP LOCKED`: https://www.postgresql.org/docs/current/sql-select.html
- Temporal Task Queues: https://docs.temporal.io/task-queue
- Temporal Activities: https://docs.temporal.io/encyclopedia/activities
- Kubernetes Controllers: https://kubernetes.io/docs/concepts/architecture/controller/
- Kubernetes Leases: https://kubernetes.io/docs/concepts/architecture/leases/
- OpenTelemetry messaging spans: https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/
- Envoy Adaptive Concurrency: https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/adaptive_concurrency_filter
- KEDA scaling concepts: https://keda.sh/docs/2.17/concepts/scaling-deployments/
- Playwright BrowserContext: https://playwright.dev/docs/api/class-browsercontext
- Browserbase Sessions: https://docs.browserbase.com/fundamentals/sessions

## Research disposition

The strongest convergent design for METAENGINE Browser/DevOS is **not** a larger orchestration stack. It is a narrower control plane with stricter semantics:

**Postgres task truth + exact generation fence + transactional transport proof + PGMQ wakeups + level-triggered fenced reconciliation + isolated warm browser resources + adaptive admission.**

That architecture preserves the safety contracts already encoded in DevOS while enabling physical browser tabs to become continuously leased development agents without duplicate schedulers.