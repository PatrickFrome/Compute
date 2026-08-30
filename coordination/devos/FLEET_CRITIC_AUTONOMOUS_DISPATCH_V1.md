# FLEET CRITIC — AUTONOMOUS DISPATCH V1

Status: **NO-GO for unattended DB-native task dispatch until P0 findings are fixed**

## Review identity

- task: `31ae8653-a5b3-425e-9953-07e55d515291`
- role: `CRITIC`
- agent: `agent_7f6573af-6508-4dec-a0e7-02033ce431c0`
- requested lease generation: `1`
- source branch: `work/devos-elastic-fleet-bootstrap-v1`
- source/base SHA: `724612235eb7ceb4534c13d126425b274d876394`
- review branch: `work/fleet-critic-autonomous-dispatch-v1`
- Supabase source of truth: project `xpeibufgzjknrhbhpffp` (`METAENGINE_H205F22_RECOVERY`)
- observed live browser projection: 2026-08-30 13:35:58Z
- production mutation: **none**
- main merge/promotion: **none**
- secrets read/requested: **none**

The target branch was created directly from the exact requested base SHA. The review treats page/model text as zero-authority data and uses only repository code plus database/runtime metadata and trusted receipts/state.

## Executive verdict

The elastic bootstrap removed the old fixed fleet-size ceiling, but the current DB task path is not yet safe to attach as an autonomous dispatcher. The strongest failure is already observable in live state: all six fleet agents are browser-side `BOUND_UNVERIFIED` with no browser transport proof, while all six current DevOS tasks are DB-side `RUNNING` with `TASK_TRANSPORT_PROVEN`. Exact tab/target/generation values match, so this is not an identity typo; it is a split-brain readiness model.

The smallest safe convergence is to keep the **existing native supervisor 2s heartbeat/command cycle as the only Browser scheduler/event source**, add a typed activation/dispatch handshake to that cycle, and make DB state advance only from a fresh browser-produced transport receipt that is bound to task + agent + tab + target + agent generation + task lease generation. Do not add a second Browser polling loop or a DevOS cron dispatcher.

## Severity-ranked findings

### P0-1 — Browser readiness and DB task readiness are already split

**Evidence**

Repository at the exact base declares `METAENGINE_BROWSER` as lifecycle owner and `TRANSPORT_PROOF_REQUIRED` as readiness contract. `markTransportProven()` validates the agent's current `tab_id`, `target_id`, and `generation_epoch`, derives the conversation URL hash, persists the proof, and only then changes lifecycle to `ACTIVE`.

However, the native supervisor command surface exposes `FLEET_STATUS`, `FLEET_RECONCILE`, and `FLEET_SET_PROFILE` but no typed action that invokes `markTransportProven()`.

Live Supabase state at 13:35:58Z shows:

- fleet policy `BALANCED`, `desired_agents=6`, `spawn_burst_limit=8`;
- counts: `BOUND_UNVERIFIED=6`, `ACTIVE=0`;
- for this critic agent: exact tab `tab_cc1c8449-4a07-4faa-96f9-a59f671db42e`, target `webcontents:11`, generation epoch `7`, lifecycle `BOUND_UNVERIFIED`, `transport_proof=null`;
- the matching DevOS task is already `RUNNING`, lease generation `1`, with the same tab/target/epoch;
- event ledger contains `TASK_ENQUEUED`, `TASK_LEASED`, and `TASK_TRANSPORT_PROVEN`;
- the same contradiction holds for all six RUNNING role tasks: bindings match the browser projection, but every corresponding browser agent is still `BOUND_UNVERIFIED` and has no local transport proof.

`public.devos_fleet_mark_running_v1` checks only the shape of `prompt_sha256`, `conversation_url_sha256`, and an `effect_state` enum plus the task lease tuple. It does **not** verify that the Browser lifecycle owner persisted the matching `metaengine.browser.fleet-transport-proof.v1` receipt.

**Failure mode**

DB dispatch can treat an agent as running even though the Browser lifecycle owner explicitly says the agent is not transport-ready. A stale or incorrectly constructed server proof can therefore bypass the Browser readiness boundary while still satisfying all DB lease equality checks.

