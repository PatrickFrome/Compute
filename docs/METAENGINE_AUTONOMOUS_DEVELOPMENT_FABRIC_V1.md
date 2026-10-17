# ADR — METAENGINE Autonomous Development Fabric V1

Status: **ACCEPTED ARCHITECTURE / FIRST SOURCE SLICE IN PROGRESS / INSTALLED-LIVE NOT QUALIFIED**
Date: 2026-10-17
Source base at adoption: `2a6ec0e83053fc860789775ec8d52464c1d686ca`
Implementation worktree: `work/autonomous-development-fabric-v1-20261017`
Binding roadmap: `coordination/operator-control/ROADMAP_UNIFIED_COMMAND_CONTINUITY_V1.md`
Canonical Level-1 milestones: `docs/CANONICAL_ROADMAP.md` (R1, C1, C2 and later).
This is an **architecture decision record, not another roadmap, scheduler, or execution authority**.

## Decision / objective

Preserve the existing Node/Electron/Host/Guardian/own PostgreSQL 17 and typed
Supervisor/leased effect path. Reorient development toward a **continuous
verified coding loop**. Success is a native, authenticated
Goal -> ADMITTED task -> leased session -> isolated Git edit -> physical tests ->
independent CRITIC -> durable W39 checkpoint -> next task after restart.
Independent readback on one installed source identity is required. Static contracts,
agent tab count, source tests, draft PRs or generated fixture rows do not satisfy it.

The system must be able to maintain an open-ended, durable graph of logical tasks
and logical agents, with recursive delegation, causal messages, independent checks
and shared verified memory, even when physical agents, chats, UI windows or Hosts
are offline. There is **no global agent/task/depth ceiling**. Owner-set policies
remain binding. Every backend has finite, separately accounted CPU/RAM/browser
tabs/model concurrency/quota; logical backlog never silently becomes a tab count.
The external DevFleet ten-slot wave is not a METAENGINE capacity policy.

## Non-negotiable execution/trust structure

```text
Owner / operator / ephemeral GPT conversations
    -> existing typed signed Operator Gateway (intent/status only)
    -> Durable Project Kernel (own-PG17 task graph + leases + events + receipts)
       <-> Logical Agent Registry / causal project-bound mailboxes [staged]
    -> EXISTING single Supervisor / native task cycle / resource broker
    -> physical backend adapters (BrowserCell, approved provider session,
       managed Git worktree & constrained sandbox)
    -> independent Critic/verifier -> durable evidence/checkpoint
    -> gated self-improvement experiments -> separately qualified release
Host/Guardian hold OS/process/source/credential/backup custody throughout.
UI/Observatory read the same event cursor; UI closure grants no authority.
```

1. **One source of task/effect truth:** own operated PostgreSQL 17 owns task
   dependencies, admission, lease generations, durable logical identities,
   checkpoint, event sequence and completion. Existing local SQLite journals may
   retain private local write-ahead *intent/reconciliation* only, not a competing
   task lease/assignment scheduler. Legacy `supabase/` paths are historical
   naming; no Supabase/hosted/cloud provider or fallback.
2. **Single physical scheduler:** existing Supervisor/DevOS task cycle owns every
   physical dispatch, provision/retire and lease. Logical Kernel is a
   transactional state machine and never starts a second timer, uncontrolled
   worker or provider. Realtime wake is advisory, never authority.
3. **Identity split:** future `logical_agent_id` persists independently of
   `session_incarnation_id`, Browser tab/target, Host PID+exact OS birth and
   device generation. A lost/replaced tab doesn't erase logical agent/task
   history. Existing physical Fleet `agent_id` must not be silently
   reinterpreted as a stable logical identity; migration needs explicit mapping,
   versioned readback and proof.
4. **Mailbox semantics (future source slice):** messages are project/run/task-
   scoped append-only records with sender logical ID, addressed recipients,
   causal sequence, payload digest, schema, independent receipt and bounded
   visibility. Only existing authenticated admissions may perform writes.
   Model/page/message content cannot provide native authority. Loss of ACK
   requires readback; an unknown physical Send is `AMBIGUOUS` and no-replay.
   Unrelated leased tasks are not globally stopped by one fenced effect.
5. **Coding execution:** use existing bounded `FIXED_SANDBOX_SOURCE_EDIT`
   capability only inside a generated, pinned, leased Git worktree with
   authenticated Owner/task/source binding and limited path/patch permissions.
   No arbitrary OS shell, SQL, URL, dynamic command, network or credential
   access through agent prose. A physical sandbox is required before claiming
   production coding; `sandbox_backend_bound:false` remains BLOCKED.
