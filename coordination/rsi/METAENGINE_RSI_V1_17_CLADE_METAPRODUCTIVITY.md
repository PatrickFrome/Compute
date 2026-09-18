# METAENGINE RSI V1.17 — HGM-Inspired Clade Metaproductivity Guidance

Status: SOURCE IMPLEMENTED / STACKED ON V1.16 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-architecture-search-v1 @ 410247bb7c62fda10c64df4c930eb85d79b0cdab`

Implementation branch:

`work/metaengine-rsi-clade-metaproductivity-v1`

## Purpose

V1.10 already avoids pure hill-climbing by preserving stepping stones and diverse archive parents. V1.17 addresses a subtler defect:

> the candidate with the highest current benchmark score may be a poor ancestor for future self-improvement.

A lower-scoring ancestor may produce much stronger descendants.

V1.17 therefore adds a clade-level expansion signal derived from descendant outcomes rather than treating direct benchmark performance as the primary expansion heuristic.

## Research basis — Huxley-Gödel Machine

The Huxley-Gödel Machine identifies a **Metaproductivity-Performance Mismatch**: immediate agent performance is not necessarily a good predictor of future self-improvement potential.

HGM introduces Clade-Metaproductivity (CMP), which aggregates descendant performance inside the subtree rooted at an agent, and uses an estimate of CMP with Thompson Sampling to guide self-improvement search. HGM also adaptively decouples expansion from additional evaluation.

Reference: Wang et al., *Huxley-Gödel Machine: Human-Level Coding Agent Development by an Approximation of the Optimal Self-Improving Machine*, ICLR 2026 / arXiv:2510.21614.

## METAENGINE adaptation

METAENGINE does **not** claim access to HGM's true CMP oracle.

V1.17 implements an explicit approximation:

`DESCENDANT_BETA_POSTERIOR_PROXY_V1`

For each archive node, externally verified benchmark task outcomes from all descendants are aggregated into a Beta posterior:

- alpha = 1 + descendant solved tasks;
- beta = 1 + descendant failed tasks.

The posterior is only a **clade metaproductivity proxy**.

Every snapshot explicitly states:

- true_cmp_oracle_available=false;
- clade_metaproductivity_proxy_only=true;
- direct benchmark score is not expansion authority.

## Clade archive

Schema:

`metaengine.rsi.clade-archive.v1`

Every node is exact-bound to:

- candidate id/SHA;
- parent candidate id;
- solved/total benchmark counts;
- evaluation digest;
- expansion count;
- external evaluator identity contract.

Candidate-authored clade statistics are rejected.

The archive rejects:

- missing parents;
- duplicate candidate identities;
- ancestry cycles;
- self-parenting.

## Why descendant evidence is separated from direct score

For a node with no descendants, the clade proxy remains an uninformed Beta(1,1) prior, even if its direct benchmark score is excellent.

This is intentional.

A leaf with 95% direct accuracy has not yet demonstrated that its descendants are productive.

Conversely, a 55% ancestor with multiple descendants at 90%+ can have a high clade-productivity posterior.

This keeps the system from confusing:

`good at tasks now`

with

`good substrate for future improvement`.

## Expansion selection

`createRsiCladeExpansionPlan()`

uses seeded Thompson Sampling over the clade proxy posterior.

The seed is exact-bound to:

- snapshot digest;
- round id;
- expansion slot count;
- evaluation slot count.

Exact replay therefore reproduces the same proposal.

Expansion output is only:

`PROPOSE_EXPANSION`

and has:

`scheduler_action_authorized=false`

The plan cannot create a DevOS task, lease or Browser action by itself.

## Evaluation selection

Expansion and evaluation are separate proposal sets.

Additional evaluation is prioritized by posterior uncertainty rather than by the same metric used for expansion.

This is inspired by HGM's adaptive decoupling of:

- which node to expand;
- which node needs more evidence.

V1.17 emits:

`PROPOSE_ADDITIONAL_EXTERNAL_EVALUATION`

with no scheduler authority.

## Relationship to V1.10

V1.10 remains the open-ended archive-search policy.

V1.17 is a new evidence signal that should later augment its parent portfolio:

- `PARETO_EXPLOIT`
- `STEPPING_STONE`
- `NICHE_COVERAGE`
- `ANCESTOR_REVIVAL`
- future `CLADE_PRODUCTIVE` slot backed by V1.17 evidence.

That integration should happen only after V1.17 exact-head CI and falsification tests are green.

## Relationship to V1.14 / V1.15

V1.14 shares verified experience across lineages.

V1.15 learns which shared memories are useful.

V1.17 answers a different question:

> Which lineage is worth expanding because its descendants demonstrate future improvement potential?

The layers are complementary.

## Why Thompson Sampling is seeded

The HGM direction benefits from posterior sampling, but an operations-grade recursive system also needs incident replay.

METAENGINE derives pseudorandomness from exact durable evidence so the same archive/snapshot/round produces the same expansion proposal.

## Trust root

`apps/metaengine-browser/src/rsi-clade-metaproductivity.mjs`

is added to:

- isolated candidate immutable paths;
- tournament trust root;
- promotion trust root.

Candidates cannot edit how their own clade productivity is estimated.

## Non-goals

V1.17 does not:

- claim true CMP;
- treat direct benchmark score as expansion authority;
- execute expansions;
- schedule evaluation;
- create DevOS leases;
- promote candidates;
- mutate Browser/live production;
- replace hidden holdouts;
- replace statistical confirmation.

## Next slice — V1.18 comparative lineage operators

A newer direction, the Mendel Gödel Machine, reuses already collected trajectories through:

- clonal mutation;
- reaction-norm mutation;
- cross-lineage hybridization.

This is attractive because it can make each self-modification proposal more informative without requiring new task executions for every comparative insight.

A safe METAENGINE adaptation should use only exact, externally verified trajectory/evaluation records, never raw model narrative, and keep cross-lineage hybridization inside the isolated candidate plane.