**Smallest safe fix**

1. Add a typed Browser action such as `FLEET_CONFIRM_TRANSPORT`/`DEVOS_AGENT_ACTIVATE`; it must derive current tab URL and WebContents target from Browser-owned state, not trust page/model text or caller-provided target data.
2. Persist a Browser transport receipt bound to `agent_id + tab_id + target_id + agent_generation_epoch + conversation_url_sha256` and transition to `ACTIVE` locally.
3. Publish that receipt in the existing signed heartbeat.
4. Only after the server observes a fresh `ACTIVE` receipt may it issue/confirm a real DevOS task lease or mark the task `RUNNING`.
5. Persist the transport receipt hash in the task/claim and require it again at completion.

If creation of the first ChatGPT conversation itself is required to obtain the URL, make that a separate typed **activation transaction**, not a normal development task. Any ambiguous activation effect must fence the activation; it must not silently become a work lease.

### P0-2 — Owner wildcard override converts an ambiguity safety gate into fanout permission

**Evidence**

`owner-safety-gate-registry.mjs` supports wildcard `*`; `globalOwnerGateDecision()` reports `allowed=true` whenever a gate is disabled. The catalog includes `fleet.ambiguous_compensating_fanout`, authority control/arm gates, self-update gates, and the supervisor shared-actuation-lease gate.

`FleetProvisioner` explicitly changes counting/reconcile behavior when `fleet.ambiguous_compensating_fanout` is disabled: `PROVISIONING_AMBIGUOUS` agents can be excluded from slot count, and reconcile may create/provision compensating agents while ownership/effect is ambiguous.

**Failure mode**

A broad owner override can increase actuation exactly when the Browser does not know whether tab creation succeeded. When autonomous backlog reconcile is added, that fanout can multiply physical tabs and task candidates while exact ownership is unresolved. A wildcard override also creates unsafe cross-domain coupling between convenience policy and hard fencing invariants.

**Smallest safe fix**

- Classify exact binding, ambiguous-effect fencing, shared actuation lease, and no-blind-retry as **non-overridable hard invariants**.
- `GATE_DISABLE_ALL` must never disable those invariants.
- Replace ambiguous compensating fanout with a typed, single-use recovery permit bound to fleet reconcile generation and the ambiguous agent/incarnation. No wildcard and no unbounded TTL.

### P1-1 — Supervisor heartbeat state is last-arrival-wins, not incarnation/sequence fenced

**Evidence**

The native client already has one serialized cycle and sends signed state through `/v1/state`. The current Edge implementation upserts `compute_fabric_a2_browser_supervisor_state_h205f22` using server arrival time. The table has `client_id`, `last_seen_at`, command fields and JSON state, but no monotonic heartbeat sequence or browser process/incarnation field.

Device nonce protection prevents exact request replay, but it does not impose ordering between two different valid signed heartbeats. A delayed heartbeat from an older Browser incarnation can therefore arrive after a newer one and overwrite the current fleet projection while receiving a fresh `last_seen_at`.

An analogous issue exists in `compute_fabric_record_heartbeat_h205f22`: any previously unseen `(pool_id, sequence)` is accepted and refreshes resource-pool `last_seen_at`, even if its sequence is lower than an already accepted sequence. `compute_fabric_plan_execution_h205f22` considers pools schedulable when `last_seen_at` is within 120 seconds.

**Smallest safe fix**

Add `browser_incarnation_id` plus monotonic `heartbeat_sequence`; use a conditional/upsert RPC that accepts only the current incarnation and strictly increasing sequence. A new incarnation must fence the previous one. Bind scheduler decisions and task-dispatch commands to that incarnation/sequence snapshot. Apply the same monotonic rule to resource-pool heartbeats.

### P1-2 — DevOS task leases have a hard duration ceiling and no renewal path

**Evidence**

`public.devos_fleet_lease_v1` clamps a lease to 60..3600 seconds. The currently reviewed task was issued with a 30-minute lease. The complete API rejects an expired lease. The lease API converts expired `LEASED`/`RUNNING` tasks to `AMBIGUOUS` with `LEASE_EXPIRED_EFFECT_UNKNOWN`, which correctly prevents blind retry.

