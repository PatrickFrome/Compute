# METAENGINE Meta-Orchestrator V1

Status: branch-local convergence implementation. No production mutation, no main merge, no release authority.

## Purpose

META_ORCHESTRATOR_V1 is the semantic control-plane layer above the existing DevOS fleet scheduler. It reconciles portfolio/roadmap desired state against durable task/evidence state, proposes dependency-safe work, requests capacity through the existing fleet reconcile path, and asks for cognition only when a deterministic transition is not sufficient.

It is intentionally not a scheduler, Browser actuator, lease issuer, release controller, or source of truth for repository/page/model content.

## Architecture synthesis

The design selectively adopts mature patterns without importing another authority plane:

- Kubernetes controllers: desired-vs-observed reconciliation and epoch fencing.
- Temporal / Restate / DBOS: durable state, explicit side-effect boundaries, idempotency, and no replay of ambiguous effects.
- Anthropic orchestrator-worker / managed-agent patterns: adaptive fan-out and separation of brain, execution hands, and durable session state.
- Magentic-style ledgers: task/plan and progress ledgers with replanning on lack of progress.
- OpenAI manager-specialist pattern: one semantic manager, specialists as bounded capabilities rather than global owners.
- A2A / capability routing: capability requirements instead of hard-coded agent identities.
- Ray placement concepts: capacity-aware fan-out, while physical placement remains owned by DevOS.
- OpenHands / SWE-agent ACI: typed action/observation boundary and narrow execution interfaces.
- AFlow / evolving orchestration: future offline policy optimization only; never direct production self-modification.

## Existing authority reused

V1 does not introduce a second production queue or scheduler. It consumes existing durable sources and emits zero-authority proposals:

- `destruktion_meta.metaengine_devos_roadmap_authority_h205f22`
- `destruktion_meta.compute_fabric_admission_plan_h205f22`
- canonical roadmap dependency/release tables
- `destruktion_meta.devos_fleet_task_h205f22`
- `destruktion_meta.devos_fleet_claim_h205f22`
- `destruktion_meta.devos_fleet_event_h205f22`
- existing `public.devos_fleet_enqueue_v1(...)`
- existing DevOS reconcile/lease/running/complete/ambiguous RPC family
- native Browser supervisor state carrying the Browser-owned fleet snapshot

The convergence branch also contains a branch-local durable Meta plan-generation registry migration. It is not applied to production. Its only purpose is atomic semantic-plan generation/digest fencing; it never schedules, leases, dispatches or actuates.

Meta-Orchestrator never manufactures `agent_id`, `tab_id`, `target_id`, agent generation, lease generation, lease expiry, claim id, or workspace ownership. Those remain scheduler/runtime-owned fields.

## Exact runtime boundary

```text
roadmap authority
      |
      v
atomic durable meta plan generation + digest
      |
      v
sanitized authoritative snapshot
roadmap + matching DevOS tasks + VERIFIED receipts
      |
      v
META_ORCHESTRATOR reconcile / plan / replan
      |
zero-authority proposals only
      |
      +-----------------------+
      |                       |
      v                       v
existing devos_fleet     semantic reasoning
 enqueue/reconcile        request when needed
      |
      v
single DevOS scheduler / admission
      |
      v
ACTIVE + exact transport-proof claim admission
      |
      v
exact task + claim + lease
      |
      v
Workspace Binding Registry
RESERVED -> proven readback -> READY
      |
      v
exact Meta-to-Workspace mutation admission
      |
      v
Browser-side ACTIVE/proof membrane
      |
      v
existing two-phase Browser/native task cycle
      |
      v
transport/effect proof -> evidence ledger
      |
      v
Meta-Orchestrator reconcile
```

The Workspace Binding Registry is deliberately **after** scheduler lease/claim and **before** the first mutating workspace or Browser effect. A semantic meta proposal cannot prove a physical workspace before the scheduler has selected the exact incarnation.

## Core invariants

