# METAENGINE RSI V1.31 — Skill / Frontier Convergence

Status: SOURCE CONVERGENCE IMPLEMENTED / CI PENDING / NO LIVE AUTHORITY

Base frontier lineage:

`work/metaengine-rsi-regression-replay-v1 @ fef38885f8c1504c3a5f459279a61e01d4d94fd6`

Skill lineage source:

`work/metaengine-rsi-contrastive-reliability-v1 @ 835a31eb36efb76b392f264b92b536da4a14c9a9`

Convergence branch:

`work/metaengine-rsi-skill-frontier-convergence-v1`

## Why this convergence exists

The RSI roadmap developed along two green but diverged lines after V1.24:

- frontier/reliability line:
  disagreement acquisition -> durable experience graph -> benchmark provenance -> frontier co-evolution -> capability retention replay;
- skill line:
  verified skill library -> meta-skill evolution -> behavioral scope expansion -> contrastive skill reliability.

Both lines changed the same immutable trust-root files, so mechanically merging old stacked branches would risk dropping newer policy paths.

V1.31 forward-ports only the skill-specific source/tests/research documents onto the current frontier head and then semantically unions the immutable trust roots.

## Adopted skill mechanisms

The converged line now includes:

1. `rsi-verified-skill-library.mjs`
   - typed verified skills;
   - strict input/output interfaces;
   - bounded DAG composition;
   - external evidence and portability receipts;
   - no direct tool/process/promotion authority.

2. `rsi-meta-skill-evolution.mjs`
   - two-timescale evolution of how reusable skills are proposed/refined;
   - evolution remains evidence-gated.

3. `rsi-skill-scope-expansion.mjs`
   - behavioral scope grows only after external validation on expanded contexts.

4. `rsi-contrastive-skill-reliability.mjs`
   - successful and failed trajectories are contrasted;
   - repeated hidden trials distinguish potential capability from reliable capability;
   - limit violations and unsupported success claims are first-class failures.

## Immutable trust-root union

All four skill policy modules are now immutable to candidate mutation and included in:

- Candidate Builder exact immutable paths;
- RSI Tournament trust root;
- RSI Promotion trust root.

The frontier-only modules remain present as well. No side is replaced.

## Documentation numbering note

Historical parallel development produced overlapping V1.24–V1.28 document numbers.

Those files remain for provenance. From V1.31 onward, the branch lineage and exact source SHA are authoritative; old version numbers are labels, not merge authority.

## Non-goals

This convergence does not:

- activate any skill in production;
- create a scheduler;
- execute Browser effects;
- deploy Edge/DDL;
- grant promotion/self-update/signing authority;
- reinterpret candidate/model text as trusted evidence.

## Next slice

The immediate next issue exposed by the merged architecture is **skill-library drift**.

The verified library is bounded globally but currently has no outcome-driven ACTIVE/QUARANTINED/RETIRED lifecycle or active-cap governance. Recent continual-skill research shows that unconstrained accumulation can degrade retrieval and produce false-positive injections.

V1.32 addresses that gap.