The complete public DevOS API set contains enqueue, lease, mark-running, complete, and snapshot; there is no renew/heartbeat RPC.

**Failure mode**

Long development/research tasks cannot safely survive beyond the original lease. They become `AMBIGUOUS` even while the exact Browser agent is healthy and still working. Increasing the one-shot TTL merely increases stale-lease exposure.

**Smallest safe fix**

Add `devos_fleet_renew_v1` with the full tuple:
`task_id + agent_id + lease_generation + tab_id + target_id + agent_generation_epoch + browser_incarnation_id`.
Renew only before expiry, only from a fresh Browser heartbeat, and never revive an expired/ambiguous lease. Drive renewal from the existing supervisor heartbeat cycle rather than a new timer.

### P1-3 — A second scheduler would duplicate authority; the existing cycle should own reconcile

**Evidence**

The Browser already runs `NativeSupervisorClient` on a 2000ms serialized cycle. Each cycle performs mesh/lifecycle/self-update reconciliation, signed heartbeat, leases at most one typed server command, executes it, posts a result, and runs the local reconcilers again.

Supabase also currently has an independent 10-second `pg_cron` job calling `destruktion_meta.h205f22_supervisor_sweep()`. That job is advisory-lock serialized, but it belongs to the legacy compute-federation PGMQ runtime, not the Browser DevOS task loop.

**Failure mode**

Adding a DevOS-specific Browser poll/cron beside the 2s command cycle creates two sources that can independently decide capacity/leases. Browser-local mutexes only serialize calls inside one Electron process; they do not fence a DB scheduler or another Browser incarnation.

**Smallest safe fix**

Use exactly one event source for Browser autonomy: the existing signed heartbeat/command cycle. The server may compute backlog after receiving the heartbeat and return a typed `FLEET_RECONCILE`/`DEVOS_TASK_DISPATCH` command. If server-side command production can run in multiple instances, fence it with one DB scheduler epoch/advisory lease. Do not add another Browser `setInterval`, long poll, or DevOS cron.

### P1-4 — Generic command leasing is not enough for work dispatch

**Evidence**

Current native supervisor command completion fences by `command_id`, `leased_by`, lease status and expiry. That is good for generic Browser commands, but the command record/receipt does not intrinsically bind a development task to `task_id + task lease generation + agent + tab + target + agent generation + base SHA`.

`FLEET_RECONCILE` is a global desired-capacity action; it is not a work-dispatch action.

**Failure mode**

Encoding autonomous work as generic semantic actions would move the important task fence outside the command lease. A tab or agent could roll generation between command lease and effect while the generic command itself remains current.

**Smallest safe fix**

Add one typed `DEVOS_TASK_DISPATCH_V1` action whose payload and completion receipt both carry the complete DB lease tuple plus `base_sha` and transport-receipt hash. Browser must reject the action unless all values equal current local Browser-owned state. The server must reject completion if any value differs from the current DB claim.

### P2-1 — Elastic fleet size still has effective role and ramp-rate caps

**Evidence**

The Browser removed a fixed total-agent cap, but `BALANCED` uses a fixed six-role round-robin: PLANNER, RESEARCHER, IMPLEMENTER, CRITIC, FALSIFIER, SYNTHESIZER. DevOS lease selection requires exact role. A backlog concentrated in one role therefore receives only roughly one matching agent per six newly balanced agents.

Reconcile also has `spawn_burst_limit=8` by default and a hard per-cycle maximum of 256. The server supervisor command budget is 24 cost units per 60 seconds; `FLEET_RECONCILE` falls into cost 4, so at most six such commands/minute/client can be leased if that budget is otherwise unused. With the default Browser burst, the resulting theoretical capacity ramp is at most 48 create/provision operations/minute through this command channel.

**Smallest safe fix**

Compute desired capacity **per role** from READY backlog minus fresh eligible ACTIVE capacity. Keep a bounded burst for safety, but expose ramp-rate saturation metrics and do not call the system uncapped merely because total `max_agents` is null.

