# METAENGINE RSI V1.25 — Fixed Skeleton / Typed Evolve Blocks

Status: SOURCE IMPLEMENTED / STACKED ON V1.24 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-disagreement-acquisition-v1 @ e0efcdb3b023ce20262e0daf30e652c8ee2404c8`

Implementation branch:

`work/metaengine-rsi-fixed-skeleton-mutation-v1`

## Purpose

V1.16 allows broad bounded architecture search. That is useful for exploration, but many improvement episodes should not spend model/evaluator compute recreating already-correct scaffolding.

V1.25 adds a complementary **narrow mutation mode**:

`immutable exact skeleton + externally declared critical evolve blocks`.

The model/search layer proposes replacements only for the difficult logic blocks. Everything else remains exact and is independently read back after materialization.

## Research basis — FunSearch

FunSearch reports that performance improved substantially when an initial program was expressed as a skeleton containing boilerplate/known structure while the LLM evolved only the critical function. This focuses LLM resources on the hard logic and reduces opportunities to break already-correct program structure.

FunSearch also combines the skeleton with automated evaluation, program populations, islands and asynchronous generation.

METAENGINE already has equivalents for external evaluation and islands. V1.25 adopts specifically the **fixed skeleton / critical evolve block** mechanism.

Reference: Romera-Paredes et al., *Mathematical discoveries from program search with large language models*, Nature 2024.

## AlphaEvolve compatibility

AlphaEvolve extends evolutionary code search beyond a single function and can mutate larger codebases. Google DeepMind also describes experiments beginning from minimal code skeletons while evolving multiple algorithm components.

METAENGINE therefore keeps two search modes:

1. broad bounded architecture/source evolution for genuinely structural changes;
2. V1.25 fixed-skeleton evolution when a trusted external specification can isolate the critical mutable logic.

V1.25 is not intended to replace broader search.

Reference: Google DeepMind, *AlphaEvolve: A Gemini-powered coding agent for designing advanced algorithms*, 2025–2026.

## Policy

Schema:

`metaengine.rsi.fixed-skeleton-policy.v1`

The external policy owner exact-binds:

- parent SHA;
- source-tree digest;
- immutable-skeleton digest;
- declared evolve-block manifest;
- block anchors;
- baseline block digests;
- per-block byte ceilings;
- total mutable-block and byte budgets.

A candidate cannot add a mutable block or move anchors.

## Evolve block manifest

Every block contains:

- stable block id;
- exact repository path;
- language;
- semantic role;
- baseline block digest;
- start/end anchor digests;
- maximum replacement bytes.

Authority/control-plane paths are forbidden from becoming evolve blocks, including:

- GitHub workflow roots;
- Supabase/Edge source;
- Guardian/developer emergency update;
- native supervisor;
- self-update/supervisor roots;
- RSI policy roots themselves.

## Mutation plan

Schema:

`metaengine.rsi.fixed-skeleton-mutation-plan.v1`

A mutation plan contains only:

- declared block id;
- replacement digest;
- replacement byte count;
- proposal-evidence digest.

It deliberately does not carry raw source as authority.

The plan is not:

- materialization authority;
- execution authority;
- evaluation authority;
- promotion authority.

## External materialization/readback

Schema:

`metaengine.rsi.fixed-skeleton-materialization.v1`

An external parser/materializer must prove:

- resulting candidate SHA differs from parent;
- immutable skeleton digest is exactly unchanged;
- only declared blocks changed;
- each block's before digest matches baseline;
- each after digest matches the plan;
- byte counts match;
- start/end anchors remain exact;
- no unexpected changed path exists;
- exact source-parser digest and evidence refs exist.

Any skeleton, anchor, block or path drift fails closed.

A successful materialization becomes only:

`eligible_for_external_evaluation=true`

It is still not archive or promotion authority.

## Why this is useful

Broad code regeneration wastes sampling capacity on low-entropy scaffolding and increases invalid-candidate rate.

V1.25 concentrates mutation entropy in the places where search has leverage:

`known-correct scaffolding stays exact -> model budget goes to the uncertain critical logic`.

This should improve:

- valid-candidate yield;
- evaluator efficiency;
- interpretability;
- attribution quality;
- rollback/readback precision.

V1.13 component attribution can then measure whether the evolved block actually contributed to the observed gain.

## Relationship to prior RSI layers

V1.10 chooses parents/search niches.

V1.15 chooses verified memory.

V1.16 searches broad architectures.

V1.20/V1.22/V1.24 allocate expensive evaluation efficiently.

V1.25 gives the proposal engine a lower-entropy mutation representation when the problem has a stable skeleton.

The two search modes can coexist in the same archive.

## Trust root

`apps/metaengine-browser/src/rsi-fixed-skeleton-mutation.mjs`

is immutable to candidates and included in:

- isolated candidate trust root;
- tournament trust root;
- promotion trust root.

## Non-goals

V1.25 does not:

- expose arbitrary source files as mutable;
- allow mutation of authority roots;
- treat raw patch text as authority;
- execute candidate code;
- bypass external materialization/readback;
- bypass full evaluation;
- create scheduler tasks/leases;
- promote/install/self-update.

## Next direction

The next useful mechanism is **search-mode routing**.

A trusted policy should learn when a problem benefits from:

- fixed-skeleton narrow evolution;
- V1.16 broad architecture evolution;
- V1.23 deeper recursive strategy layers;
- V1.18 comparative lineage operators.

Routing should be learned from externally verified historical yield/cost, not chosen by the candidate itself. A contextual bandit can allocate proposal budget among these search modes while preserving explicit exploration.
