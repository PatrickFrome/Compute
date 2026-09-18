# METAENGINE RSI V1.20 — Hierarchical Evaluation Economy

Status: SOURCE IMPLEMENTED / STACKED ON V1.19 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-trace-guided-harness-repair-v1 @ 6864db050e2ad0d296b8a79c89ee92f1e7ce7e62`

Implementation branch:

`work/metaengine-rsi-evaluation-economy-v1`

## Purpose

Full benchmark evaluation is now one of the dominant costs in recursive self-improvement.

V1.20 introduces a hierarchical multi-fidelity evaluation cascade that spends expensive evidence only on survivors while preserving METAENGINE's existing hard-invariant, holdout and statistical-confirmation boundaries.

## Research basis

### SIFT

SIFT identifies candidate evaluation as the main bottleneck in self-improving coding agents and uses a strong LLM judge to rank patches cheaply, reserving expensive benchmark runs for promising candidates.

METAENGINE adopts the judge only as a **compute-allocation signal**.

A cheap judge can never:

- archive a candidate;
- promote a candidate;
- replace hidden holdout evaluation;
- replace hard invariants.

Reference: Fu et al., *Self-Improvement via Fast Tree-Search*, ICLR 2026.

### Hyperband / Successive Halving

Hyperband frames configuration search as adaptive resource allocation and early stopping. Successive Halving gives progressively more resources to stronger candidates.

METAENGINE adopts staged resource allocation, but does not assume low-fidelity score is final truth.

Reference: Li et al., *Hyperband: A Novel Bandit-Based Approach to Hyperparameter Optimization*, JMLR 2018.

### Multi-fidelity experiment automation

Recent multi-fidelity work shows that cheap experiments can teach agents how to configure expensive experiments, but extrapolation needs explicit fidelity boundaries.

METAENGINE therefore binds every stage to its own budget and workload digest.

### Harness-evolution evaluation critique

Recent 2026 results show harness evolution may overfit searched benchmarks or gain from extra inference/search budget rather than better harness design.

V1.20 therefore keeps:

- exact hidden full holdout;
- matched-budget baseline;
- separate statistical confirmation before promotion review.

## Cascade

The stage order is fixed:

1. `STATIC_CONTRACT`
2. `MICRO_TESTS`
3. `LLM_JUDGE_TRIAGE`
4. `TARGETED_SHARD`
5. `FULL_HOLDOUT`

Only `FULL_HOLDOUT` is high-fidelity.

Every earlier stage has:

- low_fidelity=true;
- archive authority=false;
- promotion authority=false.

## Stage receipts

`metaengine.rsi.evaluation-stage-receipt.v1`

Every receipt binds:

- candidate id/SHA;
- policy digest;
- stage/fidelity rank;
- evaluator-root digest;
- workload digest;
- bounded cost units;
- hard-invariant status;
- stage pass/fail;
- score;
- novelty score;
- matched-budget delta;
- external evidence refs.

Candidate-authored receipts are rejected.

A stage cannot consume more than its configured cost ceiling.

## Compute allocation

`createRsiEvaluationStageDecision()`

Selection uses:

- score-based exploitation;
- bounded novelty exploration.

The exploration escape hatch prevents a cheap proxy from permanently suppressing unusual candidates before high-fidelity evidence exists.

Low-fidelity selected candidates receive only:

`ALLOCATE_NEXT_FIDELITY`

That is not scheduler, archive or promotion authority.

## Hard invariant precedence

A candidate that fails hard invariants is rejected even if:

- judge score is maximal;
- novelty is maximal;
- it is otherwise cheap to evaluate.

Proxy score never overrides safety evidence.

## Workload separation

`TARGETED_SHARD` and `FULL_HOLDOUT` use separate exact digests.

Aliasing the targeted shard and hidden holdout is forbidden.

This prevents the search workload from becoming the final generalization test.

## Full holdout boundary

A full holdout pass can produce only:

`FULL_HOLDOUT_PASS_FOR_ARCHIVE_REVIEW`

It still has:

- promotion review=false;
- promotion authority=false;
- self-update authority=false.

Promotion requires the separate V1.11 statistical confirmation and the existing promotion gate.

## Why no aggressive low-fidelity auto-pruning authority

Low-fidelity signals are imperfect. A cheap judge can mis-rank slow-starting or unconventional candidates.

V1.20 therefore:

- preserves a novelty exploration slot;
- treats low-fidelity stages as budget allocation only;
- requires full external holdout before archive review;
- keeps statistical confirmation separate.

## Trust root

`apps/metaengine-browser/src/rsi-hierarchical-evaluation-economy.mjs`

is added to:

- isolated candidate immutable paths;
- tournament trust root;
- promotion trust root.

## Non-goals

V1.20 does not:

- let a judge become evaluator authority;
- let the candidate choose its fidelity stage;
- let the candidate choose its budget;
- let the candidate choose survivors;
- schedule DevOS work;
- execute Browser actions;
- archive/promote from low fidelity;
- replace V1.11 risk control.

## Next useful slice

V1.21 should combine this cascade with asynchronous island evaluation:

- independent search islands;
- bounded migration of verified candidates/experience;
- per-island evaluation budgets;
- no global synchronization barrier on every generation;
- one existing scheduler and one immutable evaluator root.

This can borrow OpenEvolve's island/MAP-Elites mechanics without adding a second scheduler.