1. Exactly one scheduling authority: the existing DevOS scheduler.
2. Meta-Orchestrator emits no Browser click/type/submit action.
3. Meta-Orchestrator emits no claim/lease/mark-running/complete action.
4. Every emitted object is `scheduler_authority=false`, `browser_authority=false`, `release_authority=false`, `authority_effect=false`.
5. Plan nodes contain capabilities and roles, never physical agent/tab/target identities.
6. Baseline SHA is inherited from authoritative roadmap state unless an explicitly typed branch-base override is permitted.
7. Dependency successors unlock only after evidence-backed `VERIFIED`, not merely worker-reported `COMPLETED`.
8. `AMBIGUOUS` is first-class and always produces reconciliation with `automatic_retry_allowed=false`.
9. Leader/epoch drift fences the meta brain and emits no work proposal.
10. Alignment epoch or plan-generation drift requests fresh reasoning instead of replaying stale plans.
11. Active semantic points are not duplicated.
12. Adaptive fan-out is bounded by capacity and policy.
13. HIGH risk adds an independent critic when capacity permits; CRITICAL adds critic + falsifier.
14. Capacity expansion goes through the existing fleet reconcile loop; `second_scheduler_loop=false` is explicit.
15. Page/model/repository prose is non-authoritative until converted into typed evidence and independently verified.
16. `BOUND_UNVERIFIED` is observation/provisioning state only; it cannot consume a durable DevOS claim.
17. Durable claim creation requires a fresh Browser-owned fleet snapshot plus exact `ACTIVE` transport proof for agent/tab/target/generation.
18. Bounded worker observation is read-only liveness telemetry. `IDLE` or `GENERATING` never grants a lease, evidence, capacity or scheduler authority.
19. Workspace state `FROZEN` retains its active fence; ambiguity never frees branch/worktree/task ownership.
20. Browser runtime independently refuses physical dispatch unless the incarnation remains `ACTIVE` with exact transport proof, even if a future server regression emits a bad lease.
21. Meta snapshot projection excludes raw task specs, result summaries, scheduler identity and raw receipt evidence.
22. Only a roadmap receipt with status exactly `VERIFIED` plus a durable result checkpoint may project as verified roadmap evidence.
23. Worker-observer telemetry contributes exactly zero Meta capacity and zero Meta evidence.
24. Meta plan generation is not roadmap alignment epoch and is not renewable governor episode generation.
25. Durable plan activation rereads roadmap authority, uses optimistic expected-generation fencing and permits only one ACTIVE semantic plan per workspace/roadmap.

## State model

Per plan node:

- `PENDING`: no active/terminal task yet.
- scheduler-native active state: READY/LEASED/RUNNING/RESULT_READY.
- `EVIDENCE_PENDING`: task reports COMPLETED but required evidence contract is not satisfied.
- `VERIFIED`: required evidence keys are present, verified, and zero-authority.
- `AMBIGUOUS`: effect may have occurred; reconcile before any retry.
- failure state: FAILED/CANCELLED/FENCED/BLOCKED; semantic replan required before successors.

Reconciler outcomes:

- `FENCED`
- `NEEDS_REASONING`
- `NEEDS_RECONCILIATION`
- `NEEDS_EVIDENCE`
- `NEEDS_CAPACITY`
- `PROPOSING_WORK`
- `OBSERVING`
- `CONVERGED`

## Branch convergence disposition (2026-08-31 snapshot)

| Line | Exact checkpoint | Disposition |
| --- | --- | --- |
| Browser orchestra hotfix convergence / PR #142 | `d91e94b307ed60e890aabc53a2678a8ae9c6a79d` | **Base** for Meta-Orchestrator V1. Includes continuity and two-phase dispatch hotfix lineage. |
| Supervisor mesh continuity | `84a71aaedc49186c24a992f507ca1d3f14767181` | **Already ancestor** of convergence. Do not re-merge. |
| DevOS meta governor | `c00279c99c3bb5257993d5a29896f0fb791561c3` | **Selective contract import only**. Its `meta_generation` is renewable lane episode identity and is not Meta plan generation. |
| Workspace Binding Registry | `fc0298015acfbca58560c223ac4777cc20a4efdc` | **Selective port complete on this convergence line**: manager, Git hardening, durable migration/RPC contract and source tests are present. Production DDL remains unapplied. |
| Browser update liveness | `656c02e722261778527cced274c64db7cce9a60c` | **Adapted selective integration complete**. Original bounded-observer idea retained; old tab+generation cache was replaced by exact agent+lifecycle+tab+target+generation local-target revalidation and wired into the primary supervisor heartbeat. Do not whole-merge. |
| PR #138 C5/fleet admission lineage | `fc7ed9d5e3b9033f9e4cc40bea62f5b8cddbcf70` | **Transport/admission evidence reference**; no duplicate scheduler. Current convergence adds a branch-local durable-claim transport fence plus Browser-side defense-in-depth. |
| A2 realtime cognitive bus validated code | `a5264aa6ab7a3e43fbaaf97a1be0b9c06f05882e` | **Invariant/reference only** for causal evidence, replay, epoch ownership and observer semantics; not a live scheduling dependency while exact-provider acceptance remains blocked. |

