# METAENGINE Meta Control Plane V1

## Goal

Create renewable L0 meta-agents that continuously supervise the entire development portfolio without introducing a second scheduler or allowing an LLM conclusion to become authority.

## External architecture evidence

- Anthropic multi-agent Research: orchestrator-worker pattern; a lead agent plans, delegates parallel subproblems and synthesizes results.
  Source: https://www.anthropic.com/engineering/multi-agent-research-system
- Anthropic long-running application harness (2026): planner / generator / evaluator separation; generator and evaluator negotiate explicit done criteria; an independent evaluator is easier to make skeptical than self-evaluation.
  Source: https://www.anthropic.com/engineering/harness-design-long-running-apps
- Anthropic parallel Claude teams (2026): renewable sessions, task claims/locks, specialized agents, high-quality tests and CI; explicit warning that parallelism collapses when all agents converge on one undivided task.
  Source: https://www.anthropic.com/engineering/building-c-compiler
- Anthropic Managed Agents (2026): decouple durable reasoning/session state (brain) from execution environments (hands); stable meta-harness interfaces allow many brains and many hands without coupling their failure domains.
  Source: https://www.anthropic.com/engineering/managed-agents
- Microsoft Magentic-One: an Orchestrator plans, tracks progress, chooses the next specialist and re-plans on errors; modular agents are replaceable.
  Source: https://www.microsoft.com/en-us/research/articles/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/
- LangGraph Supervisor: hierarchical supervisors can themselves be supervised by a top-level supervisor, with checkpointed state and long-term memory.
  Source: https://langchain-ai.github.io/langgraphjs/reference/modules/langgraph-supervisor.html
- OpenAI agent guidance: manager pattern for central orchestration; handoffs for decentralized transfer; guardrails and tracing are first-class requirements.
  Source: https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
- A2A Protocol: interoperable agents should expose capabilities and collaborate through durable task semantics rather than sharing hidden internal state.
  Source: https://a2a-protocol.org/latest/
- Temporal durable execution: long-running workflows need external durable state so execution can survive process failure and resume from exact workflow state.
  Source: https://temporal.io/

## Adopted topology

```text
L0 META CONTROL
  Meta-Governor       global dependency graph / priority / liveness / dispatch
  Meta-Auditor        independent falsification of Governor and all workers
  Meta-Synthesizer    global verified-state convergence and next-slice synthesis
            |
            v
L1 DOMAIN SUPERVISORS
  Browser / IDE / Fleet / Release / Continuity / other domain supervisors
            |
            v
L2 WORKERS
  Planner / Implementer / Researcher / Critic / Falsifier / Synthesizer
```

The hierarchy is logical, not a second scheduler hierarchy. Every L0/L1/L2 task is represented in the same durable `devos_fleet_task_h205f22` queue and uses the same lease/claim/fencing mechanisms.

## Hard rules

1. One scheduler authority: `devos_fleet_watchdog_h205f22` remains the only recurring DB scheduler.
2. Durable state lives outside model context. Agent chat history is convenience context, not project truth.
3. The Meta-Governor may create only typed DB-native follow-up tasks, with a bounded dispatch budget; it cannot directly authorize Browser effects or production promotion.
4. The Meta-Auditor is independent: it treats Governor, worker and page/model text as claims to falsify, not evidence.
5. The Meta-Synthesizer distinguishes PROPOSED / IMPLEMENTED / VERIFIED / PROMOTED. No model statement upgrades state by itself.
6. No agent may self-approve its own implementation or release evidence.
7. RESULT_READY and BLOCKED are open generations. A replacement generation must not race an unconsumed result.
8. AMBIGUOUS may create a reconciliation generation only under `reconcile_previous_before_effect=true` and `automatic_retry_after_ambiguous_effect=false`.
9. Every task has exact workspace/base/branch/task/lease identity. Physical browser effects additionally require exact tab/target/incarnation fencing.
10. Parallelism is driven by separable semantic work. When agents collapse onto one bottleneck, the Governor must decompose/falsify the bottleneck rather than increase agent count.

## Meta-Governor cycle

1. Re-read authoritative GitHub heads/PR/CI, Supabase tasks/leases/checkpoints and native Browser evidence.
2. Build a compact global state snapshot: active goals, dependency edges, blockers, ambiguity, stale tasks, capacity and verified progress.
3. Detect divergence: duplicated work, orphan branches, stalled RUNNING tasks, missing reviewer/evaluator, scheduler failures, repeated ambiguity, unsafe release drift.
4. Choose the smallest dependency-ordered next slices.
5. Enqueue at most the configured bounded number of typed tasks; never blindly replay an ambiguous effect.
6. Persist an evidence checkpoint and yield. Renewal is scheduler-driven, not an infinite prompt loop.

## Meta-Auditor cycle

- Independently reconstruct project state.
- Falsify Governor assumptions and completion claims.
- Check one-scheduler invariant, lease fencing, task/base/branch binding, transport proof, CI/eval quality and release gates.
- Detect task explosions, circular dependencies and repeated no-progress generations.
- Emit blockers or negative-test work, but do not self-promote fixes.

## Meta-Synthesizer cycle

- Merge only evidence-backed worker/domain conclusions.
- Resolve conflicts between Planner/Implementer/Critic/Falsifier evidence.
- Maintain a compact current-state checkpoint and dependency order.
- Recommend the next global slices and explicit promotion gates.

## Current P0 discovered while implementing this slice

The live cron runs `devos_fleet_watchdog_h205f22` every 30 seconds, but the function referenced non-existent `destruktion_meta.devos_supervisor_mesh_instance_h205f22`. The authoritative table is `public.compute_fabric_a2_supervisor_mesh_instance_h205f22`; its allowed statuses also do not include the stale `STANDBY` value. As a result, every watchdog cycle failed before fleet reconcile/refill. Migration `20260831163500_devos_meta_control_plane_v1.sql` repairs this drift, makes the optional mesh check non-fatal, adds renewable meta lanes, and prevents duplicate refill while a prior generation is RESULT_READY or BLOCKED.

## Next slices

- Add a typed `META_DISPATCH` RPC that enforces per-cycle task budgets and semantic duplicate suppression in SQL, rather than relying only on prompt policy.
- Add durable global project checkpoints with dependency edges and evidence references.
- Add progress-SLO metrics: oldest RUNNING age, ambiguity rate, verified-progress velocity, duplicate-work ratio, scheduler error streak and worker utilization.
- Route domain supervisors through explicit capability descriptors compatible with A2A-style agent cards while keeping current DB-native identity/fencing authoritative.
- Add shadow-mode evaluation comparing meta-governor decisions against a no-governor baseline before granting broader dispatch authority.
