# METAENGINE RSI V1.11 — Statistical Recursive-Risk Budget

Status: SOURCE IMPLEMENTED / STACKED ON V1.10 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-release-convergence-v1 @ 933a51fcc9e2bed72ee622914ab3e30bbf731634`

Implementation branch:

`work/metaengine-rsi-statistical-risk-v1`

## Purpose

V1.10 improves **where RSI searches**. V1.11 controls how much cumulative statistical false-positive risk recursive improvement may spend before an externally reviewed candidate is even eligible for promotion review.

METAENGINE already requires hard safety invariants, exact source/candidate identity, holdouts, paired tournament receipts, provenance, signed qualification and a non-authoritative promotion gate. Those gates prevent many structural failures, but noisy objective measurements can still create a recursive failure mode: over many generations, repeatedly testing apparent gains eventually produces a false positive.

V1.11 adds a cumulative risk ledger for that specific problem. It does not replace hard invariants and does not itself compute statistical evidence.

## Research basis — Statistical Gödel Machine

Wu et al. introduce the Statistical Gödel Machine (SGM) as a risk-control layer for recursive edits when formal proofs of net improvement are impractical. SGM replaces proof obligations with statistical certificates such as e-values or Hoeffding bounds and allocates a global error budget across recursive modifications.

The key scheduling idea is **Confirm-Triggered Harmonic Spending (CTHS)**: risk is spent only when a promising proposal escalates to the confirmation stage, not on every screening/proposal round.

For a precommitted finite confirmation horizon `T`:

`alpha_k = alpha_total / (k * H_T)`

where `H_T = sum_{j=1..T}(1/j)`.

Thus the full finite confirmation schedule sums to `alpha_total`.

Reference: Wu et al., *SGM: A Statistical Gödel Machine for Risk-Controlled Recursive Self-Modification*, arXiv:2510.10232.

## METAENGINE adaptation

### 1. Exact finite-horizon CTHS mode

`CTHS_FINITE_V1`

Requires a precommitted `max_confirmations=T`. Screening consumes no alpha. Only the k-th confirmation can consume `alpha_k`.

The candidate cannot choose:

- global alpha;
- confirmation index;
- allocated alpha;
- whether screening consumes risk;
- the verifier;
- the statistical method after seeing the desired result.

### 2. Open-ended anytime mode

METAENGINE also needs truly open-ended generations where the number of future confirmations is unknown.

For that case V1.11 defines a **METAENGINE extension**, not an attribution to the SGM paper:

`TELESCOPING_ANYTIME_V1`

`alpha_k = alpha_total / (k * (k + 1))`

The infinite sum is exactly `alpha_total`.

This is more conservative than finite CTHS and preserves the same confirmation-triggered principle without pretending a future horizon is known.

### 3. External statistical certificates only

METAENGINE does **not** recompute a p-value and call that proof.

A certificate is accepted only if it declares:

- external verifier;
- candidate-authored=false;
- exact risk budget digest;
- exact confirmation index;
- exact candidate/parent SHA;
- exact tournament plan digest;
- exact hidden holdout digest;
- exact evaluator-root digest;
- supported method;
- used alpha <= allocated alpha;
- paired evaluation;
- independent holdout;
- precommitted stopping rule;
- optional stopping not used;
- familywise-valid evidence;
- screening spent no alpha;
- exact evidence refs.

Supported contract labels:

- `E_VALUE_EXTERNAL_V1`
- `HOEFFDING_EXTERNAL_V1`
- `PAIRED_CONFIDENCE_SEQUENCE_EXTERNAL_V1`

These labels are evidence contracts. V1.11 intentionally does not implement the underlying statistical estimator because doing so without the independent evaluator's raw experiment contract would create a second, less trustworthy evaluator.

### 4. Append-only confirmation ledger

`RsiRecursiveRiskLedger` consumes confirmations sequentially.

The next index is derived from append-only ledger length. Caller/candidate cannot skip to a more favorable index.

A duplicate candidate confirmation is rejected. Alpha overspend is rejected. Finite-horizon exhaustion is rejected.

A positive certificate yields only:

`STATISTICAL_GATE_PASS_FOR_EXTERNAL_REVIEW`

A negative certificate yields:

`STATISTICAL_GATE_REJECTED`

Neither state has execution, production mutation, promotion, self-update or retry authority.

### 5. Composition with the existing promotion gate

The new risk gate is conjunctive, not substitutive.

`evaluateRsiRiskControlledPromotionReview()` requires:

1. the existing RSI promotion admission gate is already exactly `READY_FOR_EXTERNAL_PROMOTION_REVIEW`;
2. its digest is valid;
3. all existing hard-invariant/tournament/archive/provenance/CI/canary/rollback conditions therefore already passed;
4. an exact statistical confirmation for the same candidate/parent/tournament also passed.

Only then the wrapper emits:

`READY_FOR_RISK_CONTROLLED_EXTERNAL_PROMOTION_REVIEW`

Even this state still has:

- `promotion_authority=false`
- `self_update_authority=false`
- `direct_promotion_authorized=false`
- `existing_self_update_handoff_authorized=false`
- `promotion_token=null`

An external trusted promotion process remains mandatory.

## Why this does not duplicate existing hard invariants

Hard invariants answer questions such as:

- did an ambiguous physical effect replay?
- did a workspace escape occur?
- did candidate mutate authority/evaluator roots?
- is source identity exact?

The risk budget answers a different question:

> across many noisy but structurally valid candidate comparisons, how much cumulative probability of accepting a non-improving edit has the recursive system spent?

Neither layer can replace the other.

## Trust-root changes

`apps/metaengine-browser/src/rsi-recursive-risk-budget.mjs`

is immutable to candidates and is added to:

- isolated Candidate Builder exact immutable paths;
- tournament trust root;
- promotion trust root.

## Relationship to V1.10 search efficiency

V1.10 deliberately reduces expensive evaluation volume through:

- novelty rejection;
- archive parent selection;
- model-arm bandit routing;
- experience reuse;
- frontier curriculum.

V1.11 then spends statistical risk only on proposals that survive those cheap filters and actually escalate to independent confirmation.

This matches the research pattern: sample-efficient search on the proposal side, cumulative risk control on the irreversible-admission side.

## Non-goals

V1.11 does not:

- generate candidates;
- run statistical experiments;
- invent e-values;
- infer confidence from LLM text;
- spend alpha during proposal generation or screening;
- replace holdouts;
- replace hard invariants;
- execute Browser actions;
- create DevOS leases;
- deploy DDL/Edge Functions;
- promote or install a release;
- authorize blind retry.

## Next research/implementation slices

### V1.12 — adversarial challenge producer

Convert externally verified failures, production incidents and cross-model disagreements into hidden challenge manifests. The candidate sees only the challenge interface, never expected solutions.

### V1.13 — causal experience attribution

Borrow AgentEvolver's self-attribution idea, but use external trajectory/evaluator evidence to attribute measured gains to specific mutation components. Avoid assigning all credit to every file in a successful candidate.

### V1.14 — asynchronous island portfolio

Borrow ShinkaEvolve's async islands and AlphaEvolve's proposal/evaluator concurrency. Use independent archive niches/model arms while retaining one DevOS scheduler and one trusted evaluator root.

### Physical closure

Only after modern live Browser + Fleet proof exists should the full loop advance:

`search -> candidate -> evaluator -> tournament -> statistical confirmation -> external promotion review -> trusted existing release/self-update -> successor readback`.