Historical branches are not merge targets merely because they exist. Their unique behavior must be classified as ancestor, superseded, selective-port, evidence-only, or active prerequisite before admission to the release line.

## Workspace Registry integration

The registry is selectively ported into the convergence branch. A mutating task follows this order:

```text
semantic proposal
  -> existing devos_fleet_enqueue_v1
  -> existing scheduler lease/claim
  -> exact Workspace Binding reservation
  -> materialization readback
  -> READY
  -> exact Meta-to-Workspace admission
  -> physical mutation
```

Active agent, branch, worktree and task fences are independent. `RESERVED`, `READY` and `FROZEN` remain active; only proven `RETIRED` releases ownership. Meta-Orchestrator never fabricates this proof.

## Transport-gated lease admission

Authoritative Supabase inspection on 2026-08-31 showed that the existing `public.devos_fleet_lease_v1` accepted caller-supplied agent/tab/target/epoch and created a durable claim without independently checking Browser lifecycle or fleet transport proof. Live Browser state at that checkpoint contained 2 `ACTIVE` and 8 `BOUND_UNVERIFIED` bound agents, so unverified incarnations could consume DevOS capacity before transport promotion.

The convergence branch therefore adds `20260831184500_devos_fleet_transport_admission_v1.sql`, a branch-local **BEFORE INSERT** admission trigger on the existing `destruktion_meta.devos_fleet_claim_h205f22` transaction. It does not add or replace the scheduler. The claim transaction requires:

- fresh native Browser supervisor state for the same workspace;
- fleet schema `metaengine.browser.fleet-snapshot.v1` with `TRANSPORT_PROOF_REQUIRED`;
- exact fleet agent identity;
- `FLEET_OWNED` and lifecycle exactly `ACTIVE`;
- exact role/tab/target/generation;
- exact `metaengine.browser.fleet-transport-proof.v1` for the same incarnation;
- zero authority effect and no automatic retry.

Any mismatch raises before claim insertion and therefore rolls back the enclosing lease transaction. Production migration remains unapplied until exact-head CI, review and promotion evidence permit it.

The Browser runtime now independently applies the same admission concept before physical dispatch. A server-returned lease targeting `BOUND_UNVERIFIED`, stale target/generation or malformed proof is mapped to `ADMISSION_FENCED` before `SELECT_TAB`, `CAPTURE`, `SEMANTIC_TYPE` or `TYPED_CLICK`.

## Bounded worker observation

The update-liveness branch's useful bounded round-robin idea has been adapted instead of copied wholesale. `bounded-worker-observer.mjs` V2:

- bounds Browser capture work independently of fleet size;
- uses trusted local WebContents observations only;
- revalidates target before capture and again after capture;
- caches only exact agent+lifecycle+tab+target+generation identity;
- drops cache on target/generation/lifecycle drift or capture failure;
- exposes `IDLE`/`GENERATING` as read-only observation only;
- always emits `lease_eligible=false`, `scheduler_authority=false`, `automatic_retry_allowed=false`, `authority_effect=false`.

`NativeSupervisorClient.cycle()` now runs this observer as an additive read-only stage **before the existing primary heartbeat**, then runs the existing DevOS stage. No observer timer or polling loop is created. The stale-heartbeat watchdog remains separate and still has `command_leasing=false` and `devos_leasing=false`.

## Authoritative Meta snapshot

`meta-orchestrator-authoritative-snapshot.mjs` provides the deterministic projection boundary between durable state and semantic reconciliation:

