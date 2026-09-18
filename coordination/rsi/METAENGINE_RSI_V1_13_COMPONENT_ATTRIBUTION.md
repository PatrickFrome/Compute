# METAENGINE RSI V1.13 — External Component Attribution

Status: SOURCE IMPLEMENTED / STACKED ON V1.12 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-adversarial-curriculum-v1 @ 6d55698d78a499540e92f738f1003840b280bfb2`

Implementation branch:

`work/metaengine-rsi-component-attribution-v1`

## Purpose

V1.10 introduced structured experience memory. V1.12 introduced externally generated hidden curriculum. The remaining credit-assignment defect is that a successful multi-file candidate can easily over-credit every changed component.

That poisons recursive learning: future generations may preserve or imitate a component merely because it co-occurred with a successful candidate.

V1.13 moves component credit outside the candidate and requires matched external ablations before a changed component can become trusted causal experience.

## Research mechanisms adopted

### AgentEvolver — self-attribution

AgentEvolver combines self-questioning, self-navigating and self-attributing mechanisms to improve exploration efficiency. The self-attribution direction is especially relevant to METAENGINE: reuse is more sample-efficient when the system can distinguish which parts of a successful trajectory actually mattered.

METAENGINE adopts the attribution goal but not candidate-authored causal authority.

Reference: Zhai et al., *AgentEvolver: Towards Efficient Self-Evolving Agent System*, arXiv:2511.10395.

### GEPA — rich reflective feedback beats sparse scalar credit

GEPA learns high-level rules by reflecting on full trajectories and combines complementary lessons from the Pareto frontier. It reports strong sample efficiency relative to scalar-reward optimization.

METAENGINE adopts the lesson that rich evidence should inform future search instead of compressing every result to one scalar. V1.13 therefore preserves per-objective contribution vectors and explicit tradeoffs.

Natural-language reflection may be useful upstream, but it never becomes attribution authority.

Reference: Agrawal et al., *GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning*, arXiv:2507.19457.

### AEL — memory quality depends on using experience correctly

AEL's two-timescale experiments suggest that more mechanisms are not automatically better: memory plus diagnostic reflection helped, while several added credit-assignment/planner mechanisms degraded performance in its benchmark.

METAENGINE therefore keeps V1.13 deliberately narrow: matched single-component ablation only. It does not claim arbitrary causal discovery from correlations or model narratives.

Reference: Xu et al., *AEL: Agent Evolving Learning for Open-Ended Environments*, arXiv:2604.21725.

## Contract

Primary implementation:

`apps/metaengine-browser/src/rsi-component-attribution.mjs`

### Attribution plan

`metaengine.rsi.component-attribution-plan.v1`

The plan is exact-bound to:

- candidate capsule/id/SHA;
- parent SHA;
- candidate handoff digest;
- workload digest;
- hidden holdout digest;
- environment fingerprint;
- paired seed schedule digest;
- all changed components;
- objective directions and materiality thresholds.

Every changed component receives one required ablation id.

The candidate cannot choose which component is tested and early stopping is forbidden.

### Matched external ablation

`metaengine.rsi.component-ablation-receipt.v1`

For each component, the external evaluator compares:

`full candidate`

with

`same candidate minus one changed component`

under the same workload, holdout, seed schedule and environment.

The receipt carries:

- exact component path/digest/change;
- ablated candidate SHA;
- full and ablated hard-invariant maps;
- objective vectors;
- external evidence refs;
- digest-bound attribution classification.

### Classification

V1.13 emits one of:

- `SAFETY_CRITICAL`
- `CONTRIBUTING`
- `HARMFUL`
- `TRADEOFF_INTERACTION`
- `NO_MATERIAL_EFFECT`

Hard-invariant regressions dominate scalar/objective gains and become `SAFETY_CRITICAL`.

If one objective improves while another materially worsens, the result is `TRADEOFF_INTERACTION`, not a scalar winner.

Interaction claims require separate evidence.

### Final result

`metaengine.rsi.component-attribution-result.v1`

The finalizer requires one exact external receipt for every changed component. Missing or duplicate receipts fail closed.

Attribution records remain:

- external only;
- candidate-authored=false;
- freeform narrative absent from trusted memory;
- zero execution/promotion/self-update authority.

## Trust-root changes

`rsi-component-attribution.mjs` is added to:

- isolated candidate immutable paths;
- tournament trust root;
- promotion trust root.

A candidate cannot improve apparent attribution by editing the attribution policy itself.

## Why this matters to recursive improvement

Before V1.13:

`candidate succeeded -> all changed components look useful`

After V1.13:

`candidate succeeded -> each component must survive matched external ablation before receiving positive credit`

This should reduce cargo-cult mutations, memory pollution and archive drift.

## Non-goals

V1.13 does not:

- prove arbitrary causality;
- infer causal contribution from LLM prose;
- allow candidate-authored attribution;
- evaluate hidden multi-component interactions without a separate experiment;
- compress tradeoffs into one scalar winner;
- promote/install a candidate;
- execute Browser actions;
- create DevOS leases;
- deploy DDL or Edge code.

## Next slice — V1.14 group experience exchange

The next high-value mechanism is to stop treating every evolutionary branch as an isolated learner.

Current research on Group-Evolving Agents shows that explicit experience sharing across evolving agents can convert exploratory diversity into sustained progress more efficiently than isolated tree branches.

METAENGINE V1.14 should share only externally verified typed lessons/attributions across compatible branches, with exact provenance and transfer tests. No raw model narrative or branch-local authority should cross the boundary.
