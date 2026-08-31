# METAENGINE Meta-Orchestrator V1

Status: branch-local implementation contract. No production mutation, no main merge, no release authority.

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

V1 does not add production DDL. It consumes existing durable sources and emits zero-authority proposals:

- `destruktion_meta.metaengine_devos_roadmap_authority_h205f22`
- `destruktion_meta.compute_fabric_admission_plan_h205f22`
- canonical roadmap dependency/release tables
- `destruktion_meta.devos_fleet_task_h205f22`
- `destruktion_meta.devos_fleet_claim_h205f22`
- `destruktion_meta.devos_fleet_event_h205f22`
- existing `public.devos_fleet_enqueue_v1(...)`
- existing DevOS reconcile/lease/running/complete/ambiguous RPC family

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
lease + exact incarnation fencing
       |
       v
existing two-phase Browser/native task cycle
       |
       v
transport/effect proof -> evidence ledger
```

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
| Browser orchestra hotfix convergence / PR #142 | `d91e94b307ed60e890aabc53a2678a8ae9c6a79d` | **Base** for Meta-Orchestrator V1. Includes exact #139 + #140 parents. |
| Supervisor mesh continuity | `84a71aaedc49186c24a992f507ca1d3f14767181` | **Already ancestor** of convergence; current Browser is 119 commits ahead / 0 behind. Do not re-merge. |
| DevOS meta governor | `c00279c99c3bb5257993d5a29896f0fb791561c3` | **Selective contract import only**. Diverged from current Browser; whole-branch merge would roll back newer Browser work. |
| Workspace Binding Registry | `fc0298085ecfe218a70868f24f3bd9f204545631` | **Gated selective integration**. Diverged (44 ahead / 145 behind from convergence); port registry migration/RPC/manager contracts only after exact tests. |
| Browser update liveness | `656c02e722261778527cced274c64db7cce9a60c` | **Evidence/acceptance dependency**, not whole-branch merge. Diverged; current convergence is 104 commits ahead but lacks 3 branch-local commits. |
| PR #138 C5/fleet admission lineage | `fc7ed9d5e3b9033f9e4cc40bea62f5b8cddbcf70` | **Transport/admission evidence reference**; no duplicate scheduler. |
| A2 realtime cognitive bus validated code | `a5264aa6ab7a3e43fbaaf97a1be0b9c06f05882e` | **Invariant/reference only** for causal evidence, replay, epoch ownership and observer semantics; not a live dependency while exact-provider acceptance remains blocked. |

Historical branches are not merge targets merely because they exist. Their unique behavior must be classified as ancestor, superseded, selective-port, evidence-only, or active prerequisite before admission to the release line.

## Workspace Registry integration gate

Before a task proposal can be converted to an enqueue in the future runtime wiring, the Workspace Binding Registry must be able to prove a unique active binding for the intended workspace/branch/worktree/task scope. V1 core deliberately does not fabricate this proof. Until the registry contract is selectively ported and accepted on the convergence line, the Meta-Orchestrator remains proposal-only.

## Self-update / release gate

Meta-Orchestrator cannot publish, install, restart, ARM, CONTROL, or promote a Browser release. A release candidate derived from this branch requires exact-head evidence from:

1. Meta-Orchestrator contract tests.
2. Existing DevOS native two-phase cycle and transport-proof suites.
3. Supervisor mesh epoch/continuity suites.
4. Workspace Binding Registry contract after selective integration.
5. Browser Shell suite.
6. Self-update fast + physical E2E on the exact candidate SHA.
7. Successor qualification and signed heartbeat proving the new process/incarnation is the intended release.

## Acceptance matrix

The V1 unit suite currently covers the following fail-closed requirements:

1. compile exact-baseline DAG;
2. reject duplicate semantic points;
3. reject missing dependencies;
4. reject dependency cycles;
5. reject baseline drift;
6. reject scheduler identity inside a plan node;
7. normalize capabilities/roles without agent identity;
8. represent unscheduled nodes as pending;
9. never equate COMPLETED with VERIFIED without evidence;
10. accept only explicit verified zero-authority evidence;
11. ignore authority-bearing evidence;
12. preserve AMBIGUOUS as first-class state;
13. fence leader epoch drift;
14. request reasoning on roadmap alignment drift;
15. request reasoning on plan-generation drift;
16. reconcile ambiguous effects without retry;
17. request missing completion evidence;
18. keep successor blocked until predecessor VERIFIED;
19. unlock successor after VERIFIED predecessor;
20. replan on failed dependency rather than scheduling successor;
21. request capacity when slots are zero;
22. bound adaptive fan-out;
23. add critic + falsifier for CRITICAL risk within budget;
24. add critic for HIGH risk;
25. suppress duplicate active semantic points;
26. converge only when all nodes are VERIFIED;
27. recursively enforce zero-authority output;
28. map work only to existing `devos_fleet_enqueue_v1`;
29. emit no scheduler-owned incarnation fields;
30. generate plan-generation-stable enqueue idempotency;
31. reject fabricated scheduler field/authority laundering in incoming proposal;
32. request capacity through existing fleet reconcile with no second scheduler loop.

## Next integration slices

1. Land this pure core + adapter on top of PR #142 and require exact-head CI.
2. Selectively port Workspace Binding Registry migration/RPC/manager files onto the same fresh convergence base; never merge its divergent branch wholesale.
3. Add a read-only snapshot adapter that projects roadmap authority + fleet task/evidence state into `reconcileMetaOrchestrator`.
4. Add a privileged server-side admission adapter which verifies Workspace Binding Registry proof before invoking `devos_fleet_enqueue_v1`; keep Meta-Orchestrator itself unprivileged.
5. Add durable meta plan/progress events using the existing fleet/event/roadmap evidence plane where possible; add schema only if a demonstrated missing atomicity requirement remains.
6. Run Browser Shell, native cycle, supervisor mesh, workspace registry, chaos, self-update fast/physical E2E on one exact candidate SHA before any release.
