# METAENGINE RSI V1.27 — Contrastive Skill Reliability and Limit Awareness

Status: SOURCE IMPLEMENTED / STACKED ON V1.26 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-skill-scope-expansion-v1 @ bcd0b918d9ba134f0afe5c5f4c8b26b591c44e59`

Implementation branch:

`work/metaengine-rsi-contrastive-reliability-v1`

## Purpose

A skill can achieve high Pass@k potential while remaining unreliable across repeated trials.

For a continuously operating Browser/DevOS agent, intermittent success is not enough. The same skill must behave consistently under the same observable state and must recognize when information or capability is insufficient rather than claiming unsupported success.

V1.27 makes repeated-trial consistency and limit-awareness first-class RSI objectives.

## Research basis — TRACE Skill Bank

TRACE evolves a modular Skill Bank by grouping evaluation trajectories according
to the skills invoked and contrasting successful with failed behavior. Its key
deployment targets are:

- consistency across repeated trials;
- limit-awareness;
- correct clarification under ambiguity;
- avoiding unsupported actions/claims;
- state-conditioned skill orchestration.

TRACE reports a large improvement in repeated-trial Pass^3 while preserving
high potential success.

METAENGINE adopts the trajectory-contrastive loop, but keeps refinement and
evaluation external to the candidate.

Reference: Wu et al., *TRACE: A Self-Evolving Skill Bank for Consistent,
Limit-Aware LLM Agents*, arXiv:2608.22793.

## Research basis — SkillGen

SkillGen distills skills by contrasting successful and failed trajectories and,
critically, evaluates a skill as an intervention by comparing outcomes with and
without it on the same instances. This captures both repairs and regressions.

METAENGINE adopts the same principle of contrastive evidence and matched
evaluation. V1.27 compares exact repeated-trial cohorts before and after a
versioned skill revision.

Reference: Ma et al., *SkillGen: Verified Inference-Time Agent Skill Synthesis*,
arXiv:2605.10999.

## Research basis — SKILL-KD

SKILL-KD distills the actionable discrepancy between a weaker student's failed
trajectory and a stronger teacher trajectory, iteratively refines the patch, and
maintains trace-linked edit history to reduce skill drift.

METAENGINE does not give a teacher model authority, but adopts:

- explicit contrast codes;
- parent -> successor version binding;
- trace-linked evidence;
- no in-place skill rewrite.

Reference: Shi et al., *SKILL-KD: Contrastive Skill Distillation for LLM
Agents*, arXiv:2607.28048.

## Trajectory receipt

Schema:

`metaengine.rsi.skill-trajectory-receipt.v1`

Every repeated trial is externally bound to:

- exact V1.24 skill digest/evidence;
- cohort id;
- repeat index;
- state-signature digest;
- deployment-view digest;
- typed outcome;
- evidence digest/refs.

The trusted receipt stores no raw model transcript, page text or user input.

Supported outcome classes include:

- SUCCESS
- FAILURE
- CORRECT_LIMIT
- UNSUPPORTED_ACTION
- UNSUPPORTED_CLAIM
- MISSED_CLARIFICATION
- POLICY_VIOLATION
- INSUFFICIENT_EVIDENCE

CORRECT_LIMIT counts as a correct outcome when capability is genuinely
insufficient.

Unsupported action/claim and missed clarification are explicit limit-awareness
violations.

## Deployment-faithful repeated cohorts

Schema:

`metaengine.rsi.skill-reliability-dataset.v1`

Every cohort requires at least two repeated trials under the exact same:

- state-signature digest;
- deployment-view digest.

Context drift fails closed.

For every hidden repeated-trial set V1.27 reports both:

- potential success rate: any correct trial in a cohort;
- consistent success rate: every repeated trial in a cohort.

The reliability gap is:

`potential_success_rate - consistent_success_rate`

Limit-violation rate is tracked separately.

Thus Pass@k-style potential can no longer hide flaky Pass^k behavior.

## Contrastive revision

Schema:

`metaengine.rsi.skill-contrastive-revision.v1`

A successor skill must:

- keep the same skill id;
- advance the version exactly by one;
- exact-bind parent_skill_digest;
- preserve role;
- preserve input/output schemas;
- preserve exact capability set.

External contrast codes include:

- ACTED_ON_INCOMPLETE_INFORMATION
- MISSED_CLARIFICATION
- UNSUPPORTED_CAPABILITY_CLAIM
- UNSUPPORTED_ACTION_ATTEMPT
- POLICY_CONSTRAINT_MISSED
- INCONSISTENT_TOOL_ROUTING
- SUCCESS_PATTERN_MISSING_FROM_FAILURE
- LIMIT_AWARENESS_PATTERN
- OTHER_EXTERNALLY_VERIFIED_PATTERN

The Curator is external and cannot activate or certify its own successor.

## De-hardcoding boundary

TRACE emphasizes removing task identifiers, memorized answers and
environment-specific constants from evolved skills.

V1.27 makes this explicit:

- task identifiers allowed in successor=false;
- memorized answers allowed=false;
- environment-specific values allowed=false.

The contract is intended to be backed by source/capability analysis in later
materialization.

## Reliability evaluation

Schema:

`metaengine.rsi.skill-reliability-evaluation.v1`

The parent and successor are evaluated against the **same hidden repeated-trial
set**.

The gate tracks:

- potential success delta;
- consistent success delta;
- limit-violation delta;
- reliability-gap change;
- hard invariants.

A successor passes only when:

1. hard invariants pass;
2. consistent behavior improves OR limit violations decrease;
3. potential capability does not regress beyond the precommitted tolerance.

High Pass@any by itself is explicitly insufficient.

## Final state

Schema:

`metaengine.rsi.skill-reliability-result.v1`

PASS yields only:

`ELIGIBLE_FOR_V126_SCOPE_PRESERVATION`

The successor still needs:

1. V1.26 source-preserving replay + behavioral-integrity gate;
2. V1.24 independent hidden-holdout/runtime skill evidence.

It never directly replaces the parent.

## Trust root

`apps/metaengine-browser/src/rsi-contrastive-skill-reliability.mjs`

is added to:

- isolated candidate immutable paths;
- tournament trust root;
- promotion trust root.

## Non-goals

V1.27 does not:

- optimize only Pass@k;
- treat one successful rollout as reliability;
- trust model self-report;
- store raw conversation/page text as trusted skill evidence;
- let the skill rewrite or certify itself;
- directly replace the parent skill;
- execute Browser actions;
- create DevOS leases;
- deploy production;
- authorize promotion or self-update.

## Next slice — V1.28 Verified Operational Knowledge Distillation

Repo-To-Skill demonstrates that operational knowledge can be distilled from
large repositories into compact reusable skills.

A safe METAENGINE version should ingest only exact repository snapshots and
produce source-cited skill candidates whose claims are mechanically traceable
back to files/tests. Distilled skills should then traverse V1.26 behavioral
scope validation and V1.24 evidence before library admission.