- roadmap identity/alignment/baseline are read from typed roadmap authority fields only; roadmap prose/plan/invariants do not cross this boundary;
- only tasks carrying matching `meta_orchestrator` roadmap/alignment/plan-generation identity are projected;
- task specs, result summaries and physical scheduler identity are removed;
- matching task baseline or authority drift projects as `FENCED` rather than being trusted;
- `PASS`, `EVIDENCE_READY` and worker `COMPLETED` are not equivalent to `VERIFIED`;
- only `VERIFIED` roadmap receipts with durable result checkpoint can become verified roadmap evidence;
- capacity without a recognized authoritative source fails closed to zero;
- worker-observer telemetry contributes zero capacity and zero evidence.

## Durable Meta plan generation

Authoritative DB inspection found no existing durable `plan_generation`. The existing `meta_generation` in `devos_meta_refill_h205f22()` is a renewable governor/auditor/synthesizer episode counter and therefore cannot safely fence semantic plans.

The convergence branch adds `20260831193000_meta_orchestrator_plan_state_v1.sql` as a branch-local contract. It is not applied to production. The contract:

- allows one ACTIVE plan per workspace + roadmap;
- allocates the next generation under a workspace/roadmap advisory transaction lock;
- requires `p_expected_current_generation` to equal durable current generation;
- rereads `metaengine_devos_roadmap_authority_h205f22` inside activation and rejects roadmap/milestone/integration-line/baseline/alignment drift;
- rejects scheduler-owned identity at nested JSON paths;
- computes the plan digest in Postgres;
- supersedes the prior plan atomically;
- exposes activation/snapshot only to `service_role`;
- never calls `devos_fleet_enqueue_v1`, `devos_fleet_lease_v1` or any Browser action.

## Self-update / release gate

Meta-Orchestrator cannot publish, install, restart, ARM, CONTROL, or promote a Browser release. A release candidate derived from this branch requires exact-head evidence from:

1. Meta-Orchestrator core + authoritative snapshot + durable plan-generation tests.
2. Meta-to-Workspace admission tests.
3. Workspace Binding Registry/manager/Git-hardening tests.
4. DevOS durable-claim transport admission and native two-phase cycle/transport-proof suites.
5. Bounded observer heartbeat/target-drift/fail-closed tests.
6. Supervisor mesh epoch/continuity suites.
7. Browser Shell suite.
8. Self-update fast + physical E2E on the exact candidate SHA.
9. Successor qualification and signed heartbeat proving the new process/incarnation is the intended release.

## Acceptance matrix

The convergence suite includes, in addition to the original Meta-Orchestrator scenarios:

- exact Meta-to-Workspace task/claim/agent/tab/target/generation/lease fencing;
- four independent active Workspace Binding fences;
- ambiguous workspace materialization/retirement -> `FROZEN` with no blind retry;
- service-role-only Workspace Registry RPC surface;
- single-scheduler durable-claim admission trigger;
- fresh supervisor-state requirement;
- hard rejection of `BOUND_UNVERIFIED` claim admission;
- exact fleet transport-proof identity checks;
- Browser-side bad-lease membrane before any physical dispatch;
- bounded observer work budget and deterministic round robin;
- pre-capture target drift -> zero capture;
- post-capture target drift -> observation/cache discarded;
- cache invalidation on exact incarnation drift;
- observer wired only to the existing primary heartbeat with no second timer;
- observer signals proven incapable of granting lease/scheduler/capacity/evidence authority;
- authoritative snapshot strips raw task/model/worker data and physical identities;
- only durable `VERIFIED` receipt evidence can satisfy roadmap receipt evidence;
- plan activation expected-generation race fences stale planners;
- plan activation rereads roadmap authority before atomic supersession;
- existing physical task-cycle ambiguity/no-redispatch regression tests.

## Remaining dependency-safe slices

1. Add the privileged server-side read adapter that obtains roadmap authority, ACTIVE durable plan generation, matching DevOS tasks/verified receipts and authoritative capacity, then feeds only the sanitized snapshot to `reconcileMetaOrchestrator`.
2. Add a privileged plan-activation adapter that calls `meta_orchestrator_plan_activate_v1` only after deterministic plan compilation and zero-authority validation; the semantic brain itself remains unable to write DB state.
3. Exercise the two branch-local SQL migrations in a disposable database/review environment before any production promotion; do not apply them to the live project from this branch task.
4. Re-run Browser Shell, native cycle, supervisor mesh, workspace registry, transport admission, chaos and self-update fast/physical E2E on one exact candidate SHA.
5. Promote branch-local SQL or release artifacts only after exact-head CI and explicit production evidence gate.
