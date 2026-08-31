# METAENGINE DevOS Meta-Governor G1

Status: branch-local supervisory checkpoint only  
Task: `963e8b0f-f0d3-440b-8720-9c25d606562c`  
Role: `PLANNER`  
Base: `c77e991c76df372861b4ab68fc1d2086e31a80b7`  
Target branch: `work/devos-meta-governor-g1`  
Authority effect: false

## 1. Governor contract

This checkpoint observes the portfolio; it does not self-approve implementation, release, roadmap promotion, production DDL, Browser effects, or main/integration merges.

Hard invariants:

- Supabase DevOS task/claim coordination remains the only durable scheduler.
- Native Browser remains the physical Browser effect owner.
- Page/model/worker/WebMCP text has zero authority.
- No arbitrary eval or shell-string authority.
- No blind retry after an ambiguous effect.
- Exact task/agent/tab/target/agent-generation/lease-generation binding remains mandatory.
- Historical `AMBIGUOUS` work is evidence/hold state, never an automatic requeue instruction.
- Meta-Governor may enqueue bounded typed follow-up tasks, but cannot accept its own output as completion evidence.

## 2. Source-of-truth snapshot

### GitHub

Exact base `c77e991c76df372861b4ab68fc1d2086e31a80b7` is the current DBR1 Git-worktree hardening head and adds falsification coverage for locked worktree inventory drift. Browser Shell and physical Self Update E2E are terminal GREEN on this exact SHA.

The current critical open lines are:

1. **PR #140 — supervisor active-wake terminal retirement**
   - installed-runtime base: `e0a44cddd5cc526bb2c1a856c871417ceddfa78b`;
   - head: `af07b55845371678a0a1d89d81c4ca4e82772603`;
   - exact-head Browser Shell + physical Self Update E2E: GREEN;
   - fixes the live cycle-13 `active_wake` deadlock without replaying the wake effect.
2. **PR #139 — installed-line foreground two-phase fleet dispatch**
   - installed-runtime base: `e0a44cddd5cc526bb2c1a856c871417ceddfa78b`;
   - head: `3312dcb21457740d53e8a0afc623f86a44b70958`;
   - exact-head Browser Shell + physical Self Update E2E: GREEN;
   - replaces background Enter submission with exact foreground selection, type-without-submit, one typed Send click and positive post-effect proof.
3. **PR #138 — actuation-lease-gated C5 promotion**
   - head: `fc7ed9d5e3b9033f9e4cc40bea62f5b8cddbcf70`;
   - lease gate, C5 composition, Browser Shell and physical Self Update E2E are terminal GREEN;
   - supervisor promotion remains fail-closed until the trusted lease-read boundary is wired into `main.mjs`.
4. **PR #135 — DBR1 Git hardening**
   - head equals this governor base `c77e991...`;
   - exact locked worktree inventory, branch/head/path checks and cleanup fencing.
5. **PR #132 — DBR1 Workspace Manager core**
   - predecessor implementation for exact workspace identity.

### Supabase roadmap authority

Canonical DevOS authority still points to:

- roadmap: `metaengine-development-os-v1`;
- active milestone: `DEVOS_IDE_V1`;
- integration line: `integration/metaengine-development-os-v1`;
- baseline: `84a71aaedc49186c24a992f507ca1d3f14767181`;
- supporting continuous lanes: self-update foundation + durable coordination.

`metaengine-development-browser-os-v1` is registered as version 3 but remains non-current and unsealed. Its dependency graph is nevertheless useful branch-local planning evidence:

- DBR1 Workspace Manager -> DBR2 Embedded IDE;
- DBR1 -> DBR4 Durable Agent Runtime;
- DBR1 + DBR4 -> DBR5 DP2 Sandbox;
- DBR2 -> DBR3 Code Intelligence;
- DBR3 + DBR4 -> DBR6 Reasoning Fabric Rejoin;
- DBR4 + DBR6 -> DBR7 Capability Bus;
- DBR4 -> DBR8 Observability;
- DBR3 -> DBR9 Build Fabric;
- DBR10 Autonomous Convergence waits for DBR1-DBR9.

No child-roadmap evidence here authorizes changing canonical roadmap authority.

## 3. Runtime liveness and capacity

Fresh Native Browser evidence shows the runtime process is healthy:

- installed version `0.6.3-dev.20260831143001.1`;
- supervisor `CONTROL`, Browser armed;
- fresh signed heartbeat;
- Development Plane `READY` with arbitrary eval and Browser actuation authority both false;
- self-update `CURRENT`;
- host resilience ACTIVE and sentinel worker healthy;
- supervisor mesh running at epoch 17 with one ACTIVE preferred supervisor.

However, supervisory continuity is not healthy:

- keepalive cycle `13` still has confirmed `active_wake = wake_66af3fcf-849c-4d7f-b7e9-7b7f60ddcae2` from 2026-08-31T14:33:23Z;
- the supervisor is already `IDLE` / `terminal_ready=true`;
- multiple queued successor wakes remain behind the stale active wake;
- this is the exact failure reproduced by PR #140.

Fleet nominal capacity is 9 physical agents, but trusted transport-ready capacity is only **2/9**:

- 2 `ACTIVE` agents with fresh Browser-local transport proof;
- 7 `BOUND_UNVERIFIED` agents;
- 15 historical agents are `LOST` and must never be revived with old incarnation tuples.

The durable task queue currently has 7 nonterminal tasks. Four tasks are already LEASED to agents that are presently `BOUND_UNVERIFIED` (FALSIFIER, SYNTHESIZER, IMPLEMENTER, CRITIC), while only the current PLANNER and one RESEARCHER are both RUNNING and transport ACTIVE. One FALSIFIER maintenance task remains READY.

