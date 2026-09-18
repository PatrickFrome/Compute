# METAENGINE RSI V1.23 — Fixed-Operator Recursive Depth

Status: SOURCE IMPLEMENTED / STACKED ON V1.22 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-proxy-calibration-v1 @ 83abcc9c75ce84f00f3efa3ad033687949647118`

Implementation branch:

`work/metaengine-rsi-recursive-depth-v1`

## Purpose

Earlier RSI generations improve search, curriculum, evaluation economy, memory use, architecture search and risk control.

V1.23 adds a different capability: **deeper recursive strategy formation without making the recursive improvement operator itself mutable**.

The mechanism follows the core idea of Meta^n:

`fixed meta-operation Ω + recursively growing input -> deeper strategic layers`

instead of:

`self-edit the meta-operation itself`.

This gives recursive depth while keeping the trusted improvement kernel stable.

## Research basis — Meta^n

Meta^n keeps its meta-operation fixed and repeatedly applies it to its own products. Each new layer reads the accumulated solver traces and prior generated layers, then emits a higher-level strategic pre-process and helper library. Depth is chosen by convergence rather than hard-coded in advance, and an evolutionary archive can search over layer chains.

METAENGINE adopts those mechanics with stronger evidence boundaries:

- one exact immutable meta-operator digest;
- strictly growing typed context;
- prior layer products reused as input;
- new trace evidence required at every layer;
- strategic preprocessing + bounded helper library;
- external hidden-holdout evaluation at every depth;
- externally determined convergence/stop state;
- archive search over layer chains;
- no tool/scheduler/promotion/self-update authority inside helpers.

Reference: Kim et al., *Meta^n: Recursive Self-Improvement through Emergent Depth*, arXiv:2608.24735.

## Fixed meta-operation policy

Schema:

`metaengine.rsi.recursive-depth-policy.v1`

Every policy exact-binds:

- fixed meta-operator digest;
- evaluator-root digest;
- base-solver digest;
- hard maximum depth;
- convergence patience;
- minimum marginal quality gain;
- maximum tolerated cost-growth ratio.

The hard maximum is only a safety cap. Actual depth is chosen from external convergence evidence.

The candidate cannot:

- mutate Ω;
- choose depth;
- edit the convergence rule;
- widen helper authority.

## Recursive layer

Schema:

`metaengine.rsi.recursive-depth-layer.v1`

Depth `d` binds:

- exact chain id;
- previous layer digest;
- all prior layer digests;
- newly observed trace digests;
- accumulated typed context digests;
- input-bundle digest;
- strategy digest;
- bounded helper-library manifest;
- same immutable meta-operator digest.

Input must strictly grow. Re-emitting an equivalent layer without additional context is rejected.

## Helper library boundary

Allowed helper kinds:

- STRATEGY_PREPROCESSOR
- VERIFIED_MEMORY_SELECTOR
- PLAN_TRANSFORM
- TRACE_SUMMARIZER
- LOCAL_VERIFIER
- PROPOSAL_HELPER

Forbidden capabilities include:

- direct tool execution;
- shell/eval/process execution;
- network authority;
- scheduler authority;
- promotion authority;
- self-update authority;
- signing authority.

Helpers are proposal/strategy artifacts, not an execution plane.

## External depth evaluation

Schema:

`metaengine.rsi.recursive-depth-evaluation.v1`

Every depth is evaluated by the same external evaluator root on the same hidden holdout identity.

The receipt records:

- quality score;
- novelty score;
- cost units;
- hard-invariant status;
- exact evidence refs.

The scalar quality signal is used only to decide whether deeper recursion is still earning enough marginal value. It is explicitly not promotion authority.

## Convergence

`evaluateRsiRecursiveDepthChain()`

Possible states:

- CONTINUE_DEPTH
- STOP_CONVERGED
- STOP_COST_GROWTH
- STOP_HARD_INVARIANT_FAILURE
- STOP_MAX_DEPTH

Hard-invariant failure dominates score.

Convergence requires the last N marginal gains to fall below the externally fixed threshold.

Excessive cost growth stops depth even if quality keeps rising.

The candidate cannot choose the stop state.

## Layer-chain archive

Schema:

`metaengine.rsi.recursive-depth-archive.v1`

Multiple recursive layer chains may coexist.

The archive preserves a quality/novelty/cost Pareto frontier and never creates a scalar promotion winner.

This matches the Meta^n observation that the useful search object is not only a final solver but the chain of meta-layers that produced it.

## Relationship to earlier RSI

V1.10 chooses where to search.

V1.14/V1.15 decide which verified experience is reusable.

V1.16 searches bounded agent architectures.

V1.20/V1.22 economize and calibrate evaluation.

V1.23 allows those systems to reason at recursively increasing strategic depth without recursively widening the trusted control surface.

## Non-goals

V1.23 does not:

- mutate its own meta-operation;
- execute arbitrary helper code;
- grant Browser/tool authority;
- create a scheduler;
- alter evaluator/promotion/signing/self-update roots;
- make depth score a promotion score;
- install or deploy anything.

## Next research direction

A strong next mechanism is **disagreement-driven active evaluation**.

Query-by-committee and modern active-learning systems allocate scarce labels/evaluator calls to examples where independent predictors disagree most. For RSI, independent cheap judges/model families/targeted shards could form a committee whose disagreement requests full hidden-holdout evaluation.

The acquisition signal must remain compute-allocation only and should be disabled when committee diversity collapses or V1.22 calibration shows proxy drift.
