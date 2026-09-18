# METAENGINE RSI V1.21 — Asynchronous Island Portfolio

Status: SOURCE IMPLEMENTED / STACKED ON V1.20 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-evaluation-economy-v1 @ ee67e79b7202ae3dcd980072215dbbd35c5c2973`

Implementation branch:

`work/metaengine-rsi-async-island-portfolio-v1`

## Purpose

V1.20 reduces the cost of evaluating one stream of candidates. V1.21 removes another scalability bottleneck: forcing all evolutionary search to behave like one globally synchronized population.

The goal is:

`independent island progress + bounded verified migration + one existing scheduler`

not:

`one island = one scheduler`.

## Research basis

### OpenEvolve

OpenEvolve combines MAP-Elites with island populations. Its configuration exposes multiple islands, periodic migration of top programs, migration rate, exploration/exploitation selection and cascade evaluation.

The default implementation uses separate island populations and periodically migrates strong programs between neighboring islands. Its documentation explicitly frames islands as a diversity mechanism that reduces premature convergence.

METAENGINE adopts:

- multiple logical populations;
- deterministic ring migration;
- bounded migration rate;
- quality + novelty based migrant selection;
- quality-diversity-compatible feature descriptors;
- independent local generations;
- no global generation barrier.

METAENGINE does not copy OpenEvolve's scheduler/control assumptions. Islands are advisory search partitions only.

Reference: algorithmicsuperintelligence/OpenEvolve, 2026.

### MAP-Elites / Quality-Diversity

MAP-Elites keeps high-quality solutions across behavior/feature niches instead of collapsing the population into one scalar champion.

METAENGINE V1.21 island members retain:

- quality score;
- novelty score;
- bounded feature vector;
- niche descriptor;
- archive/evaluator binding.

This makes the island layer compatible with V1.10's stepping-stone/niche policy and V1.17's clade-productivity signal.

### Asynchronous evolutionary search

Independent populations can continue while another island is waiting for expensive evaluation. A global generation barrier wastes available evaluator/model capacity when task durations are heterogeneous.

V1.21 therefore states:

- `asynchronous_islands=true`
- `global_generation_barrier_required=false`

A paused island does not block healthy islands.

### Why migration is revalidated

Open evolutionary systems often treat a migrated elite as immediately usable in the destination population.

METAENGINE's environments/models/niches may differ. Source performance is therefore not target-context truth.

A migrant first becomes:

`PROPOSE_MIGRATION_FOR_TARGET_VALIDATION`

Only an external target-context receipt with hard invariants can produce:

`eligible_for_target_parent_pool=true`

Migration is never promotion.

## Island member

Schema:

`metaengine.rsi.island-member.v1`

Every member binds:

- candidate id/SHA;
- source archive digest;
- evaluator-root digest;
- archive state;
- quality score;
- novelty score;
- bounded feature vector;
- external evaluator identity.

A member is never scheduler or promotion authority.

## Island state

Schema:

`metaengine.rsi.island-state.v1`

Each logical island has:

- island id;
- exact epoch;
- mutation/model/environment/niche descriptor;
- member set;
- health;
- local generation;
- completed/pending evaluation counters;
- bounded work budget.

Important fences:

- exact island epoch;
- exact state digest;
- one evaluator root per island;
- scheduler_owned_by_island=false;
- candidate_can_edit_island_state=false.

## Portfolio

Schema:

`metaengine.rsi.island-portfolio.v1`

The portfolio requires:

- 2–32 logical islands;
- one immutable evaluator root;
- bounded migration rate <= 20%;
- deterministic ring topology;
- no global generation barrier;
- one existing scheduler;
- second scheduler forbidden.

## Migration

`createRsiIslandMigrationPlan()`

Migration occurs only on the configured deterministic interval.

For each healthy source island:

1. choose bounded migrants using novelty, quality and deterministic tie-breaking;
2. route to the next island in the ring;
3. bind source and target epoch/state digests;
4. emit only a target-validation proposal.

Paused source/target islands are skipped.

A route explicitly has:

- target_validation_required=true;
- migrant_becomes_parent_before_validation=false;
- migration_is_promotion=false;
- scheduler_action_authorized=false.

## Migration receipt

`metaengine.rsi.island-migration-receipt.v1`

Possible target outcomes:

- `TARGET_VALIDATED`
- `TARGET_REJECTED`
- `TARGET_EVIDENCE_INSUFFICIENT`

Only TARGET_VALIDATED + target hard-invariant PASS can enter the target parent pool.

Even then:

- promotion authority=false;
- scheduler authority=false;
- execution authority=false.

## Asynchronous work proposals

`createRsiIslandWorkProposals()`

Each healthy island may independently emit a bounded proposal for:

- expansion;
- external evaluation.

The proposal is **not**:

- a DevOS task;
- a lease;
- a scheduler action.

It must pass through the existing scheduler admission plane.

Thus island search increases search parallelism without introducing a second scheduler.

## Why deterministic migration

RSI already requires incident replay and evidence-bound search decisions.

The migration selection seed derives from exact portfolio/round evidence. Same durable island state + same migration round reproduces the same routes.

## Relationship to previous layers

V1.10:
open-ended archive parent diversity.

V1.14:
verified experience exchange.

V1.17:
which clades are productive to expand.

V1.20:
how much evaluator compute a candidate deserves.

V1.21:
how multiple search populations progress concurrently and exchange proven candidates.

## Trust root

`apps/metaengine-browser/src/rsi-asynchronous-island-portfolio.mjs`

is added to:

- isolated candidate immutable paths;
- tournament trust root;
- promotion trust root.

## Non-goals

V1.21 does not:

- create another scheduler;
- create tasks/leases;
- treat migration as promotion;
- bypass target evaluation;
- synchronize every island at a global generation barrier;
- execute Browser actions;
- mutate production;
- install/self-update.

## Next slice — V1.22 Proxy Reliability Calibration

V1.20 deliberately uses cheap judges/targeted shards only for resource allocation.

The next safety/efficiency layer should continuously measure how well each low-fidelity signal predicts hidden full-holdout outcomes.

If a proxy drifts or becomes anti-correlated:

- its pruning weight should fall;
- exploration quota should rise;
- full-evaluation sampling should increase.

Calibration must use external heldout receipts and stay immutable to candidates.
