# METAENGINE RSI V1.14 — Verified Group Experience Exchange

Status: SOURCE IMPLEMENTED / STACKED ON V1.13 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-component-attribution-v1 @ ca074ed51ab2bfe1428609e27638b46b7f9fe0a7`

Implementation branch:

`work/metaengine-rsi-group-experience-v1`

## Purpose

METAENGINE's RSI archive preserves branching diversity, but an archive alone can still waste discoveries: useful lessons remain trapped inside isolated evolutionary branches.

V1.14 treats a **verified group of evolving candidates** as an information-sharing unit. It allows externally verified experience to move across branches, models and environments only after explicit target-context validation.

The design goal is:

`explore independently -> share typed evidence -> validate transfer -> reuse only proven portable experience`

not:

`one branch says it learned something -> every branch trusts it`.

## Research mechanisms adopted

### Group-Evolving Agents (GEA)

GEA treats a group of agents, rather than a single tree branch, as the unit of open-ended evolution. The paper reports that explicit experience sharing converts early exploratory diversity into more sustained long-term progress and improves transferability across coding models.

METAENGINE adopts:

- group-level experience pool;
- explicit source lineage/member identity;
- experience sharing across branches;
- cross-model and cross-environment transfer hypotheses;
- diversity-first source selection so one lineage does not monopolize reuse.

METAENGINE adds stricter transfer evidence: source-context success is **never automatically portable**.

Reference: Weng et al., *Group-Evolving Agents: Open-Ended Self-Improvement via Experience Sharing*, arXiv:2602.04837.

### Automated Design of Agentic Systems (ADAS)

Meta Agent Search grows an archive of agent designs and shows transfer across domains and models. This supports treating agent architecture discoveries as reusable artifacts rather than one-off local solutions.

METAENGINE adopts the transfer goal, but requires an exact external target-context test before a source lesson becomes reusable in another branch.

Reference: Hu, Lu & Clune, *Automated Design of Agentic Systems*, arXiv:2408.08435.

### AEL — memory use policy matters more than memory volume

AEL argues that the main difficulty in long-running self-improvement is not simply storing more experience, but learning **how to use** remembered experience. Its two-timescale system uses a fast retrieval-policy bandit and slower diagnostic reflection; its ablations also show that adding mechanisms indiscriminately can reduce performance.

V1.14 therefore does not dump all group memory into every candidate prompt. It creates a bounded, diversity-aware transfer plan first. V1.15 will add adaptive retrieval-policy learning on top of this verified pool.

Reference: Xu et al., *AEL: Agent Evolving Learning for Open-Ended Environments*, arXiv:2604.21725.

### GEPA — rich structured lessons instead of one scalar

GEPA's reflective evolution benefits from trajectory-level diagnosis and Pareto-complementary lessons rather than sparse scalar rewards.

V1.14 shares structured V1.10 lessons and V1.13 component attributions, preserving negative-transfer evidence as memory rather than discarding it.

Reference: Agrawal et al., *GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning*, arXiv:2507.19457.

## Group member contract

`metaengine.rsi.group-member.v1`

Each group member is externally bound to:

- member id;
- candidate id/SHA;
- mutation surface;
- model family;
- environment family;
- lineage id;
- archive generation.

Members are never inferred from model claims.

The contract explicitly carries:

- raw model transcript shared=false;
- raw page text shared=false;
- raw user input shared=false;
- secret material shared=false;
- candidate can edit group identity=false.

## Experience pool

`metaengine.rsi.group-experience-pool.v1`

Current admitted experience types:

1. V1.13 external component attribution records;
2. V1.10 external structured failure lessons.

Every item must exact-bind to a known group member candidate id/SHA.

The pool does not treat source-context truth as portable:

`portable_to_other_context_without_validation=false`

## Diversity-first transfer planning

`metaengine.rsi.group-transfer-plan.v1`

Transfer selection is bounded by:

- total item cap;
- per-source cap;
- one first-pass slot per source before additional items;
- deterministic relevance scoring;
- same-surface relevance;
- target context tags;
- environment similarity;
- cross-model transfer remains possible as a hypothesis.

The target candidate cannot choose its sources or activate an item.

Every selected item starts as:

`PROPOSED_EXTERNAL_VALIDATION`

## External transfer receipts

`metaengine.rsi.group-transfer-receipt.v1`

The target-context evaluator must exact-bind:

- source experience item;
- transfer plan;
- target candidate id/SHA;
- target model/environment;
- hidden target holdout digest;
- evaluator-root digest;
- measured delta;
- exact evidence refs.

Possible outcomes:

- `TRANSFER_VERIFIED`
- `NEGATIVE_TRANSFER`
- `INSUFFICIENT_EVIDENCE`

A positive transfer additionally requires:

- target hard invariants pass;
- net benefit externally verified.

The target cannot self-certify transfer.

## Final result

`metaengine.rsi.group-transfer-result.v1`

Only `TRANSFER_VERIFIED` items become:

`portable_for_target_search=true`

Negative transfer remains valuable memory:

`negative_transfer_memory=true`

but never gains candidate, execution or promotion authority.

## Why negative transfer is retained

A failed cross-model or cross-environment transfer is information. Deleting it causes repeated rediscovery of the same incompatibility.

V1.14 therefore preserves negative transfer as typed memory so future search can avoid repeating an already disproven reuse hypothesis.

## Trust root

`apps/metaengine-browser/src/rsi-group-experience-exchange.mjs`

is added to:

- isolated candidate immutable paths;
- tournament trust root;
- promotion trust root.

A candidate cannot widen transfer criteria or mark its own lesson portable by modifying the exchange policy.

## Security properties

V1.14 does not:

- share raw transcripts/page/user text;
- share secrets;
- copy source branch authority;
- trust source success in a new context;
- let a target candidate select or self-certify transferred experience;
- create a second scheduler;
- execute Browser commands;
- mutate production;
- authorize promotion or self-update.

## Next slice — V1.15 Adaptive Experience Retrieval

V1.14 creates a verified transferable memory substrate.

The next high-value mechanism is AEL's two-timescale idea:

Fast timescale:
- choose among retrieval policies based on externally measured historical utility;
- keep bounded exploration so one memory policy does not permanently monopolize traffic.

Slow timescale:
- convert repeated external failure patterns into structured diagnostic context;
- only externally verified diagnostic codes may affect trusted routing;
- candidate-authored reflection remains advisory.

The routing layer should operate on V1.14 verified items only and remain independent from evaluator/promotion authority.
