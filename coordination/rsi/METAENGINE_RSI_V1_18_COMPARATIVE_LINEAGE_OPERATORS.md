# METAENGINE RSI V1.18 — Comparative Lineage Mutation Operators

Status: SOURCE IMPLEMENTED / STACKED ON V1.17 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-clade-metaproductivity-v1 @ 5bb91f00060e2acb076e40209b9c78d6c0def1b4`

Implementation branch:

`work/metaengine-rsi-comparative-lineage-v1`

## Purpose

V1.17 improves **which clade to expand**. V1.18 improves **what evidence the mutation proposal should compare before editing**.

Earlier RSI mutation reasoning can degenerate into:

`one failed task -> one local patch idea`

That wastes evidence already accumulated across tasks and across lineages.

V1.18 adds three proposal operators:

- `CLONAL`
- `REACTION_NORM`
- `CROSS_LINEAGE_HYBRID`

All are proposal-only. None materializes code, schedules work, evaluates, promotes or self-updates.

## Research basis — Mendel Gödel Machine

The Mendel Gödel Machine observes that self-improving coding systems commonly condition each self-modification on one failure trajectory even while the archive already contains much richer comparative evidence.

MGM introduces:

1. **clonal mutation** — the standard single-trajectory mutation;
2. **reaction-norm mutation** — condition on one agent's trajectories across multiple tasks, so recurring failures are more likely to represent agent-level defects rather than task accidents;
3. **cross-lineage hybridization** — compare agents from different lineages on the same task, transferring useful behavioral traits from a successful reference lineage to a failing target lineage.

The reported experiments and surrogate analysis argue that these comparative operators improve convergence efficiency relative to single-trajectory mutation.

Reference: *Mendel Gödel Machine: Comparative Evolution Enables State-of-the-Art Self-Improving Coding Agents*, 2026.

## METAENGINE adaptation

METAENGINE adopts the comparative structure but tightens the evidence boundary.

Raw trajectories are not injected into candidate authority context.

Every trajectory is represented as typed external evidence:

`metaengine.rsi.trajectory-evidence.v1`

with:

- exact candidate id/SHA;
- lineage id;
- task id;
- environment family;
- PASS / FAIL / AMBIGUOUS outcome;
- evaluator-root digest;
- trajectory digest;
- tool-sequence digest;
- bounded failure codes;
- bounded success-mechanism codes;
- exact external evidence refs.

The contract explicitly fixes:

- raw trajectory shared with candidate=false;
- raw page text shared=false;
- raw user input shared=false;
- secret material shared=false;
- model narrative is authority=false;
- candidate can edit trajectory evidence=false.

## Reaction norm

`createRsiReactionNormProfile()`

requires at least two distinct tasks for the **same exact candidate and lineage**.

It identifies only recurring structured evidence:

- recurring failure codes;
- recurring success-mechanism codes;
- pass/fail/ambiguous counts.

A failure code must appear on at least two tasks before it becomes a genotype-level defect signal.

The profile is evidence, not mutation authority.

## Cross-lineage contrast

`createRsiCrossLineageContrast()`

requires:

- same exact task;
- target outcome = FAIL;
- reference outcome = PASS;
- distinct candidate;
- distinct lineage;
- same evaluator-root digest;
- at least one externally verified reference success-mechanism code.

The target candidate cannot choose its reference lineage.

This prevents "hybridization" from degenerating into copying arbitrary model output from another branch.

## Comparative mutation portfolio

`createRsiComparativeMutationPortfolio()`

always preserves the clonal fallback but prefers richer comparative evidence when available.

Priority:

1. REACTION_NORM
2. CROSS_LINEAGE_HYBRID
3. CLONAL

The portfolio can carry at most three bounded proposals.

Each proposal contains only structured evidence references/codes and explicitly states:

- candidate_can_materialize_directly=false;
- candidate_can_select_operator=false;
- candidate_can_select_reference=false;
- proposal_is_scheduler_authority=false;
- authority_effect=false.

Materialization stays in the isolated candidate plane.

## Relationship to V1.17 HGM clade guidance

V1.17 answers:

> Which lineage/clade appears productive enough to expand?

V1.18 answers:

> Once a target has been selected, which comparative evidence should inform the mutation proposal?

The two mechanisms operate at different levels and do not duplicate each other.

## Relationship to V1.13 component attribution

V1.13 attributes a measured candidate result back to changed components.

V1.18 uses externally verified trajectory-level comparative evidence **before** the next mutation is proposed.

A future integration should allow positive V1.13 component attributions to become bounded success-mechanism codes, but only through an external adapter.

## Why no raw trajectories cross the trust boundary

Recent harness-evolution work shows that trajectories are valuable for diagnosing failures, but they also contain page text, user data, incidental model prose and possibly secrets.

METAENGINE therefore separates:

`raw external trace -> external diagnosis -> typed evidence codes/digests -> mutation proposal`

instead of:

`raw trace -> candidate prompt -> trusted conclusion`

This prepares the next layer for HarnessFix/AHE-style trace diagnosis without granting trace content authority.

## Trust root

`apps/metaengine-browser/src/rsi-comparative-lineage-operators.mjs`

is added to:

- isolated candidate immutable paths;
- tournament trust root;
- promotion trust root.

Candidates cannot change the rules by which comparative evidence is selected.

## Non-goals

V1.18 does not:

- claim causal transfer from a single contrast;
- share raw model/page/user text;
- copy code directly from a reference lineage;
- let the target select its reference;
- run mutation materialization;
- schedule DevOS work;
- execute Browser actions;
- replace hidden evaluation;
- promote/install/self-update.

## Next high-value slice — V1.19 Trace-Guided Harness Repair

AHE and HarnessFix indicate that self-improvement becomes more efficient when failed execution evidence is localized to the responsible harness layer before mutation.

V1.19 should add an external, typed trace intermediate representation and bounded repair specification:

- normalized step provenance;
- failure localization;
- harness layer classification;
- exact component path binding;
- predicted repair effect;
- falsifiable next-round expectation;
- regression budget;
- no raw page/user/secrets in trusted candidate context.

This should compose with V1.13 component attribution and V1.18 comparative operators rather than create another unrestricted patch generator.
