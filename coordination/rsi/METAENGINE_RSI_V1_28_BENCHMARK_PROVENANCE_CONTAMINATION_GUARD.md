# METAENGINE RSI V1.28 — Benchmark Provenance & Contamination Guard

Status: SOURCE IMPLEMENTED / PARALLEL ON GREEN EXPERIENCE-GRAPH LINE / CI PENDING / NO LIVE AUTHORITY

Base:

`work/metaengine-rsi-experience-graph-v1 @ 1241705b5f0fd092a0ef5d94d08e2aa1c5a512b5`

Implementation branch:

`work/metaengine-rsi-benchmark-provenance-v1`

## Purpose

METAENGINE RSI can now improve its search policy, evaluator allocation, agent architecture, memory, curriculum, skills and even parts of its improver.

That creates a new failure mode: **benchmark adaptation can masquerade as recursive improvement**.

A candidate can appear to improve if the evaluation task, reference solution, hidden tests, benchmark harness, or previously seen benchmark-derived experience leaks into the same recursive loop.

V1.28 adds an independent benchmark-evidence provenance layer:

`task provenance -> contamination assessment -> resistant task-set admission -> existing evaluator/tournament/risk/promotion gates`.

The guard does not claim that contamination can be proven absent. It only classifies externally verifiable evidence as more or less resistant.

## Research basis

### LiveCodeBench — continuously fresh tasks

LiveCodeBench continuously collects newly released competitive-programming problems and emphasizes contamination-free evaluation through temporal freshness.

METAENGINE adopts the freshness direction:

- benchmark version/cutoff is explicit;
- source publication and candidate-freeze times are exact-bound;
- freshly materialized tasks can be distinguished from old public-static tasks.

Reference: Jain et al., *LiveCodeBench: Holistic and Contamination Free Evaluation of Large Language Models for Code*, arXiv:2403.07974 / ICLR 2025.

### SWE-rebench — continuously refreshed real-world tasks

SWE-rebench continuously builds new real-world software-engineering tasks from repositories and reports that performance on older static SWE benchmarks can overestimate generalization.

METAENGINE adopts:

- rolling benchmark versions;
- exact source commit/repository provenance;
- cross-repository evidence diversity;
- public static suites cannot be the sole recursive-improvement evidence.

Reference: Badertdinov et al., *SWE-rebench: An Automated Pipeline for Task Collection and Decontaminated Evaluation of Software Engineering Agents*, 2025.

### CODE2BENCH — recent repository code + dynamic executable checks

CODE2BENCH constructs evaluation tasks from recent GitHub code and uses dependency-aware analysis plus executable/property-based evaluation.

METAENGINE adopts the source-provenance direction while keeping task text outside the RSI trust root:

- exact source commit SHA;
- exact repository digest;
- hidden test digest;
- external provenance receipt.

Reference: *CODE2BENCH: Automated Construction of an Executable Code Benchmark from Source Repositories*, 2025.

### Dynamic semantic variants

Dynamic benchmark construction such as DyCodeEval reduces direct memorization value by generating semantically related but distinct evaluation variants.

METAENGINE allows:

`DYNAMIC_SEMANTIC_VARIANT`

only when both are externally exact-bound:

- parent task digest;
- semantic-equivalence receipt digest.

A model/candidate cannot declare its own variant equivalent.

### Contamination and reward-hacking evidence

Recent evaluations of coding agents show a stronger failure mode than accidental pretraining contamination: an improving system may directly or indirectly exploit benchmark artifacts, harness logic, hidden tests, or evaluation feedback.

V1.28 treats the following as hard contamination signals:

- reference solution visible;
- hidden tests visible;
- evaluator/harness mutated by candidate;
- task authored by candidate;
- task selected by candidate;
- source repository selected by candidate;
- benchmark task ingested into trusted RSI memory;
- benchmark task ingested into skill library.

The last two are particularly important for a self-improving system: **evaluation evidence must not become training memory for the same benchmark family**.

## Source kinds

V1.28 recognizes:

- `FRESH_PRIVATE_COMMIT`
- `CROSS_REPO_FRESH`
- `DYNAMIC_SEMANTIC_VARIANT`
- `PRIVATE_PRODUCTION_INCIDENT`
- `PUBLIC_STATIC`

Public-static tasks are useful for regression continuity but are supplemental only.

## Risk states

Every task becomes one of:

- `CONTAMINATION_RESISTANT`
- `SUSPECT`
- `CONTAMINATED`
- `UNKNOWN`

There is intentionally no `PROVEN_UNCONTAMINATED` state.

Why: model training corpora and indirect exposure are not generally observable with enough certainty to make such a proof.

Every assessment explicitly records:

`proven_uncontaminated=false`

and

`model_training_cutoff_proven=false`.

## Trusted task provenance

Schema:

`metaengine.rsi.benchmark-task-provenance.v1`

The trust root stores only typed metadata/digests, not raw task text.

Each task binds:

- task id;
- benchmark id/version;
- prompt digest;
- hidden-test digest;
- source kind/family;
- source repository digest;
- candidate repository digest;
- optional source commit SHA;
- source publication timestamp;
- candidate-freeze timestamp;
- materialization timestamp;
- external searchability assessment;
- leakage flags;
- exact external evidence refs.

The candidate cannot author provenance or label its own task as fresh.

## Fresh-after-candidate evidence

A useful strong signal is a task source that did not exist when the candidate was frozen.

V1.28 records both:

- `source_published_after_candidate_freeze`
- `task_materialized_after_candidate_freeze`

This does not prove model-level non-contamination, but it significantly reduces direct candidate-specific benchmark adaptation.

## Cross-repository evidence

`CROSS_REPO_FRESH` requires:

`source_repository_digest != candidate_repository_digest`.

This reduces same-repository memorization and search-specific overfitting.

Cross-repo is not sufficient by itself; hidden tests and external task selection remain required.

## Searchability

Externally assessed states:

- `NOT_SEARCHABLE`
- `SEARCHABLE`
- `UNKNOWN`

A searchable public prompt is `SUSPECT`.

Unknown searchability cannot become strong evidence merely by omission.

## Dynamic variants

A dynamic variant is resistant only when it has:

- exact parent task digest;
- exact external semantic-equivalence receipt;
- hidden tests;
- candidate-independent task selection.

The candidate cannot self-generate a trivial variant and certify it.

## Benchmark feedback firewall

A benchmark task becomes `CONTAMINATED` if it is ingested into:

- trusted experience memory;
- reusable skill library.

This prevents the recursive loop:

`evaluate on task -> store solution experience -> evaluate descendants on same task -> claim improvement`.

Only contamination-resistant task outcomes may become trusted experience, and even then the benchmark task itself/solution does not become reusable skill content.

## Task-set admission

Schema:

`metaengine.rsi.benchmark-evidence-admission.v1`

A full-holdout evidence set requires:

- zero hard-contaminated tasks;
- minimum number of resistant tasks;
- minimum number of resistant source families;
- bounded public-static fraction.

`SUSPECT` and `UNKNOWN` tasks do not count toward the resistant minimum.

Contaminated evidence has weight zero.

Even an admitted set has:

- `eligible_as_sole_promotion_evidence=false`;
- existing evaluator/tournament gates still required;
- V1.11 statistical confirmation still required;
- external promotion gate still required.

## Relationship to V1.20–V1.24 evaluation economy

V1.20 saves evaluator compute through low-to-high fidelity stages.

V1.22 calibrates low-fidelity proxies against hidden full-holdout outcomes.

V1.24 spends full-holdout budget where calibrated predictors disagree.

V1.28 asks a prior question:

> Is the hidden holdout itself trustworthy enough to support recursive-improvement evidence?

The combined intended sequence becomes:

`fresh/provenanced task set`
→ `multi-fidelity evaluation`
→ `proxy calibration`
→ `disagreement acquisition`
→ `full hidden holdout`
→ `statistical confirmation`
→ `external promotion review`.

## Relationship to durable experience graph

V1.28 is built on the green experience-graph line because contamination can poison memory, not only evaluation.

An assessment explicitly exposes:

`eligible_for_trusted_experience_memory`

Only `CONTAMINATION_RESISTANT` evidence is eligible.

A later convergence adapter should require that flag before a benchmark-derived case enters the durable V1.24 experience graph.

## Trust-root changes

`apps/metaengine-browser/src/rsi-benchmark-provenance-guard.mjs`

is added to:

- isolated candidate immutable paths;
- tournament trust root;
- promotion trust root.

A candidate cannot widen freshness criteria, hide leakage, change task-set requirements or relabel contaminated evidence.

## Non-goals

V1.28 does not:

- claim to know a proprietary model training cutoff;
- claim mathematical proof of zero contamination;
- web-search raw user/browser content;
- store raw benchmark prompts in RSI trust state;
- let candidate choose its tests;
- let a dynamic variant self-certify semantic equivalence;
- make provenance itself promotion authority;
- run Browser effects;
- schedule DevOS work;
- deploy DDL/Edge;
- install or self-update.

## Next useful research slices

### Benchmark mutation / metamorphic families

Build externally generated semantically equivalent task families with metamorphic properties so success must transfer across transformations rather than one prompt.

### Evaluation firewall for skills/memory

Enforce V1.28 admission directly at V1.24 skill-library and V1.27 experience-memory ingestion boundaries.

### Holdout refresh economics

Treat benchmark freshness as a scarce resource: rotate/retire task sets before repeated RSI generations can adapt to them, while keeping enough stable anchors for regression detection.
