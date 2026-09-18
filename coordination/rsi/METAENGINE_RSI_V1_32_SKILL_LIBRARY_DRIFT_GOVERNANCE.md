# METAENGINE RSI V1.32 — Skill Library Drift Governance

Status: SOURCE IMPLEMENTED / STACKED ON V1.31 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-skill-frontier-convergence-v1 @ 67db43ae71dfd57c318e2be25b8bdf27ed3f4aaa`

Implementation branch:

`work/metaengine-rsi-skill-lifecycle-governance-v1`

## Purpose

The converged RSI line now has a verified skill library, meta-skill evolution, behavioral scope expansion and contrastive reliability.

The remaining lifecycle defect is that verification is currently monotonic: once a skill enters the append-only verified library, there is no separate outcome-driven ACTIVE / QUARANTINED / RETIRED view.

That can create **library drift**: a growing collection remains individually verified at creation time while routing quality degrades as stale, fragmented or harmful skills accumulate.

V1.32 keeps the evidence archive append-only but adds a separate bounded activation view.

## Research mechanisms adopted

### Library Drift — outcome-driven retirement and bounded active cap

The 2026 *Library Drift* study isolates a silent failure mode in self-evolving skill libraries: unbounded accumulation degrades retrieval, increases false-positive injections and stalls performance.

The paper's minimal effective governance recipe is:

- outcome-driven retirement;
- bounded active cap;
- meta-skill authoring prior;
- append-only trace diagnostics with per-skill contribution and router engagement.

V1.32 implements those mechanisms directly, with additional METAENGINE fail-close boundaries.

Reference: Zhang et al., *Library Drift: Diagnosing and Fixing a Silent Failure Mode in Self-Evolving LLM Skill Libraries*, arXiv:2605.19576.

### ContinualSkillBench — explicit skills are selectively useful, not universally beneficial

ContinualSkillBench finds that explicit skill maintenance does not uniformly beat in-context adaptation and that weaker models tend to accumulate larger, more fragmented task-specific skill collections.

V1.32 therefore treats library membership and **active routing eligibility** as different facts.

A skill may remain permanently auditable in the evidence archive while being dormant, quarantined or retired from active composition.

Reference: Guan et al., *ContinualSkillBench: Can LLM Agents Truly Evolve Their Capabilities?*, arXiv:2608.03874.

## New evidence contract

`metaengine.rsi.skill-lifecycle-evidence.v1`

Each lifecycle window is exact-bound to:

- library id/digest;
- skill id/version/digest;
- generation interval;
- invocation count;
- helpful/harmful/neutral/insufficient counts;
- router engagement count;
- false-positive injection count;
- hard-invariant violation count;
- measured net delta;
- external authoring-prior provenance;
- evidence refs.

Only an external evaluator may author lifecycle evidence.

Raw model transcript, page text, user input and secrets remain absent.

## Separate evidence archive and activation view

The verified skill library remains append-only evidence.

V1.32 does **not** delete or rewrite historical skill capsules.

The governance layer emits one lifecycle state:

- `ACTIVE`
- `EXPLORATION_ACTIVE`
- `DORMANT_CAP`
- `QUARANTINED`
- `RETIRED`

Every state remains auditable.

`RETIRED` means “not eligible for active composition under the current evidence”, not “delete history”.

## Retirement is evidence-driven and deliberately conservative

Premature retirement is itself harmful. V1.32 therefore requires:

- minimum total observations;
- minimum number of recent negative windows;
- negative measured contribution and/or sufficiently high harmful rate.

A single bad window cannot directly retire a skill.

Hard-invariant violations or high false-positive/harmful rates can quarantine immediately, but quarantine is not deletion.

## Active-cap governance

The active view has a hard maximum.

Selection order:

1. reserve bounded exploration slots for insufficiently tested skills;
2. rank proven-positive skills independently;
3. fill remaining capacity without exceeding the cap;
4. overflow becomes `DORMANT_CAP`.

This prevents a successful old cluster from permanently blocking all exploration while still bounding retrieval size.

## Meta-skill prior

The Library Drift paper reports value from a meta-skill authoring prior.

METAENGINE uses the prior only as a small **tie-break / exploration prior**:

- `VERIFIED_META_SKILL`
- `VERIFIED_DIRECT_SKILL`
- `LEGACY_IMPORTED`

The prior cannot override harmful evidence, quarantine or retirement.

The prior itself must be externally provenance-bound.

## Router false-positive diagnostics

V1.32 records both:

- skill invocations;
- router engagements / false-positive injections.

This distinguishes:

`the skill was bad when correctly selected`

from

`the router selected a skill that should not have been injected`.

That distinction is important for deciding whether to evolve the skill, the routing policy, or both.

## Activation view

`metaengine.rsi.skill-activation-view.v1`

An external planner may request a set of skill digests.

The view fails closed unless every requested skill is currently:

- `ACTIVE`, or
- `EXPLORATION_ACTIVE`.

`DORMANT_CAP`, `QUARANTINED` and `RETIRED` cannot be selected.

The candidate cannot override the lifecycle state.

## Trust-root changes

`apps/metaengine-browser/src/rsi-skill-library-governance.mjs`

is added to:

- Candidate Builder immutable exact paths;
- Tournament trust root;
- Promotion trust root.

The candidate therefore cannot improve its apparent performance by rewriting retirement thresholds, active-cap logic or false-positive accounting.

## Non-goals

V1.32 does not:

- delete historical skill evidence;
- let the candidate retire/reactivate itself;
- directly modify the verified skill library;
- execute any skill;
- create Browser/process authority;
- deploy production state;
- promote/install/self-update.

## Next research direction

Two recent RSI systems point to the next missing layer:

- RSIAgent: broad-then-deep autonomous environment exploration with separate curriculum / actor / verifier roles and frozen reusable causal memory;
- Recuris: Working Memory grounded in current task state selects from Experiential Memory, while execution evidence localizes failures to specific memory components.

V1.33 should add a bounded **environment causal exploration + working-memory contract** on top of the governed skill/memory substrate.
