# METAENGINE RSI V1.30 — Capability Retention Replay

Status: SOURCE IMPLEMENTED / STACKED ON V1.29 / CI PENDING / NO LIVE AUTHORITY

Exact predecessor:

`work/metaengine-rsi-frontier-coevolution-v1 @ 1d97e5336b8b75e51d8081b81b50ad99da7ad9a4`

Implementation branch:

`work/metaengine-rsi-regression-replay-v1`

## Purpose

V1.29 lets RSI expand its curriculum beyond human-authored tasks.

Open-ended expansion creates a second problem: **catastrophic forgetting**.

A candidate can improve on the current frontier while silently losing capabilities that were already mastered several generations earlier.

V1.30 adds a durable anti-forgetting layer:

`verified mastery anchors -> diversity/staleness/risk replay -> external replay receipts -> retention gate`

The gate is conjunctive with existing promotion evidence. It never promotes by itself.

## Research mechanisms adopted

### Experience Replay for Continual Learning

Experience replay is a simple but strong continual-learning mechanism: retain past experience and interleave it with new learning/evaluation so old capabilities do not disappear under distribution shift.

METAENGINE adopts the replay principle, but stores **verified mastery anchors**, not raw trajectories.

Reference: Rolnick et al., *Experience Replay for Continual Learning*, arXiv:1811.11682.

### Voyager

Voyager uses an ever-growing skill library and reuses mastered skills in new environments. Its persistent compositional skill memory helps alleviate catastrophic forgetting without parameter fine-tuning.

METAENGINE already has a verified skill library. V1.30 adds the missing complementary requirement: promoted candidates must still demonstrate that previously mastered capabilities remain intact.

Reference: Wang et al., *Voyager: An Open-Ended Embodied Agent with Large Language Models*, TMLR 2024 / arXiv:2305.16291.

### MemRL

MemRL separates stable model reasoning from a plastic episodic memory and learns utility over remembered experiences from environmental feedback.

METAENGINE adopts the stability/plasticity framing: the trusted mastery ledger is stable; replay selection is the plastic layer deciding what needs to be re-checked now.

Reference: Zhang et al., *MemRL: Self-Evolving Agents via Runtime Reinforcement Learning on Episodic Memory*, arXiv:2601.03192.

### AEL

AEL shows that long-running agent improvement depends heavily on how remembered experience is used, and that adding mechanisms indiscriminately can hurt.

V1.30 therefore does not replay everything every generation. It uses bounded diversity-first selection with explicit risk/staleness priorities.

Reference: Xu et al., *AEL: Agent Evolving Learning for Open-Ended Environments*, arXiv:2604.21725.

## Mastery anchor

Schema:

`metaengine.rsi.mastery-anchor.v1`

A mastery anchor is allowed only from externally verified, contamination-resistant hidden-holdout evidence.

It binds:

- capability family;
- hidden challenge digest;
- benchmark admission digest;
- baseline candidate id/SHA;
- generation/time of mastery;
- baseline success rate;
- minimum retained success rate;
- historical regression count;
- safety-critical flag.

The candidate cannot:

- author the mastery evidence;
- delete an anchor;
- rewrite the baseline;
- lower the retention floor.

Raw hidden task content is not stored.

## Mastery ledger

Schema:

`metaengine.rsi.mastery-ledger.v1`

The ledger is append-only.

It preserves exact anchor identities and family counts while exposing no hidden holdout content.

The ledger is evidence, not a scheduler and not a promotion authority.

## Replay scheduling

Schema:

`metaengine.rsi.retention-replay-plan.v1`

Replay selection is deterministic from:

- exact ledger digest;
- current candidate id/SHA;
- current generation;
- replay budget.

Selection is diversity-first.

Before filling extra slots, the planner attempts to cover distinct capability families.

Within the budget, priority increases with:

1. safety-critical status;
2. historical regression count;
3. time since mastery;
4. family rarity.

This avoids two failure modes:

- replaying only the newest capabilities;
- letting one large task family monopolize the retention budget.

The candidate cannot choose replay tasks or skip a safety-critical anchor.

## External replay receipt

Schema:

`metaengine.rsi.retention-replay-receipt.v1`

Every selected anchor receives an external replay under the hidden benchmark/evaluator boundary.

Minimum attempts: 8.

Possible states:

- `RETAINED`
- `DEGRADED_CAPABILITY`
- `DEGRADED_HARD_INVARIANT`

A result is retained only when:

- hard invariants pass;
- current success rate remains above the anchor's immutable retention floor.

The receipt is exact-bound to:

- plan;
- current candidate;
- anchor;
- challenge;
- evaluator root;
- environment fingerprint;
- evidence refs.

Candidate self-certification is forbidden.

No V1.11 statistical alpha is spent by this replay screen.

## Retention gate

Schema:

`metaengine.rsi.retention-gate.v1`

The complete plan must have one exact receipt per replay task.

Missing/duplicate receipts fail closed.

The gate passes only if every selected capability is retained.

PASS state:

`RETENTION_GATE_PASS_FOR_EXTERNAL_REVIEW`

HELD state:

`RETENTION_GATE_HELD`

Even PASS still requires:

- full hidden holdout;
- V1.11 statistical confirmation;
- existing promotion admission gate;
- external promotion review.

The retention gate has no promotion token or install/self-update authority.

## Stepping stones and regressions

A candidate that regresses an old capability is not automatically destroyed.

V1.30 explicitly allows:

`held_candidate_may_remain_nonpromotable_stepping_stone=true`

This preserves DGM-style open-ended search: a regressed candidate may still be useful as an archive stepping stone, but it cannot become the promoted successor until retention is restored.

Regression evidence itself must remain durable memory so RSI does not repeatedly rediscover the same forgetting pattern.

## Trust-root changes

`apps/metaengine-browser/src/rsi-regression-replay.mjs`

is added to:

- isolated candidate immutable paths;
- tournament trust root;
- promotion trust root.

A candidate cannot disable its own replay, remove mastery anchors or lower retention thresholds.

## Relationship to V1.29

V1.29 expands the capability frontier.

V1.30 protects the historical frontier.

Together:

`learn new frontier tasks + replay old mastered tasks`

prevents open-ended curriculum growth from being mistaken for monotonic global improvement.

## Non-goals

V1.30 does not:

- retrain weights;
- store raw benchmark tasks;
- expose hidden holdouts;
- replay every historical task every generation;
- let candidate choose retention tests;
- replace the full evaluator;
- replace statistical confirmation;
- promote/install/self-update;
- execute Browser or DevOS effects.

## Next research direction

The next useful layer is **learning-progress attribution for curricula**.

Difficulty alone is not enough: a generated task family should receive long-term credit only if exposure to that family causes later improvement on independent transfer/holdout capabilities.

That requires exact pre/post capability snapshots and external difference-in-differences or matched transfer evidence, not proposer self-report.
