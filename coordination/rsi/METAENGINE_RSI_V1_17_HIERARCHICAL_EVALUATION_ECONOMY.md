# METAENGINE RSI V1.17 — Hierarchical Multi-Fidelity Evaluation Economy

Status: SOURCE IMPLEMENTED / STACKED ON V1.16 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-architecture-search-v1 @ 410247bb7c62fda10c64df4c930eb85d79b0cdab`

Implementation branch:

`work/metaengine-rsi-hierarchical-evaluation-economy-v1`

## Purpose

V1.16 opens the agent architecture itself to bounded search, but candidate evaluation is still the dominant cost.

V1.17 adds a precommitted multi-fidelity evaluation cascade so cheap evidence can reduce expensive evaluation volume without becoming promotion truth.

The core rule is:

`cheap evidence allocates evaluator budget; only full hidden holdout + later statistical confirmation may support promotion review`.

## Research mechanisms adopted

### SIFT — cheap judge signal before expensive benchmark evaluation

SIFT identifies candidate evaluation as the dominant recursive-self-improvement bottleneck and replaces many partial benchmark evaluations with a cheaper LLM-judge signal before spending the full benchmark budget.

METAENGINE already introduced cheap architecture triage in V1.16. V1.17 extends the idea into a full external evidence cascade:

`micro contracts -> targeted shard -> deep shard -> full hidden holdout`.

Cheap stages are scheduling evidence only.

Reference: Fu et al., *Self-Improvement via Fast Tree-Search*, ICLR 2026.

### Successive Halving / Hyperband — spend more resource on survivors

Successive Halving allocates a small initial resource to many candidates, removes weak candidates, and allocates exponentially more resource to survivors.

Hyperband generalizes this by considering different candidate-count/resource tradeoffs.

METAENGINE adopts the successive-halving resource principle, not the full Hyperband bracket algorithm in V1.17.

The reason is deliberate: V1.16 already supplies a guided architecture-search frontier, so random multi-bracket candidate sampling would duplicate the proposal side. V1.17 therefore focuses only on evaluation-budget allocation.

Reference: Li et al., *Hyperband: A Novel Bandit-Based Approach to Hyperparameter Optimization*, JMLR 2018 / arXiv:1603.06560.

### BOHB — combine guided search with multi-fidelity allocation

BOHB combines guided candidate search with Hyperband-style multi-fidelity evaluation.

METAENGINE reaches a similar decomposition through separate trusted planes:

- V1.16 = guided architecture proposal/search;
- V1.17 = multi-fidelity external evaluation scheduling.

The two planes remain independently typed and non-authoritative.

Reference: Falkner, Klein & Hutter, *BOHB: Robust and Efficient Hyperparameter Optimization at Scale*, ICML 2018 / arXiv:1807.01774.

### Archon — optimize quality under explicit inference cost

Archon formulates agent-system construction as architecture search under benchmark quality and inference-time cost.

METAENGINE V1.16 already made architecture cost explicit. V1.17 extends this into evaluation economics: each rung has a fixed resource unit cost and exact same-stage workload requirements.

Reference: Saad-Falcon et al., *Archon: An Architecture Search Framework for Inference-Time Techniques*, ICML 2025 / arXiv:2409.15254.

## Precommitted cascade

Default stages:

1. `MICRO_CONTRACTS`
   - resource units: 1
   - deterministic micro-contract evidence
   - broad candidate cohort

2. `TARGETED_SHARD`
   - resource units: 4
   - targeted benchmark shard

3. `DEEP_SHARD`
   - resource units: 12
   - deeper partial benchmark

4. `FULL_HOLDOUT`
   - resource units: 32
   - full hidden holdout
   - mandatory before archive admission or promotion review

The exact stage order, per-candidate resource budget and survivor caps are fixed in the plan before any stage result exists.

There is no adaptive stage-budget rewrite after observing candidate scores.

## Survivor scheduling

Scheduling policy:

`PRECOMMITTED_SUCCESSIVE_HALVING_WITH_BOUNDED_RESCUE_V1`

Each non-terminal stage reserves:

- exploitation slots ranked by lower confidence bound;
- bounded uncertainty-rescue slots;
- bounded novelty-rescue slots.

This is a deliberate correction to naive Successive Halving.

A weak early-fidelity measurement can prematurely eliminate a genuinely strong design. V1.17 therefore protects two failure modes:

### Uncertainty rescue

If an excluded candidate's upper confidence bound overlaps the selected exploitation cutoff, it can consume a precommitted uncertainty slot.

The candidate does not choose its uncertainty estimate.

### Novelty rescue

A low cheap-stage score can still survive through a precommitted novelty slot when it represents a structurally unusual architecture.

This prevents a cheap judge from collapsing the search to one familiar design family.

At least one exploitation slot is always preserved.

## Hard-invariant semantics

Hard-invariant failure is terminal at every rung.

A performance-stage stop is not equivalent to a safety or promotion rejection.

States include:

- `REJECT_HARD_INVARIANT`
- `STOP_EVALUATION_BUDGET`
- `ADVANCE_NEXT_FIDELITY`
- `FULL_HOLDOUT_COMPLETE`

`STOP_EVALUATION_BUDGET` means only:

> do not spend more evaluator compute on this candidate in this precommitted cascade.

It does not create a permanent negative promotion verdict.

## Exact resource accounting

Every external stage receipt binds:

- plan id/digest;
- stage id/ordinal;
- candidate genome id/digest;
- exact resource units consumed;
- exact stage workload digest;
- evaluator root digest;
- hidden holdout digest;
- performance score;
- uncertainty radius;
- novelty score;
- hard-invariant result;
- external evidence digest/refs.

A receipt consuming a different resource amount than the precommitted stage budget fails closed.

Every candidate active at a rung must supply exactly one receipt.

Missing or duplicate receipts invalidate the rung instead of silently biasing halving.

All candidates in the same rung must use one exact workload digest.

## Why cheap stages are not final truth

SIFT demonstrates that a strong judge can correlate with full benchmark performance at much lower cost, but such a proxy is still easier to game and noisier than full evaluation.

V1.17 therefore fixes:

- cheap_stage_is_final_promotion_verdict=false;
- full_hidden_holdout_required_before_archive_admission=true;
- full_hidden_holdout_required_before_promotion_review=true;
- statistical_confirmation_required_before_promotion_review=true.

V1.11 risk alpha is not spent at cheap stages.

Statistical risk begins only if a candidate survives the full holdout and escalates to confirmation.

## Evaluation ledger

`RsiHierarchicalEvaluationLedger`

maintains:

- exact current active candidate set;
- exact next stage;
- completed stage receipts/results;
- cumulative resource units;
- final full-holdout candidates.

The ledger does not execute candidates.

It only verifies externally produced evidence and allocates future evaluator budget.

## Example resource economy

For eight entrants with a final cap of two, the default schedule is:

- 8 × 1 = 8 units at MICRO_CONTRACTS;
- 4 × 4 = 16 units at TARGETED_SHARD;
- 2 × 12 = 24 units at DEEP_SHARD;
- 2 × 32 = 64 units at FULL_HOLDOUT.

Total: 112 units.

Evaluating all eight directly at full-holdout fidelity would cost:

8 × 32 = 256 units.

The example therefore spends less than half the full-holdout-only budget while still forcing finalists through the complete hidden holdout.

This is only an accounting example, not an empirical performance claim.

## Trust-root changes

`apps/metaengine-browser/src/rsi-hierarchical-evaluation-economy.mjs`

is added to:

- isolated candidate immutable paths;
- tournament trust root;
- promotion trust root.

A candidate cannot change its own halving policy, rescue policy, stage budgets or holdout requirements.

## Non-goals

V1.17 does not:

- make cheap judge output promotion truth;
- implement full Hyperband random brackets;
- infer uncertainty from candidate self-report;
- permit optional stopping;
- rewrite budgets after scores are observed;
- spend V1.11 statistical alpha during screening;
- execute Browser actions;
- create DevOS leases;
- mutate production;
- install or self-update.

## Next research direction — V1.18 skill/composition archive

The next useful mechanism is to stop evolving only whole architectures.

Voyager and related lifelong-agent systems show that reusable skill libraries can make later search more compositional.

A METAENGINE version should archive only externally verified, typed architecture fragments:

- retrieval subgraphs;
- reflection/verification subgraphs;
- model-routing motifs;
- tool-policy motifs;
- aggregation motifs.

A fragment should become reusable only after:
- exact provenance;
- component attribution;
- transfer validation;
- no authority-bearing tool surface;
- compatibility tests in the target architecture.

The candidate should never load arbitrary executable code from a “skill library”.
