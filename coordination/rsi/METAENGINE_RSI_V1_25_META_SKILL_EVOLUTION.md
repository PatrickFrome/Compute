# METAENGINE RSI V1.25 — Two-Timescale Verified Meta-Skill Evolution

Status: SOURCE IMPLEMENTED / STACKED ON V1.24 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-skill-library-v1 @ 096a96503e533f4522084c0b1fa62a3dfb3560f4`

Implementation branch:

`work/metaengine-rsi-meta-skill-evolution-v1`

## Purpose

V1.24 creates verified reusable task skills. V1.25 adds the missing recursive layer: improve not only *what* the agent does, but also the typed pipeline that improves those skills.

The design follows a strict two-timescale split:

- fast loop: accumulate external evidence about task-skill behavior;
- slow loop: modify the skill profile used by the improvement pipeline itself.

The slow loop cannot activate itself and remains behind the existing evaluator/tournament/risk/promotion boundaries.

## Research basis — MetaSkill-Evolve

MetaSkill-Evolve separates a task skill `s` from a branch-local meta-skill
`m=(ψ,σ,α,π,ε)`, corresponding to Analyzer, Retriever, Allocator, Proposer
and Evolver components. Task skills evolve quickly, while the meta-skill evolves
more slowly under the same broad improvement principle. The paper reports
held-out improvements over no-skill, static-skill and single-level evolution
baselines using a single frozen model backbone.

METAENGINE adopts the key mechanism:

- ANALYZER
- RETRIEVER
- ALLOCATOR
- PROPOSER
- EVOLVER

are explicit verified skill bindings.

Reference: Wang et al., *MetaSkill-Evolve: Recursive Self-Improvement of LLM
Agents via Two-Timescale Meta-Skill Evolution*, arXiv:2607.05297.

## Why METAENGINE keeps a stronger boundary

MetaSkill evolution is especially easy to self-game: if the same candidate can
change its analyzer, retrieval policy, proposal policy, evaluator and stopping
criteria in one step, an apparent gain may come from changing the measurement
process instead of improving capability.

V1.25 therefore freezes:

- model backbone family;
- evaluator root;
- promotion root;
- scheduler root;
- signing root;
- self-update root.

The meta-profile can only select **already VERIFIED V1.24 skill versions**.

## Meta-skill profile

Schema:

`metaengine.rsi.meta-skill-profile.v1`

The profile binds exactly five verified roles:

- ANALYZER
- RETRIEVER
- ALLOCATOR
- PROPOSER
- EVOLVER

Every role binding carries:

- skill id;
- immutable skill version;
- skill digest;
- evidence digest;
- input/output schema digests.

The profile additionally binds:

- V1.24 library digest;
- profile generation;
- fast-skill epoch;
- slow-meta epoch;
- one frozen backbone family.

A candidate cannot bind an unverified skill or activate the profile.

## Fast loop summary

Schema:

`metaengine.rsi.meta-skill-fast-loop-summary.v1`

Fast-loop evidence is external and bounded to the exact parent profile.

It records:

- episode count;
- HELPFUL count;
- HARMFUL count;
- NEUTRAL count;
- INSUFFICIENT_EVIDENCE count;
- fast-loop holdout digest;
- evidence refs.

The summary explicitly has:

- slow_meta_update_authority=false;
- profile_activation_authority=false.

This prevents ordinary task-skill feedback from silently rewriting the
improvement pipeline.

## Slow meta update

Schema:

`metaengine.rsi.meta-skill-evolution-plan.v1`

A slow update is allowed to become an evaluation proposal only when:

1. enough fast-loop episodes exist;
2. successor profile generation advances exactly by one;
3. slow meta epoch advances exactly by one;
4. fast skill epoch does not regress;
5. frozen backbone family is unchanged;
6. at least one role changed;
7. changed roles stay under the bounded policy cap;
8. fast-loop and slow-loop holdouts are different.

Current default maximum role changes per slow step is one; absolute policy cap
is two. This reduces confounding and makes later V1.13 component attribution
meaningful.

## Separate holdouts

V1.25 deliberately forbids using the same holdout for fast skill learning and
slow meta-profile evaluation.

Reason:

`fast feedback -> optimize profile -> test on the same feedback set`

would turn the meta-loop into a direct overfitting channel.

The plan therefore requires:

`fast_holdout_digest != meta_holdout_digest`

and the candidate cannot choose the meta holdout.

## External meta evaluation

Schema:

`metaengine.rsi.meta-skill-evaluation.v1`

Parent and successor profiles are compared on the meta holdout using typed
objective vectors.

The evaluator preserves multi-objective structure:

- PARETO_ADVANCE
- TRADEOFF_STEPPING_STONE
- NO_MEASURED_ADVANCE
- DOMINATED_REGRESSION
- HARD_INVARIANT_REJECT

No scalar winner is authoritative.

Hard invariant failure dominates any quality increase.

## Final state

Schema:

`metaengine.rsi.meta-skill-evolution-result.v1`

PARETO_ADVANCE and TRADEOFF_STEPPING_STONE may produce:

`ELIGIBLE_FOR_META_ARCHIVE`

Everything else becomes:

`REJECTED_FROM_META_ARCHIVE`

Even archive eligibility has:

- successor_profile_activation_authorized=false;
- parent_profile_replacement_authorized=false;
- meta_archive_admission_is_promotion=false;
- existing RSI tournament still required;
- existing V1.11 recursive-risk gate still required.

## Relationship to AEL

AEL shows that memory/retrieval policy learning can outperform indiscriminately
adding more mechanisms, and its ablations find that several extra mechanisms
can actually hurt. V1.25 follows that warning:

- the meta-profile evolves slowly;
- role changes are bounded;
- fast and slow evidence are separated;
- no automatic profile activation occurs.

Reference: Xu et al., *AEL: Agent Evolving Learning for Open-Ended
Environments*, arXiv:2604.21725.

## Relationship to STOP / Gödel Agent / Meta^n

STOP and Gödel Agent demonstrate that improving the improver itself can produce
better downstream behavior. Meta^n shows a complementary stability strategy:
keep a meta-operation fixed while recursively increasing the information
available to it.

METAENGINE combines these directions conservatively:

- V1.23 keeps the recursive depth operator fixed;
- V1.25 evolves a **typed profile of verified helper skills**, not the trusted
  evaluator/promotion/scheduler machinery itself.

References:
- Zelikman et al., *Self-Taught Optimizer (STOP)*, arXiv:2310.02304.
- Yin et al., *Gödel Agent*, arXiv:2410.04444.
- Kim et al., *Meta^n*, arXiv:2608.24735.

## Trust root

`apps/metaengine-browser/src/rsi-meta-skill-evolution.mjs`

is added to:

- isolated candidate immutable paths;
- tournament trust root;
- promotion trust root.

The meta-profile therefore cannot redefine the rule that governs its own slow
evolution.

## Non-goals

V1.25 does not:

- directly evolve model weights;
- run Browser effects;
- create DevOS tasks or leases;
- deploy production;
- activate its own successor;
- change evaluator/promotion/scheduler/signing/self-update roots;
- let a candidate choose its holdout;
- collapse multi-objective evidence to one scalar;
- bypass tournament/statistical/promotion gates.

## Next slice — V1.26 verified skill synthesis and distillation

A useful next step is to turn repeated V1.13/V1.24 evidence into **smaller,
more general successor skills** rather than only selecting among existing ones.

Candidate mechanism sources:

- Voyager: compositional skill reuse;
- MUSE-Autoskill: iterative skill refinement with skill-level memory;
- HASP: stable program-function evolution;
- AlphaEvolve/FunSearch: evolutionary simplification of useful programs.

The V1.26 synthesis boundary should require equivalence/holdout proof before a
compressed or generalized skill can supersede an older version.
