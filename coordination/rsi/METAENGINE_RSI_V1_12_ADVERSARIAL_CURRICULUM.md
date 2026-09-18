# METAENGINE RSI V1.12 — Adversarial-History Curriculum Producer

Status: SOURCE IMPLEMENTED / STACKED ON V1.11 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-statistical-risk-v1 @ d4c57148679db51d3f20cb51311a583b73540f34`

Implementation branch:

`work/metaengine-rsi-adversarial-curriculum-v1`

## Purpose

V1.10 can select a hidden curriculum, but it needs trustworthy challenge supply.

V1.12 converts externally verified failures and incidents into hidden challenge artifacts without allowing the candidate to write its own exam, choose opponents, expose expected solutions or turn a production incident into a live adversarial action.

The output plugs directly into V1.10's `metaengine.rsi.curriculum-challenge.v1` catalog.

## Research mechanisms adopted

### Digital Red Queen — dynamic adversarial history

Digital Red Queen evolves each new program against a changing objective defined by previous opponents rather than a single static target. The research reports increasing generalization to held-out human opponents while also observing convergence pressure across runs.

METAENGINE adopts the useful part:

- evaluator failures and cross-model disagreements may create `ADVERSARIAL` challenge proposals;
- challenge identity is bound to a digest of the predecessor-history set;
- challenge dynamics can be `GROWING_PREDECESSOR_HISTORY`;
- candidates never choose their opponent history;
- the history becomes sandbox/holdout workload, not live production opposition.

Reference: Kumar et al., *Digital Red Queen: Adversarial Program Evolution in Core War with LLMs*, arXiv:2601.03335.

### POET — transfer stepping stones across environments

POET demonstrates that co-evolving environments and transferring solutions across them can unlock progress that direct optimization misses.

METAENGINE adopts transfer failures as a first-class challenge source:

`TRANSFER_REGRESSION -> TRANSFER`

This lets the search pressure candidates on cross-environment generalization instead of repeatedly optimizing one fixed benchmark.

### AgentEvolver — self-questioning, but externalized

AgentEvolver's self-questioning mechanism generates new tasks from environment interaction.

METAENGINE uses the same direction but moves challenge authority outside the candidate:

- candidate/model text can suggest a signal upstream;
- only externally verified source evidence can enter V1.12;
- external materializer must produce the hidden suite/manifest;
- candidate never sees the solution or hidden manifest.

This preserves the exploration benefit without letting a self-improver create an easy test and certify itself.

### DGM / ShinkaEvolve — archive-driven search needs fresh pressure

Archive-based systems improve when parent diversity is paired with meaningful new evaluation pressure. V1.12 turns actual failures into new pressure so V1.10's stepping-stone and niche policy does not merely revisit the same static holdout forever.

## Source evidence contract

`metaengine.rsi.challenge-source-evidence.v1`

Allowed source kinds:

- `EVALUATOR_FAILURE`
- `HARD_INVARIANT_NEAR_MISS`
- `CROSS_MODEL_DISAGREEMENT`
- `PRODUCTION_INCIDENT`
- `TRANSFER_REGRESSION`

Every source is exact-bound to:

- source id;
- baseline SHA;
- optional failed candidate SHA;
- challenge family;
- bounded mechanism tags;
- bounded failure codes;
- evidence digest and refs;
- exact predecessor-history SHA set/digest;
- external verifier.

The source contract explicitly requires:

- raw page text absent;
- raw user input absent;
- secret material absent;
- model text is not authority;
- candidate-authored=false.

Unknown fields are rejected instead of ignored.

## Proposal state

`metaengine.rsi.adversarial-challenge-proposal.v1`

The proposal decides only the challenge class and bounded metadata.

It cannot execute anything.

Dynamic adversarial sources use:

`GROWING_PREDECESSOR_HISTORY`

A production incident with no predecessor history uses:

`INCIDENT_REPRODUCTION`

Every proposal fixes:

- hidden manifest required;
- external materialization required;
- trusted evaluator required;
- candidate cannot select opponents;
- candidate cannot select expected solution;
- no live production adversary;
- minimal-criterion targeting.

## External materialization

`metaengine.rsi.challenge-materialization-receipt.v1`

The trusted external materializer binds:

- proposal digest;
- suite digest;
- hidden manifest digest;
- environment fingerprint;
- attempted/solved counts;
- exact predecessor-history digest;
- sandbox backend.

It must prove:

- external materializer;
- candidate-authored=false;
- hidden manifest verified;
- candidate-visible manifest=false;
- expected solution exposed=false;
- live production target=false;
- network default deny;
- host repository not mounted.

## Final handoff

`finalizeRsiAdversarialChallenge()` emits a V1.10 curriculum challenge only after source, proposal and materialization are all exact-bound.

The handoff is:

- eligible_for_curriculum=true;
- eligible_for_live_adversarial_execution=false;
- external evaluator required;
- zero Browser/process/promotion/self-update authority.

## Why this is safer than letting RSI invent its own benchmark

A self-improving candidate has a direct incentive to generate tests that make its own mutation look good. V1.12 therefore separates:

`failure observation -> external challenge proposal -> external hidden materialization -> curriculum`

Candidate code is never the source of truth for the challenge or answer.

## Trust root

`apps/metaengine-browser/src/rsi-adversarial-challenge-producer.mjs`

is added to:

- Candidate Builder immutable exact paths;
- tournament trust root;
- promotion trust root.

## Next slice — V1.13 causal experience attribution

The current experience lesson still says which candidate failed/succeeded, not which changed component caused the measured effect.

V1.13 should borrow AgentEvolver's self-attribution idea but require external ablation/counterfactual receipts:

- exact changed component;
- parent/candidate binding;
- leave-one-component-out or matched ablation;
- objective delta;
- hard-invariant impact;
- uncertainty/insufficient-evidence state;
- no attribution from model narrative alone.

Only externally supported component lessons should feed future V1.10 experience memory.
