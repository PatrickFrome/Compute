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

Meta-Orchestrator never manufactures `agent_id`, `tab_id`, `target_id`, agent generation, lease generation, lease expiry, claim id, or workspace ownership. Those remain scheduler/runtime-owned fields.

## Exact runtime boundary

```text
roadmap authority + observed durable state
                  |
                  v
          META_ORCHESTRATOR
       reconcile / plan / replan
                  |
      zero-authority proposals only
                  |
       +----------+----------+
       |                     |
       v                     v
existing devos_fleet   semantic reasoning
 enqueue/reconcile      request (when needed)
       |
       v
single DevOS scheduler / admission
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
18. Bounded worker observation is read-only liveness evidence. `IDLE` or `GENERATING` never grants a lease or scheduler authority.
19. Workspace state `FROZEN` retains its active fence; ambiguity never frees branch/worktree/task ownership.

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
| DevOS meta governor | `c00279c99c3bb5257993d5a29896f0fb791561c3` | **Selective contract import only**. Diverged from current Browser; whole-branch merge would roll back newer Browser work. |
| Workspace Binding Registry | `fc0298015acfbca58560c223ac4777cc20a4efdc` | **Selective port complete on this convergence line**: manager, Git hardening, durable migration/RPC contract and source tests are present. Production DDL remains unapplied. |
| Browser update liveness | `656c02e722261778527cced274c64db7cce9a60c` | **Adapted selective integration**. Original bounded-observer idea retained; old tab+generation cache was rejected and replaced by exact agent+tab+target+generation local-target revalidation. Do not whole-merge. |
| PR #138 C5/fleet admission lineage | `fc7ed9d5e3b9033f9e4cc40bea62f5b8cddbcf70` | **Transport/admission evidence reference**; no duplicate scheduler. Current convergence adds a branch-local durable-claim transport fence. |
| A2 realtime cognitive bus validated code | `a5264aa6ab7a3e43fbaaf97a1be0b9c06f05882e` | **Invariant/reference only** for causal evidence, replay, epoch ownership and observer semantics; not a live dependency while exact-provider acceptance remains blocked. |

Historical branches are not merge targets merely because they exist. Their unique behavior must be classified as ancestor, superseded, selective-port, evidence-only, or active prerequisite before admission to the release line.

## Workspace Registry integration

The registry is now selectively ported into the convergence branch. A mutating task follows this order:

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

## Bounded worker observation

The update-liveness branch's useful bounded round-robin idea has been adapted instead of copied wholesale. `bounded-worker-observer.mjs` V2:

- bounds Browser capture work independently of fleet size;
- uses trusted local WebContents observations only;
- revalidates target before capture and again after capture;
- caches only exact agent+lifecycle+tab+target+generation identity;
- drops cache on target/generation/lifecycle drift or capture failure;
- exposes `IDLE`/`GENERATING` as read-only observation only;
- always emits `lease_eligible=false`, `scheduler_authority=false`, `automatic_retry_allowed=false`, `authority_effect=false`.

This observer may help recover visibility of `BOUND_UNVERIFIED` workers, but only the existing Browser transport-promotion path may make them `ACTIVE`.

## Self-update / release gate

Meta-Orchestrator cannot publish, install, restart, ARM, CONTROL, or promote a Browser release. A release candidate derived from this branch requires exact-head evidence from:

1. Meta-Orchestrator core + Meta-to-Workspace admission tests.
2. Workspace Binding Registry/manager/Git-hardening tests.
3. DevOS durable-claim transport admission and native two-phase cycle/transport-proof suites.
4. Bounded observer target-drift/fail-closed tests.
5. Supervisor mesh epoch/continuity suites.
6. Browser Shell suite.
7. Self-update fast + physical E2E on the exact candidate SHA.
8. Successor qualification and signed heartbeat proving the new process/incarnation is the intended release.

## Acceptance matrix

The convergence suite includes, in addition to the original 32 Meta-Orchestrator scenarios:

- exact Meta-to-Workspace task/claim/agent/tab/target/generation/lease fencing;
- four independent active Workspace Binding fences;
- ambiguous workspace materialization/retirement -> `FROZEN` with no blind retry;
- service-role-only Workspace Registry RPC surface;
- single-scheduler durable-claim admission trigger;
- fresh supervisor-state requirement;
- hard rejection of `BOUND_UNVERIFIED` claim admission;
- exact fleet transport-proof identity checks;
- bounded observer work budget and deterministic round robin;
- pre-capture target drift -> zero capture;
- post-capture target drift -> observation/cache discarded;
- cache invalidation on exact incarnation drift;
- observer signals proven incapable of granting lease/scheduler authority;
- existing physical task-cycle ambiguity/no-redispatch regression tests.

## Remaining dependency-safe slices

1. Harden the Browser-side `assertLiveLeaseBinding` seam so physical dispatch independently requires `ACTIVE + exact transport proof`, even if a future server regression emits a bad lease.
2. Wire bounded observer V2 into the existing supervisor scheduler/event source without adding a polling loop; use its signals only for liveness/reconciliation and transport-promotion work.
3. Add/read a deterministic roadmap+fleet+evidence snapshot adapter for `reconcileMetaOrchestrator` rather than giving the brain direct database authority.
4. Re-run Browser Shell, native cycle, supervisor mesh, workspace registry, transport admission, chaos, self-update fast/physical E2E on one exact candidate SHA.
5. Promote the branch-local SQL only after exact-head CI and explicit production evidence gate; never silently apply it during branch implementation.
