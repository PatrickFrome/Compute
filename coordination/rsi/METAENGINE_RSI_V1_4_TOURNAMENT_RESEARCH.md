# METAENGINE RSI V1.4 — BrowserCell Shadow Tournament and Evolution Archive

Status: IMPLEMENTATION CHECKPOINT / SHADOW ONLY / NO LIVE AUTHORITY

Base RSI head before this slice: `314488074cdd8a3df7e42df17f4e433f203b3031`

Branch: `work/metaengine-rsi-v1-shadow`

## Purpose

RSI V1.4 adds the selection layer between `SHADOW_QUALIFIED` candidates and any future external promotion gate.

It does **not** add a scheduler, Browser executor, self-update path, production mutation path, or model-decided promotion. It reuses existing METAENGINE execution/evidence surfaces:

- Amplifier Tournament for paired baseline/candidate experiment discipline.
- Windows Autonomous Soak for exact-head, deterministic seeded chaos, 128 BrowserCells / 128 agents, fleet scale, and installed package soak.
- Installed Chat Qualification and the existing Browser qualification workflows for physical/runtime evidence.
- V1.3 Immutable Evaluator Mesh for hard-invariant qualification.

The V1.4 layer is a deterministic admission and archive contract over evidence produced by those existing runners.

## Research synthesis

The implementation is intentionally based on several complementary results.

### Darwin Gödel Machine

DGM keeps a growing archive/tree of diverse coding agents and samples parents from that archive rather than repeatedly replacing one incumbent. The important METAENGINE implication is that a candidate which is not the single best current point can still be a useful stepping stone for later descendants.

Source: Zhang et al., *Darwin Gödel Machine: Open-Ended Evolution of Self-Improving Agents*, arXiv:2505.22954.

### AlphaEvolve

AlphaEvolve combines proposal generation, automated evaluators, and a programs database used by the evolutionary loop. The useful pattern is the separation between generator and evaluator/database authority.

Source: Google DeepMind, *AlphaEvolve: A Gemini-powered coding agent for designing advanced algorithms*, 2025.

### Quality-Diversity / MAP-Elites

MAP-Elites explicitly preserves multiple high-performing solutions across behavioral niches instead of collapsing search to one scalar optimum. This protects stepping stones and gives a more informative search landscape.

Source: Mouret & Clune, *Illuminating search spaces by mapping elites*, 2015.

### WebArena-Verified and BrowserGym / AgentLab

WebArena-Verified replaces LLM-as-judge evaluation with deterministic structural/network-trace evaluation and version-controlled tasks. BrowserGym/AgentLab emphasize reproducibility metadata, benchmark/runtime versions, seeds, and scalable parallel experiments.

METAENGINE therefore binds tournament evidence to exact workload digests, a holdout digest, environment fingerprint, precommitted seeds, and deterministic evaluator identity.

Sources:
- ServiceNow, `webarena-verified`
- ServiceNow, `BrowserGym`
- ServiceNow, `AgentLab`

### Benchmark contamination and evaluator gaming

Public benchmarks can stop measuring the desired capability when their tasks/solutions become contaminated or when optimizers adapt to evaluator quirks. For recursive improvement the risk is stronger because the optimizer repeatedly sees its own evaluation outcomes.

METAENGINE therefore treats benchmark identity/evaluator identity as trust-root material, keeps holdout manifests hidden from candidate code, forbids early stopping, and does not expose one authoritative scalar reward.

Reference: OpenAI, *Why SWE-bench Verified no longer measures frontier coding capabilities*, 2026.

## V1.4 design

### 1. Precommitted paired tournament

Each tournament plan is exact-bound to:

- exact candidate SHA and parent SHA;
- exact V1.2 handoff digest;
- exact V1.3 evaluator result digest;
- evaluator-root digest;
- workload-suite digest;
- separate holdout digest;
- environment fingerprint;
- odd fixed pair count;
- deterministic precommitted seed schedule;
- deterministic alternating incumbent/candidate order schedule.

`early_stop_allowed=false`.

A candidate therefore cannot stop after favorable runs, choose seeds after seeing outcomes, or run against a different holdout without invalidating the receipt.

### 2. Required multi-objective measurements

Required in V1.4:

- `task_success_rate` / maximize;
- `p95_latency_ms` / minimize;
- `peak_rss_bytes` / minimize;
- `recovery_p95_ms` / minimize.

Optional when available:

- `tokens_per_success` / minimize.

Materiality thresholds are fixed in the trusted tournament root. Results preserve each objective independently.

There is no authoritative weighted sum and `scalar_winner=null`.

### 3. Hard invariants remain dominant

Every paired receipt carries the six V1 hard-invariant results. A single failed pair for any invariant makes the tournament relation `REJECTED_HARD_INVARIANT` regardless of performance.

This preserves R4/R5/R6 one-attempt and ambiguity semantics and prevents performance gains from buying authority regressions.

### 4. Pareto relation

The tournament emits one of:

- `PARETO_ADVANCE`
- `TRADEOFF_STEPPING_STONE`
- `NO_MEASURED_ADVANCE`
- `REJECTED_HARD_INVARIANT`

The relation is evidence classification only. It does not authorize promotion.

### 5. Evolution archive

`RsiEvolutionArchive` stores exact lineage and tournament results without scalar ranking.

Within an identical workload/environment context:

- a non-dominated candidate becomes `PARETO_ELITE`;
- a globally dominated candidate in a **distinct behavioral niche** may remain active as `STEPPING_STONE`;
- a candidate dominated by an active candidate in the **same niche** becomes `DOMINATED`;
- non-advancing/rejected results are `NOT_ADMITTED`.

A behavioral niche is derived from trusted evidence, not chosen by the candidate:

`task_class + mutation_surface + vector(objective status)`

The archive is bounded. If a niche/archive reaches its bound and no same-niche dominated entry can be displaced, admission fails closed rather than silently applying a scalar pruning rule.

### 6. Existing runners only

V1.4 does not execute BrowserCells.

Future physical shadow execution should route through existing exact-head runners/qualification paths. The tournament layer only validates and compares their externally ingested receipts.

This avoids a second scheduler, a second Browser executor, and a second physical-effect semantics.

## Security / anti-gaming properties

- holdout task manifest is not exposed to candidate code;
- suite and holdout digests must differ;
- exact pair count is precommitted;
- seeds are precommitted;
- run order is precommitted and balanced;
- candidate-authored receipts are forbidden by contract;
- external-origin verification is explicitly the responsibility of trusted ingest;
- tournament/evaluator/candidate-verification paths are tournament trust-root material;
- scalar reward is not authoritative;
- hard invariant failure overrides every metric;
- no tournament result has execution, production mutation, promotion, self-update, or retry authority.

## Known boundary for V1.5

V1.4 still consumes an assertion that evidence arrived through trusted external ingest; it does not itself cryptographically authenticate GitHub/Supabase/Browser physical evidence.

V1.5 should therefore implement an **External Promotion Gate / Attested Evidence Ingest** that verifies source-native attestations/readback before any candidate can become promotion-eligible. The gate must remain outside the candidate mutation domain.

Until V1.5 exists and is independently verified:

`SHADOW_QUALIFIED -> tournament/archive`

is allowed, while

`tournament/archive -> production/self-update`

remains forbidden.
