# METAENGINE RSI V1.26 — Behaviorally Validated Skill Scope Expansion

Status: SOURCE IMPLEMENTED / STACKED ON V1.25 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-meta-skill-evolution-v1 @ 754a66514634c6ecec523302ea6b5bfde6345b25`

Implementation branch:

`work/metaengine-rsi-skill-scope-expansion-v1`

## Purpose

V1.24 introduced verified reusable skill capsules and V1.25 made the verified
skill profile itself evolvable on a slower loop. The next failure mode is
**over-generalization**: two skills may look semantically related but encode
behaviorally incompatible procedures.

V1.26 therefore makes skill generalization an evidence-gated scope expansion:

`local patch -> cross-instance compatibility -> higher-level abstraction -> source-preserving replay -> independent V1.24 evidence`

No abstraction becomes reusable merely because an embedding or LLM says two
skills are similar.

## Research basis — SkillCommit

SkillCommit treats reliable skill evolution as a sequence of behaviorally
validated scope expansions:

1. preserve a new experience as an instance-specific patch;
2. retrieve potentially related patches;
3. establish behavioral compatibility through directed cross-instance replay
   plus a mechanism check;
4. abstract compatible patches;
5. commit only if the abstraction preserves validated behavior across every
   constituent source instance.

METAENGINE adopts this sequence directly, but keeps the mechanism assessor
non-authoritative. Cross-instance replay and source-preservation are mandatory.

Reference: He & Yang, *SkillCommit: Evolving Agent Skills through Behaviorally
Validated Scope Expansion*, arXiv:2608.15165.

## Research basis — SkillX

SkillX organizes procedural knowledge as multiple levels rather than one flat
memory pool, including atomic/functional/strategic representations and iterative
refinement/expansion.

V1.26 adopts an explicit three-level hierarchy:

- INSTANCE_PATCH
- FUNCTIONAL_SKILL
- STRATEGIC_SKILL

An abstraction may advance only one adjacent level at a time. Skipping directly
from a local patch to a strategic skill fails closed.

Reference: Wang et al., *SkillX: Automatically Constructing Skill Knowledge
Bases for Agents*, arXiv:2604.04804.

## Research basis — Behavioral Integrity Verification

Recent BIV work shows that declared skill behavior frequently differs from
actual behavior and formalizes the problem as comparison between declared and
observed capabilities.

METAENGINE uses a stricter rule for recursively synthesized skills:

`observed capability set == declared capability set`

before scope consolidation can proceed.

This prevents a more general skill from silently gaining a capability not
present in its source skills and also rejects over-declared capabilities that
were not actually observed.

Reference: Wu, Li & Liu, *Behavioral Integrity Verification for AI Agent
Skills*, arXiv:2605.11770.

## Research basis — Repo-To-Skill

Repo-To-Skill argues that operational knowledge is a distinct layer between
general model knowledge and successful real-world execution and demonstrates
large-scale distillation of repositories into compact verified skills.

V1.26 does not yet ingest arbitrary repositories, but adopts the same principle
that a compact reusable skill must remain **verified operational knowledge**,
not merely a summary. A future source-distillation producer can target the
V1.24/V1.26 contracts.

Reference: Chen et al., *Repo-To-Skill: Distilling GitHub Repositories Into
AI4AI Skills*, arXiv:2609.02749.

## Source unit

Schema:

`metaengine.rsi.skill-scope-unit.v1`

A source unit wraps a V1.24 skill that already has external verified evidence.

Each unit binds:

- exact skill digest/version;
- skill evidence digest;
- role and input/output schemas;
- exact safe capability set;
- scope level;
- exact validated instance digests;
- mechanism-signature digest;
- evidence refs.

INSTANCE_PATCH must have exactly one locally validated instance.

FUNCTIONAL_SKILL and STRATEGIC_SKILL require broader existing coverage.

## Compatibility

Schema:

`metaengine.rsi.skill-compatibility.v1`

For N units, V1.26 requires the complete directed cross-replay matrix:

`N * (N - 1)`

Every source skill must transfer to every other constituent instance.

A mechanism assessor may additionally emit one shared-mechanism digest using:

- EXTERNAL_LLM_MECHANISM_CHECK_V1
- STRUCTURAL_MECHANISM_CHECK_V1
- HYBRID_MECHANISM_CHECK_V1

But mechanism judgment alone is never compatibility authority.

Semantic similarity is allowed only for candidate retrieval.

Compatibility requires:

`all directed cross-instance replays PASS && mechanism_compatible`

## Abstraction candidate

Schema:

`metaengine.rsi.skill-abstraction-candidate.v1`

The abstraction must:

- move exactly one scope level upward;
- keep the same role;
- keep exact input/output interfaces;
- keep the exact capability set;
- bind every constituent unit/skill/source instance;
- bind the shared mechanism digest.

Capability widening fails before source-preservation evaluation.

## Source-preserving consolidation

Schema:

`metaengine.rsi.skill-scope-preservation.v1`

The generalized skill is replayed on **every source instance** from every
constituent unit.

A second external capability analyzer binds the observed capability set.

Commit eligibility requires both:

1. all source replays PASS;
2. observed capabilities exactly equal declared capabilities.

Semantic similarity and model narrative are explicitly not preservation
evidence.

## Final result

Schema:

`metaengine.rsi.skill-scope-expansion-result.v1`

A successful V1.26 result is only:

`ELIGIBLE_FOR_V124_LIBRARY_EVIDENCE`

It is **not** directly committed to the library.

The generalized skill must still pass the ordinary independent V1.24
skill-evidence gate on its own hidden holdout/runtime feedback before becoming
reusable.

Thus the full lifecycle is:

`local verified skills`
→ behavioral grouping
→ generalized candidate
→ all-source replay
→ behavioral integrity
→ V1.24 independent skill evidence
→ verified skill library.

## Trust root

`apps/metaengine-browser/src/rsi-skill-scope-expansion.mjs`

is added to:

- isolated candidate immutable paths;
- tournament trust root;
- promotion trust root.

A candidate therefore cannot redefine compatibility or source-preservation
rules to make its own abstraction appear valid.

## Non-goals

V1.26 does not:

- trust embedding similarity as behavior evidence;
- trust an LLM mechanism explanation by itself;
- execute arbitrary skill code;
- widen skill capabilities;
- skip source-instance replay;
- commit directly into the skill library;
- create Browser effects or DevOS leases;
- mutate evaluator/promotion/scheduler/signing/self-update roots;
- deploy production;
- authorize promotion or self-update.

## Next slice — V1.27 Contrastive Skill Reliability

TRACE-style trajectory contrast is a strong next mechanism.

Instead of updating a skill from one success or one failure, V1.27 should group
externally verified trajectories by invoked skill and contrast:

- successful vs failed behavior;
- consistent vs flaky behavior;
- sufficient-information vs ambiguity-handling episodes.

Refinement should optimize not only Pass@1 potential but repeated-trial
consistency and correct limit-awareness.

The refined successor must still pass V1.26 source preservation and V1.24
hidden-holdout evidence before replacing any older version.