6. **Trusted startup:** Device + signed EXE -> own PG postmaster/incarnation ->
   Host/Guardian root -> canonical Owner genesis epoch/CAS -> private readers ->
   Supervisor admission -> lease recovery -> Fleet activation. No default fake
   Owner, no circular self-attestation, no trust promotion from renderer.
   Missing/ambiguous proof is UNKNOWN/BLOCKED, not auto-retry.
7. **Host continuity / UI:** migrate lifecycle ownership of the **one**
   Supervisor into existing trusted Host only after current Owner/Guardian
   acceptance; do not add a parallel service/scheduler. Electron is an
   observer/operator UI. Renderers and model output remain untrusted.
8. **RSI experiments:** verified experience, governed skill library,
   experiments and architecture-search proposals can rank hypotheses, never
   rewrite their own evaluator, trust root, signer, ACL or release gate.
   Promotion requires independent benchmark, physical checks, exact source,
   backup, canary and rollback.

## First executable vertical slice — logical demand vs physical Fleet

The existing `planElasticFleetCapacity` consumes server-returned task backlog,
but previously coerced an unreadable/malformed backlog to zero demand. After
idle hysteresis this could produce retirement decisions even when the database
had not actually confirmed the absence of work. This is a **safety and
continuity defect**, not proof of an absence of logical tasks.

V1 first implementation:
- Expose a read-only, versioned `logical_work` demand projection with
  `KNOWN`/ `UNKNOWN`, nonnegative integer ready/running/total counts, and
  separate physical target. It is an **advisory task-demand projection**, not
  a logical-agent registry, mailbox, lease, trusted DB readback or permission.
- Invalid/missing authoritative backlog is UNKNOWN; do not increment idle
  hysteresis, grow the fleet or retire tabs. Skip the existing
  `FLEET_RECONCILE` mutation entirely for UNKNOWN. No new scheduler.
- Known zero backlog preserves the current warm floor, normal hysteresis and
  verified physical retirement rules; known large backlog stays durable even
  while target slots are capped by physical policy.
- Tests must cover UNKNOWN with many physical tabs, transition from known idle
  to UNKNOWN and back, 540 tasks vs 10 physical slots, malformed values,
  no `FLEET_RECONCILE` effect on UNKNOWN and baseline behavior on KNOWN.

## Ordered migration/acceptance (not a replacement Level-1 roadmap)

**ADF-0:** source-owned diagnostic/read-only backlog distinction (this PR).
Do not claim live agent persistence.

**ADF-1:** close actual installed Owner/Guardian/PG bootstrap and self-update
on one exact signed Windows source; independent physical proof. Reconcile
existing WAKE_AMBIGUOUS without automatically repeating the effect.

**ADF-2:** one actual authenticated Git coding operation + physical tests +
independent Critic + W39 own-PG checkpoint and verified next task after restart.
This is the first product milestone; prioritize over additional RSI modules.

**ADF-3:** logical agent registry/session bindings and causal mailboxes under
existing own-PG authority; test recursive child tasks, cross-agent messages,
conflicts, failed children, quota/backpressure and restart with both
N > physical slots and multiple independent project branches.

**ADF-4:** make existing trusted Supervisor resilient to operator UI lifecycle
without changing authority; test 4 -> 16 -> 32 -> 64 logical contexts and
bounded physical slots, 72-hour controlled recovery, measured task throughput,
no duplicate ambiguous effects, native source/ACL/backup/restore.

**ADF-5:** activate governed verified experience and skill reuse; measured
quality/latency/cost lift, independently accepted architecture proposals, safe
immutable package canary/rollback. No production self-promotion by agents.

### Explicit non-claims / acceptance metrics

Source acceptance is not installed authority; old Windows package and local
physical tests cannot be combined across source SHA. Existing installed client
was last read `execution_ready=false`, four `BOUND_UNVERIFIED`, zero verified
agents, Supervisor `WAKE_AMBIGUOUS` and attached PG still running. Nothing in
this ADR or its first source slice changes that.

Primary measures: verified useful completions/hour; recovery across UI/Host
restart; independent Critic rejection accuracy; lost-ACK and duplicate effect
rate; logical queued work vs physical slots; p95 inter-agent handoff latency;
cost per verified result; source/provenance correctness and regression-adjusted
RSI improvement. Record `UNKNOWN` when trustworthy evidence is absent.