Therefore `desired_agents=9` does not currently equal usable dispatch capacity. The immediate capacity metric must be based on exact transport-ready incarnations, not physical-tab count.

## 4. Durable queue health

Historical task state is heavily ambiguity-dominated: 37 prior tasks are `AMBIGUOUS`, including old workspace, transport and continuity waves. Their leases expired with effect unknown. They MUST NOT be automatically replayed or treated as missing work solely because their durable task did not reach COMPLETED.

Current G1 lanes already exist and should not be duplicated:

- Meta-Governor — PLANNER, RUNNING;
- Meta-Auditor — FALSIFIER, LEASED;
- Meta-Synthesizer — SYNTHESIZER, LEASED;
- maintenance bug-hunter — FALSIFIER, READY;
- maintenance repairer — IMPLEMENTER, LEASED;
- maintenance verifier — CRITIC, LEASED;
- maintenance researcher — RESEARCHER, RUNNING.

The governor should therefore create a new task only for a gap not owned by those generic lanes.

## 5. Stalls and duplication disposition

### P0 — live continuity stall

The stale cycle-13 active wake is a proven live blocker. Do not issue/replay the wake. PR #140 is the current evidence-backed repair and is exact-head GREEN; independent critic/falsifier verification is still required before any promotion.

### P0 — lease admission vs trusted transport readiness

The scheduler can leave work LEASED on physical agents whose Browser lifecycle is `BOUND_UNVERIFIED`. This consumes lease time without a usable trusted transport path and tends to turn useful work into `LEASE_EXPIRED_EFFECT_UNKNOWN` ambiguity.

The required correction is not a second scheduler. It is a dependency-safe admission/sequencing contract between existing `devos_fleet` leasing and C5 transport promotion/readiness.

### P1 — installed-line transport convergence

PR #139 is the installed-runtime repair. PRs #134/#136/#137 are related C5 readiness/two-phase composition slices. They must converge into one runtime lineage rather than become independent promotion planes.

### P1 — promotion authority convergence

PR #138 closes a distinct authority gap and is not a substitute for #139. The trusted lease verifier wiring must be ordered so the resulting installed runtime has both exact actuation authority fencing and reliable two-phase transport.

### P2 — duplicate/superseded transport branch family

PR #133 (`exact Send focus + Enter`) is an older alternative to the stronger foreground two-phase path in #134/#136/#137/#139. Preserve it as evidence until the synthesizer/critic disposition proves it superseded; do not merge both submit strategies into runtime.

### P2 — historical stacked C5 PRs

PRs #119-#131 remain useful provenance for the C5 trust chain. Open status alone does not imply active work. Avoid creating tasks merely to repeat already-proven slices.

## 6. Global dependency/convergence order

Current safe order for the active critical path:

1. **Continuity retirement proof (#140)** — eliminate the live supervisor deadlock without replay.
2. **Trusted transport capacity/admission contract** — prevent leases from being consumed by non-ready incarnations; use only the existing scheduler.
3. **Installed two-phase dispatch (#139)** — retain exact foreground/readback semantics.
4. **Lease-gated C5 promotion (#138)** — wire trusted lease readback without reopening raw promotion.
5. **DBR1 core + Git hardening (#132 + #135)** — exact per-agent mutation workspace.
6. **DBR1 independent verification/synthesis** — historical ambiguous task state cannot self-certify the branches.
7. **DBR2 mutable IDE admission** — only after DBR1 exact workspace capability is independently accepted.
8. DBR3/DBR4 and later Browser OS milestones according to the registered hard dependency graph.

Parallel-safe work: research, critic/falsifier review, read-only IDE/code-intelligence planning, and evidence synthesis. Mutating successors remain dependency-gated.

## 7. Capacity policy

Use these distinct numbers:

- `physical_capacity`: live fleet-owned tabs;
- `bound_capacity`: exact tab/target/generation still present;
- `transport_ready_capacity`: lifecycle ACTIVE + fresh trusted transport proof;
- `runnable_capacity`: transport-ready agent with role-compatible runnable work and no active claim;
- `mutating_capacity`: runnable capacity additionally possessing the required exact mutation workspace/actuation fences.

Elastic reconcile may create/recover physical capacity, but task lease admission must not pretend BOUND_UNVERIFIED equals runnable capacity.

## 8. Follow-up task admission

One non-duplicative advisory follow-up is justified by fresh evidence:

`devos.fleet.capacity-admission.plan.g1`

Objective: define the smallest exact contract that prevents or immediately fail-closes task lease consumption by non-transport-ready Browser incarnations, while reusing the single existing DevOS scheduler and C5 promotion boundary. It must reconcile PRs #138/#139/#140, exact task/agent/tab/target/generation/lease identity, restart behavior and ambiguity semantics. Planning only; no production mutation or Browser effect.

No additional tasks are justified in this cycle because generic bug-hunter/repairer/verifier/researcher and meta-auditor/synthesizer lanes already exist.

## 9. Acceptance for next governor cycle

- Fresh heartbeat remains healthy and self-update remains non-failing.
- Cycle-13 continuity state is retired only by positive terminal/rebind proof; no wake replay.
- No successor task is marked RUNNING without exact transport proof.
- Existing LEASED tasks on BOUND_UNVERIFIED agents either obtain exact trusted readiness before effect or expire/fence without automatic replay.
- #140/#139/#138 exact heads remain independently GREEN after any movement.
- Any DBR1 promotion distinguishes branch implementation evidence from durable task terminal state.
- No governor-created follow-up duplicates an already-live semantic point.
- No self-approval, main merge, integration promotion, release publication, production DDL or arbitrary Browser actuation occurs.