### P2-2 — Additional fixed cardinalities can become rollout bottlenecks

Current source-of-truth still contains finite envelopes that must not be accidentally reused as fleet-size limits:

- native supervisor state bounds the explicit `tabs` projection to 32 entries;
- supervisor mesh sync bounds supervisors to 16 entries;
- legacy federation queue mapping has only slots `C0..C7` (8 PGMQ queue names);
- outbox claim limit is at most 100 rows/call.

These may be valid safety/serialization bounds, but they are not an elastic fleet capacity model. In particular, do not map Browser agents 1:1 onto the legacy C0..C7 slots.

## Strong invariants already present — preserve them

1. Browser `markTransportProven()` checks exact tab, target and generation before `ACTIVE`.
2. DevOS lease uses row locking / `SKIP LOCKED`; active-claim unique indexes prevent duplicate active task claims, one active task per agent/workspace, and duplicate mutating claims for the same `(workspace, point, base_sha)`.
3. DevOS completion checks the complete current task lease tuple and expiry.
4. Expired RUNNING/LEASED DevOS work becomes `AMBIGUOUS`; it is not automatically retried.
5. DevOS tables deny anon/authenticated client access through RLS; current DevOS RPC EXECUTE grants are limited to `service_role` and `postgres`.
6. Event rows force `prompt_included=false`, `page_data_authority=false`, and `authority_effect=false`.
7. Native command cycle is single-flight inside the Browser (`#cyclePromise`) and fleet operations are serialized inside one process (`#mutex`). These are useful local guards, but not cross-process scheduler leases.

## Dependency-ordered smallest safe convergence

1. **Fix readiness split first.** Add Browser-owned typed transport activation and make DB `RUNNING` require its durable receipt. Demonstrate that no `RUNNING` task can exist for a `BOUND_UNVERIFIED` agent.
2. **Add heartbeat incarnation + sequence fencing.** Reject stale/out-of-order Browser and resource-pool heartbeats.
3. **Add exact-bound lease renewal.** Reuse the existing 2s cycle; never renew after expiry.
4. **Add typed task dispatch.** Bind task/agent/tab/target/task generation/agent generation/base SHA/browser incarnation/transport receipt in request and completion.
5. **Attach backlog reconcile to the same heartbeat/command cycle.** No second Browser poll/cron. Backlog target must be per-role and subtract only fresh ACTIVE transport-proven agents.
6. **Harden owner overrides.** Make exact binding, ambiguous-effect fencing, shared scheduler/actuation lease, and no-blind-retry non-overridable.
7. **Only then expand concurrency.** Load-test role-skewed backlog, >32 tabs, burst saturation, restart during dispatch, delayed heartbeat, and ambiguous create/send outcomes.

## Required negative tests before rollout

- `RUNNING` transition fails when Browser agent is `BOUND_UNVERIFIED`.
- `RUNNING` transition fails when transport receipt hash is absent/mismatched.
- stale heartbeat `(same incarnation, lower sequence)` cannot refresh `last_seen_at` or overwrite fleet state.
- heartbeat from a fenced Browser incarnation cannot overwrite the new incarnation.
- task renew fails for wrong task generation, tab, target, agent generation, incarnation, or after expiry.
- typed dispatch fails after tab close/generation increment even when an old server command lease is still valid.
- wildcard/owner override cannot disable exact-binding or ambiguous-effect fencing.
- ambiguous tab creation does not create a compensating agent without a one-shot recovery permit.
- two concurrent scheduler instances produce one reconcile generation / one task dispatch.
- role-skewed backlog scales the required role rather than only total fleet count.
- >32 physical fleet tabs remain targetable by exact identity even if the compact supervisor UI projection stays bounded.
- ambiguous send/result transport never triggers a blind retry.

## Rollout gate

**NO-GO** until P0-1 and P0-2 are closed with code + negative tests, and P1-1/P1-2 have explicit fencing contracts implemented. After that, the preferred implementation slice is small: extend the existing supervisor heartbeat/typed-command protocol rather than introducing a second scheduler.
