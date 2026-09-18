# METAENGINE RSI V1.16 — Bounded Agent Architecture Search

Status: SOURCE IMPLEMENTED / STACKED ON V1.15 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-adaptive-retrieval-v1 @ 6ced5f4338e2cb164de3b22b441027a013ee6fd3`

Implementation branch:

`work/metaengine-rsi-architecture-search-v1`

## Purpose

Previous RSI generations improve search, memory, curriculum, attribution and risk control around a candidate architecture.

V1.16 opens the **agent architecture itself** to search while keeping evaluator, promotion, scheduler, signing and self-update machinery outside the mutation surface.

The search space is intentionally narrower than arbitrary self-modifying code:

- prompt topology;
- model-role routing;
- verified-memory retrieval;
- structured reflection;
- tool-policy composition;
- bounded orchestration;
- aggregation/verification layout;
- inference-time compute budget.

It explicitly excludes authority roots.

## Research mechanisms adopted

### Automated Design of Agentic Systems (ADAS)

ADAS formalizes agent design as search over:

1. an agentic-system search space;
2. a search algorithm;
3. an evaluation function.

Meta Agent Search uses an LLM meta-agent to invent agent systems in code and maintain an archive of discoveries. The work reports transfer across domains and models.

METAENGINE adopts architecture search and archive compatibility, but the mutation representation is a typed graph instead of arbitrary executable source.

Reference: Hu, Lu & Clune, *Automated Design of Agentic Systems*, ICLR 2025 / arXiv:2408.08435.

### Gödel Agent / STOP

Gödel Agent demonstrates recursive modification of agent logic. STOP shows that an LM-infused scaffolding program can improve its own improver and can discover search strategies such as beam search, genetic algorithms and simulated annealing.

METAENGINE adopts the idea that the **improver/scaffold** itself should be searchable, but does not allow a candidate to rewrite the trusted evaluator or control roots.

References:
- Yin et al., *Gödel Agent: A Self-Referential Agent Framework for Recursive Self-Improvement*, arXiv:2410.04444.
- Zelikman et al., *Self-Taught Optimizer (STOP): Recursively Self-Improving Code Generation*, arXiv:2310.02304.

### SIFT — cheap proposal signal before expensive evaluation

SIFT identifies full benchmark evaluation as the major cost bottleneck in coding-agent self-improvement and uses a cheaper LLM judge to prioritize which tree nodes deserve full evaluation.

METAENGINE adopts a cheap triage stage, but the LLM judge is explicitly:

- not a full evaluator;
- not a promotion authority;
- unable to archive/promote a candidate by itself.

The full trusted benchmark remains mandatory.

Reference: *SIFT: Self-Improvement via Fast Tree Search*, ICLR 2026.

### Archon — architecture search on a cost/quality Pareto frontier

Archon searches combinations of inference-time techniques and models under compute budgets and reports improved quality/cost frontiers.

METAENGINE adopts explicit cost dimensions and Pareto selection:

- model calls;
- total tokens;
- parallelism;
- wall time;
- cheap quality proxy.

Reference: Saad-Falcon et al., *An Architecture Search Framework for Inference-Time Techniques*, ICML 2025.

### Meta^n — keep the meta-operation fixed

Meta^n argues for keeping a meta-operation fixed while recursively operating over richer inputs, avoiding the instability of recursively rewriting the entire improvement mechanism.

METAENGINE uses the same safety direction: the architecture-search policy itself is immutable to candidate architectures.

Reference: Kim et al., *Meta^n: Recursive Self-Improvement through Emergent Depth*, arXiv:2608.24735.

## Architecture genome

Schema:

`metaengine.rsi.agent-architecture-genome.v1`

Representation:

`TYPED_ACYCLIC_AGENT_GRAPH_WITH_BOUNDED_LOCAL_ITERATION`

Allowed node types:

- `INPUT_CONTEXT`
- `RETRIEVE_VERIFIED_MEMORY`
- `PLAN`
- `MODEL_CALL`
- `REFLECT_STRUCTURED`
- `TOOL_POLICY`
- `VERIFY_LOCAL`
- `AGGREGATE`
- `OUTPUT`

The graph must be acyclic. Bounded local iteration is represented as a per-node limit rather than an unbounded graph loop.

Model roles are abstract:

- `FAST`
- `DEEP`
- `DIVERSE`

Tool-policy capability classes are limited to:

- `READ_ONLY`
- `MUTATION_PROPOSAL`

There is no direct tool execution in the architecture genome.

Prompt content is represented by a digest, not by authority-bearing raw text.

## Immutable architecture boundary

Every genome carries:

- evaluator_root_mutable=false;
- promotion_root_mutable=false;
- scheduler_authority_mutable=false;
- signing_root_mutable=false;
- self_update_root_mutable=false;
- arbitrary_code_execution_surface=false;
- candidate_can_modify_meta_search_policy=false.

This is the core difference between METAENGINE architecture evolution and unconstrained self-editing.

## Mutation plans

Schema:

`metaengine.rsi.agent-architecture-mutation-plan.v1`

Allowed operations:

- `ADD_NODE`
- `REMOVE_NODE`
- `MODIFY_NODE`
- `ADD_EDGE`
- `REMOVE_EDGE`

Operations bind to digest-addressed payloads. The plan itself cannot materialize code or evaluate/promote the result.

A meta-agent may propose the plan, but is external to the candidate being modified.

## Cheap triage

Schema:

`metaengine.rsi.agent-architecture-triage-receipt.v1`

Triage carries:

- structural novelty score;
- cheap judge score;
- estimated evaluation cost;
- exact evidence digest/refs.

The contract explicitly states:

- cheap_signal_only=true;
- llm_judge_is_full_evaluator=false;
- llm_judge_is_promotion_authority=false;
- full_benchmark_still_required=true;
- exploration_escape_hatch_required=true.

## Full-evaluation admission

`selectRsiArchitecturesForFullEvaluation()`

The selector combines:

1. cost/quality Pareto-front exploitation;
2. bounded novelty exploration.

Exploration is mandatory when configured so a cheap judge cannot permanently suppress unconventional designs.

Selected states are only:

`ADMIT_FULL_EXTERNAL_EVALUATION`

This is not execution or promotion authority. It is a typed request to the existing trusted evaluation plane.

Every decision still requires a full benchmark before:

- archive admission;
- promotion review.

## Why a cheap judge cannot be final truth

A weak/cheap judge is useful for allocating evaluation budget, but it is also easier to game and noisier than the full evaluator.

Therefore V1.16 lets the judge answer only:

> Which architectures are worth spending expensive evaluator compute on?

It cannot answer:

> Which architecture is safe or promotable?

## Relationship to earlier RSI layers

The intended loop is now:

`V1.10 open-ended parent search`
→ `V1.14/V1.15 verified experience reuse`
→ `V1.16 architecture proposal/search`
→ isolated candidate materialization
→ hidden curriculum / full evaluator
→ V1.13 component attribution
→ V1.11 statistical confirmation
→ external promotion review.

V1.16 changes the search object, not the trust boundary.

## Non-goals

V1.16 does not:

- execute arbitrary architecture code;
- expose shell/eval;
- mutate evaluator/security/promotion roots;
- create a scheduler;
- let a cheap LLM judge promote a design;
- install/self-update;
- directly run Browser mutations;
- treat prompt/model output as authority.

## Next slice — V1.17 hierarchical evaluation economy

The next useful mechanism is to make evaluation itself more sample-efficient without weakening evidence:

- static structural rejection;
- deterministic micro-contract tests;
- cheap external judge triage;
- partial targeted benchmark shards;
- full holdout only for survivors;
- statistical confirmation only for promotion candidates.

This should be implemented as a cost-aware cascade with exact provenance and no stage allowed to substitute for a later required stage.
