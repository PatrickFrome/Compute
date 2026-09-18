# METAENGINE RSI V1.24 — Calibrated Disagreement-Driven Evaluation Acquisition

Status: SOURCE IMPLEMENTED / STACKED ON V1.23 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-recursive-depth-v1 @ 510d0f9ecad9ffa6c81169432f66f8fc430f0858`

Implementation branch:

`work/metaengine-rsi-disagreement-acquisition-v1`

## Purpose

V1.20 makes evaluation multi-fidelity and V1.22 calibrates each low-fidelity proxy against the hidden full holdout.

V1.24 uses several independently calibrated proxies together to decide **which candidates deserve scarce full-holdout evaluation**.

The mechanism is:

`calibrated proxy committee disagreement -> full-holdout acquisition request`

not:

`committee vote -> truth or promotion`.

## Research basis

### Query by Committee

Query-by-Committee (QBC) selects unlabeled examples where multiple plausible predictors disagree. The disagreement identifies regions where an expensive label can reduce uncertainty most efficiently.

METAENGINE maps:

- cheap judge / proxy prediction -> committee member prediction;
- expensive label -> hidden full-holdout evaluation;
- acquisition -> request to spend evaluator compute.

The committee is used only to allocate evaluator budget.

### Trustworthy active learning

Modern active-learning reviews emphasize that uncertainty/disagreement is not automatically reliable: it can reflect noise, poor calibration, distribution shift or insufficient committee diversity.

V1.24 therefore refuses to use disagreement unless:

- at least two proxy members have non-zero V1.22 reliability weight;
- at least two distinct predictor families remain active.

If those conditions fail, disagreement is disabled and selection falls back to promise/diversity allocation.

### AlphaEvolve / model ensembles

AlphaEvolve uses a mixture of faster and deeper models to increase proposal diversity while automated evaluators remain separate.

V1.24 applies the same separation principle on the evaluation-acquisition side: different predictor families can contribute hypotheses, but the hidden full evaluator remains the source of truth.

## Committee

Schema:

`metaengine.rsi.disagreement-committee.v1`

Every member is derived from:

- exact predictor identity digest;
- predictor family;
- exact V1.22 proxy policy;
- exact V1.22 reliability snapshot;
- V1.22 allocation guidance.

Reliability weight is therefore not candidate supplied.

UNRELIABLE V1.22 members receive weight zero.

Duplicate predictor identities are forbidden.

## Candidate pool

Schema:

`metaengine.rsi.acquisition-candidate.v1`

Every candidate exact-binds:

- candidate id/SHA;
- mutation surface;
- novelty score;
- estimated full-evaluation cost;
- low-fidelity eligibility digest;
- external candidate registry.

A candidate cannot enqueue itself for hidden holdout.

## Committee prediction matrix

Schema:

`metaengine.rsi.committee-prediction.v1`

Every committee member must predict every candidate.

The matrix must be complete.

This prevents selective abstention where a proxy reports only candidates on which it looks reliable.

Every prediction is explicitly:

- not a full evaluator;
- not promotion authority;
- unable to schedule holdout work.

## Acquisition metrics

For every candidate V1.24 computes from calibrated active members:

- weighted mean pass probability;
- weighted mean predicted holdout score;
- weighted variance;
- weighted standard deviation;
- weighted binary-vote entropy;
- effective reliability mass.

These metrics are evidence for **where to buy an expensive label**, not evidence that the candidate is good.

## Three allocation lanes

### DISAGREEMENT

Prioritizes candidates with high calibrated committee disagreement.

This is the QBC / active-learning lane.

### PROMISE

Prioritizes candidates whose calibrated committee predicts strong hidden-holdout performance.

This preserves exploitation.

### DIVERSITY

Prioritizes high-novelty candidates and mutation surfaces not already represented in the selected batch.

This prevents a committee from suppressing unconventional search directions.

## Fallback

If committee diversity or calibration collapses:

`committee_trusted_for_disagreement=false`

and the system uses:

`DIVERSITY_PROMISE_WITHOUT_DISAGREEMENT`

rather than manufacturing a disagreement score from one reliable predictor.

## Output boundary

The result is:

`REQUEST_FULL_HOLDOUT_EVALUATION`

but the request is not:

- a scheduler task;
- a lease;
- an evaluation result;
- archive authority;
- promotion authority.

The existing scheduler admission plane remains required.

## Relationship to V1.22

V1.22 answers:

> Is this proxy still predictive enough to influence compute allocation?

V1.24 answers:

> Given several calibrated proxies, which uncertain/promising/diverse candidates should receive expensive full evaluation next?

This keeps calibration and acquisition as separate trust layers.

## Trust root

`apps/metaengine-browser/src/rsi-disagreement-acquisition.mjs`

is added to:

- isolated candidate immutable paths;
- tournament trust root;
- promotion trust root.

## Non-goals

V1.24 does not:

- treat disagreement as correctness;
- let candidate choose committee members or weights;
- let candidate choose its own query status;
- schedule work directly;
- run Browser actions;
- mutate production;
- grant archive/promotion/self-update authority.

## Next direction

A high-value next layer is **fixed-skeleton mutation** inspired by FunSearch and AlphaEvolve.

Rather than allowing every candidate to regenerate large subsystems, METAENGINE can exact-bind immutable skeleton regions and open only small typed evolve blocks. This should reduce invalid candidates and focus model compute on the hardest logic while retaining the broader V1.16 architecture-search path as a separate search mode.
