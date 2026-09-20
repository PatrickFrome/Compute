# METAENGINE RSI V1.22 — Proxy Reliability Calibration

Status: SOURCE IMPLEMENTED / STACKED ON V1.21 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-async-island-portfolio-v1 @ 85be3089f1d8215f7e5d74645aae3f28f4ad4a97`

Implementation branch:

`work/metaengine-rsi-proxy-calibration-v1`

## Purpose

V1.20 deliberately introduced low-fidelity evaluation signals such as LLM judge triage and targeted shards to save expensive evaluator compute.

That optimization is only safe while those proxies remain predictive of the hidden full holdout.

V1.22 adds an independent reliability layer:

`proxy receipt + hidden full-holdout receipt -> calibration snapshot -> bounded compute-allocation guidance`

A proxy that drifts, becomes anti-correlated or lacks enough evidence loses pruning power automatically.

## Research basis

### SIFT

SIFT identifies candidate evaluation as the dominant cost in recursive coding-agent self-improvement and replaces repeated partial benchmark execution with a cheaper LLM-as-a-judge signal for ranking, while reserving expensive benchmark evaluation for the most promising candidates.

METAENGINE adopts the evaluation-economy principle but treats every cheap judge as a noisy proxy whose predictive quality must itself be measured against hidden full holdout outcomes.

Reference: Fu, Kulanthaivelu & Yamada, *Self-Improvement via Fast Tree-Search*, ICLR 2026.

### Active learning / query by committee

Active-learning systems use uncertainty or disagreement as acquisition signals, but modern reviews emphasize that those signals are proxies for information value and can be miscalibrated or distorted under distribution shift.

V1.22 applies the same lesson to RSI evaluation proxies: a useful proxy is not assumed permanently useful.

### Reliability metrics

V1.22 records multiple complementary diagnostics instead of one scalar:

- pairwise rank concordance / Kendall-like ordering agreement;
- Brier calibration error;
- false-positive rate;
- Wilson 95% upper bound on false-positive rate;
- recent-vs-prior Brier drift;
- controlled intervention cases.

A proxy must pass both ordinary paired holdout evidence and a minimum number of intervention cases before aggressive pruning can be enabled.

## Policy

Schema:

`metaengine.rsi.proxy-calibration-policy.v1`

Calibrated proxy stages:

- `LLM_JUDGE_TRIAGE`
- `TARGETED_SHARD`

Every policy exact-binds:

- proxy identity digest;
- hidden full holdout digest;
- controlled intervention suite digest;
- minimum paired sample count;
- pass thresholds;
- concordance thresholds;
- false-positive upper bound;
- Brier limit;
- recent drift window and drift threshold.

The candidate cannot choose calibration pairs, change thresholds or set its own proxy weight.

## Paired evidence

Schema:

`metaengine.rsi.proxy-holdout-pair.v1`

Every row binds the same candidate to:

- proxy score;
- hidden full-holdout score;
- proxy receipt digest;
- full-holdout receipt digest;
- evaluator root;
- optional intervention case;
- exact evidence refs.

Candidate-authored pairs are forbidden.

## Reliability states

Schema:

`metaengine.rsi.proxy-reliability-snapshot.v1`

Possible states:

- `CALIBRATED`
- `DEGRADED`
- `UNRELIABLE`
- `INSUFFICIENT_EVIDENCE`

Recent degradation can force `UNRELIABLE` even if older all-time history looked strong.

This prevents stale historical calibration from masking proxy drift.

## Allocation guidance

Schema:

`metaengine.rsi.proxy-allocation-guidance.v1`

The guidance changes only evaluation-compute allocation.

Typical behavior:

- CALIBRATED -> normal proxy pruning, lower forced-full-evaluation fraction;
- DEGRADED -> conservative pruning and more exploration;
- UNRELIABLE -> proxy weight zero, pruning disabled, forced full evaluation increased;
- INSUFFICIENT_EVIDENCE -> aggressive pruning disabled.

Even a CALIBRATED state is not archive, scheduler or promotion authority.

## Why this matters

Without V1.22, V1.20 could gradually optimize the RSI search process around a proxy that stopped matching the real hidden objective.

With V1.22:

`cheap proxy saves compute only while hidden evidence keeps proving it predictive`.

This is especially important for LLM judges, which may drift after model changes, prompt changes, task-distribution changes or candidate adaptation.

## Trust root

`apps/metaengine-browser/src/rsi-proxy-reliability-calibration.mjs`

is immutable to candidates and included in candidate/tournament/promotion trust roots.

## Non-goals

V1.22 does not:

- make a proxy a final evaluator;
- let candidate-generated labels calibrate the proxy;
- execute Browser actions;
- create scheduler tasks or leases;
- mutate production;
- authorize archive admission, promotion, installation or self-update.

## Next direction

The next RSI layer should increase recursive reasoning depth without expanding the mutable authority surface.

Meta^n suggests a strong mechanism: keep the meta-operation fixed while recursively feeding it richer products/traces from the layer below. METAENGINE can use that idea to build deeper strategy/helper layers while keeping evaluator, promotion, scheduler and self-update roots immutable.
