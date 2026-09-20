# METAENGINE RSI V1.15 — Adaptive Two-Timescale Experience Retrieval

Status: SOURCE IMPLEMENTED / STACKED ON V1.14 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-group-experience-v1 @ 3f7388861701b0857f4b8ac9aea2df72eb04be86`

Implementation branch:

`work/metaengine-rsi-adaptive-retrieval-v1`

## Purpose

V1.14 creates a verified group experience substrate, but a large memory pool can still degrade an agent if irrelevant or misleading experience is injected into every episode.

V1.15 learns **how to retrieve verified experience**, not merely how to store more of it.

The design has two timescales:

Fast:
- choose a retrieval policy from externally measured historical outcomes.

Slow:
- inject externally verified diagnostic codes that describe recurring failure patterns and change how the retrieval policies are interpreted.

Candidate code cannot edit either layer.

## Research basis

### AEL — Agent Evolving Learning

AEL identifies the bottleneck in long-running self-improvement as learning how to use remembered experience. It uses:

- Thompson Sampling at the fast timescale to choose a memory retrieval policy;
- slower reflection to diagnose failure patterns and provide an interpretive frame.

Its ablations also show a critical warning: adding more mechanisms can reduce performance. Memory plus reflection helped, while several additional mechanisms degraded results.

METAENGINE adopts the two-timescale architecture but replaces candidate-authored free-form reflection with externally verified diagnostic codes.

Reference: Xu et al., *AEL: Agent Evolving Learning for Open-Ended Environments*, arXiv:2604.21725.

### GEPA — reflective feedback should stay information-rich

GEPA demonstrates that rich trajectory diagnosis can outperform sparse scalar optimization with many fewer rollouts.

METAENGINE preserves structured failure/attribution context in retrieval ranking, but does not trust free-form LLM reflection as causal or routing authority.

Reference: Agrawal et al., *GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning*, arXiv:2507.19457.

### GEA — shared experience only helps if reuse stays selective

Group-Evolving Agents show the benefit of sharing discoveries across evolving agents. V1.14 provides the verified transfer substrate; V1.15 adds the missing policy that chooses which portable experiences should actually enter a target episode.

Reference: Weng et al., *Group-Evolving Agents: Open-Ended Self-Improvement via Experience Sharing*, arXiv:2602.04837.

## Fast timescale

Primary implementation:

`apps/metaengine-browser/src/rsi-adaptive-experience-retrieval.mjs`

State schema:

`metaengine.rsi.retrieval-policy-state.v1`

Current retrieval policy arms:

- `FAILURE_FIRST`
- `ATTRIBUTION_FIRST`
- `CROSS_MODEL_TRANSFER`
- `SAME_CONTEXT`
- `DIVERSITY_BALANCED`

Each arm records externally verified:

- attempts;
- useful episodes;
- harmful episodes;
- neutral episodes.

The state derives a Beta posterior and uses:

`SEEDED_THOMPSON_SAMPLING`

The random stream is deterministically seeded from exact state, transfer-result and episode evidence. Exact replay therefore yields the same sample and selection.

Candidate code cannot:

- edit statistics;
- choose a policy;
- change the seed;
- mark feedback as useful.

## Slow timescale

Diagnostic schema:

`metaengine.rsi.memory-diagnostic.v1`

Allowed structured diagnostic classes:

- `FAILURE_RECURRENCE`
- `CREDIT_ASSIGNMENT_UNCERTAIN`
- `CROSS_MODEL_SUCCESS`
- `NEGATIVE_TRANSFER_CLUSTER`
- `DIVERSE_SOURCES_HELPED`
- `STALE_MEMORY_RISK`

Diagnostics are externally verified and exact-bound to evidence digests/refs.

They do not contain trusted free-form reflection.

A diagnostic may add only a small bounded bias to the corresponding retrieval arm. It cannot directly select memory, execute tools, alter evaluation, or promote candidates.

## Retrieval boundary

The adaptive plan can consume only V1.14 records with:

`portable_for_target_search=true`

Negative transfer remains memory but is not injected as positive candidate context.

Every selected item remains bound to:

- group pool digest;
- transfer-plan digest;
- transfer-result digest;
- exact transfer receipt;
- target holdout digest.

The candidate cannot include unverified memory.

## Feedback

Schema:

`metaengine.rsi.retrieval-feedback.v1`

After an episode, only an external evaluator may report:

- useful retrieval;
- harmful regression;
- neutral episode.

The feedback is exact-bound to:

- retrieval plan;
- policy state digest/update sequence;
- selected policy;
- external evidence digest/refs.

Applying feedback advances only the selected arm and increments the state sequence.

Candidate-authored feedback is rejected.

## Why deterministic Thompson sampling

A normal online Thompson sampler is stochastic. In a recursive improvement control plane, non-replayable randomness makes incident reconstruction and attribution harder.

METAENGINE therefore uses a deterministic pseudorandom stream derived from exact evidence. It preserves posterior sampling behavior while making the decision replayable from durable state.

The seed does not make the candidate authoritative because the candidate cannot edit state, feedback or diagnostic evidence.

## Security properties

V1.15 does not:

- retrieve unverified cross-branch experience;
- trust candidate-authored reflection;
- let the candidate edit bandit statistics;
- make retrieval an evaluator;
- make retrieval a promotion gate;
- execute Browser/process actions;
- create a scheduler or lease;
- deploy production code;
- authorize self-update.

## Next slice — V1.16 architecture evolution search

The strongest remaining research mechanism is ADAS / Gödel Agent-style search over agent architecture itself.

METAENGINE should expose a narrowly bounded architecture mutation surface covering:

- prompt topology;
- agent routing graph;
- tool-selection policy;
- reflection/retrieval composition;
- bounded orchestration control flow.

It must explicitly exclude:

- evaluator roots;
- promotion/security roots;
- scheduler authority;
- signing/self-update roots;
- arbitrary shell/eval.

Architecture candidates should enter the same V1.10–V1.15 loop: archive search, hidden curriculum, component attribution, transfer validation, adaptive retrieval and risk-controlled external promotion review.
