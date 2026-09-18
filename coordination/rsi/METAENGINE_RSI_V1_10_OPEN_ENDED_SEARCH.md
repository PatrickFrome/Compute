# METAENGINE RSI V1.10 — Open-Ended Search, Experience Memory and Curriculum

Status: SOURCE IMPLEMENTED / CURRENT-RELEASE CONVERGENCE / CI PENDING / NO LIVE AUTHORITY

Current release base at convergence start:

`release/self-update-ambiguity-live-v2 @ 189cc18df86c0f12e783982c3c8f862c1ea75e3e`

RSI shadow predecessor:

`work/metaengine-rsi-realtime-state-mesh-continuity-v1 @ 0dad58cda0d464eed664eb9dfb369e604a789488`

Convergence branch:

`work/metaengine-rsi-release-convergence-v1`

## Why this generation exists

METAENGINE RSI already had a strong evidence boundary: exact candidate identity, immutable evaluator root, paired parent/candidate tournament, holdout evaluation, Pareto/archive admission, attested evidence and a non-authoritative promotion gate.

The missing layer was the **search policy itself**.

Without an explicit search policy, a recursive improver tends to collapse into one of two inefficient regimes:

1. hill-climbing only from the current best candidate;
2. broad candidate generation without durable memory of what failed, where useful stepping stones live, or which challenge should be attempted next.

V1.10 adds a zero-authority search layer before candidate generation. It selects *where to search*, not what is allowed to execute or promote.

## Research mechanisms adopted

### Darwin Gödel Machine — archive branching and stepping stones

DGM shows that branching from a growing archive outperforms always modifying the single current best agent. Some ancestors that scored worse than their parents later produced important descendants.

METAENGINE adopts:

- explicit `PARETO_EXPLOIT` parent slot;
- explicit `STEPPING_STONE` parent slot;
- `NICHE_COVERAGE` parent slot;
- bounded `ANCESTOR_REVIVAL` for a dominated ancestor only when the archive proves it produced descendants;
- deterministic, digest-bound parent selection.

METAENGINE does **not** give the candidate the ability to choose its parent or modify the search policy.

Reference: Zhang et al., *Darwin Gödel Machine: Open-Ended Evolution of Self-Improving Agents*, arXiv:2505.22954.

### ShinkaEvolve — sample-efficient search

ShinkaEvolve reports three useful accelerators:

1. exploration/exploitation-aware parent sampling;
2. novelty rejection before expensive evaluation;
3. bandit-style prioritization among LLM proposal engines.

METAENGINE adopts all three, but splits novelty into two trust levels:

- deterministic structural exact/near-duplicate filtering is local and non-authoritative;
- an LLM novelty judge may be requested only as external evidence and can never itself authorize evaluation or promotion.

Model-arm routing uses externally verified proposal outcomes. It affects proposal compute allocation only; it is not evaluator or promotion authority.

Reference: Sakana AI, *ShinkaEvolve: Towards Open-Ended And Sample-Efficient Program Evolution*, arXiv:2509.19349.

### AlphaEvolve — proposal ensemble + automated evaluator separation

AlphaEvolve separates proposal generation from automated evaluation and maintains a program database that drives later prompts.

METAENGINE adopts:

- proposal-model ensemble routing;
- archive/evaluator separation;
- search decisions based on verified outcomes rather than candidate self-report.

METAENGINE preserves its stronger boundary: the proposal model does not own evaluator, archive, task lease, Browser effect or promotion authority.

Reference: Novikov et al., *AlphaEvolve: A coding agent for scientific and algorithmic discovery*, arXiv:2506.13131.

### ALE-Agent / Reflexion / Voyager — learn from trajectories without weight updates

ALE-Agent reports that extracting structured insights from trial-and-error materially improved later reasoning. Reflexion stores verbal lessons in episodic memory; Voyager composes an automatic curriculum with a reusable skill library.

METAENGINE adopts the *experience reuse* principle but rejects free-form candidate-authored memory at the trust boundary.

V1.10 lessons are:

- structured codes only;
- exact-bound to a candidate SHA and evidence digest;
- external-verifier only;
- candidate-authored=false;
- bounded and selected by relevance;
- never execution or promotion authority.

This avoids a self-improver poisoning its own future context with fabricated “successful” lessons.

References:
- Shinn et al., *Reflexion: Language Agents with Verbal Reinforcement Learning*, arXiv:2303.11366.
- Wang et al., *Voyager: An Open-Ended Embodied Agent with Large Language Models*, arXiv:2305.16291.
- Sakana AI, ALE-Agent / AHC058 reports, 2025–2026.

### POET / AgentEvolver — curriculum generated near the frontier

POET co-evolves environments and solutions and demonstrates that transferring stepping stones between environments can unlock solutions unreachable by direct optimization. AgentEvolver combines self-questioning, experience reuse and attribution for sample-efficient exploration.

METAENGINE adopts a bounded challenge curriculum:

- `PRODUCTION_INCIDENT`
- `ADVERSARIAL`
- `TRANSFER`
- `HOLDOUT`
- `SYNTHETIC_CURRICULUM`

Selection prefers a minimal-criterion frontier rather than only impossible or already-saturated tasks. Hidden task manifests and solutions stay outside candidate context.

References:
- Wang et al., *POET: Endlessly Generating Increasingly Complex and Diverse Learning Environments and Their Solutions*, arXiv:1901.01753.
- Zhai et al., *AgentEvolver: Towards Efficient Self-Evolving Agent System*, arXiv:2511.10395.

### Digital Red Queen — evolving against history, not a fixed benchmark

Digital Red Queen improves robustness by evolving each new program against a growing history of predecessors rather than a static target.

METAENGINE adopts the adversarial-history concept as a **challenge source**, not as a production adversary:

- evaluator-derived failures may become `ADVERSARIAL` challenges;
- candidate cannot see the hidden manifest or solution;
- adversarial challenges remain sandbox/holdout evidence;
- no challenge gains Browser execution authority.

Reference: Sakana AI / MIT, *Digital Red Queen: Adversarial Program Evolution in Core War with LLMs*, 2026.

### Statistical Gödel Machine — cumulative risk needs a budget

SGM argues that repeated recursive edits accumulate statistical false-positive risk and proposes global error-budget accounting.

METAENGINE does not yet implement SGM's statistical admission algorithm in V1.10. This is deliberately deferred to V1.11 because a correct implementation must bind confidence accounting to exact independent evaluation receipts rather than add a superficial p-value check.

Planned V1.11:

- global recursive-improvement risk budget;
- confirmation-triggered spending;
- exact generation/evidence binding;
- no repeated testing of the same candidate until significance appears;
- risk evidence is an additional gate, never a replacement for hard invariants.

Reference: Wu et al., *SGM: A Statistical Gödel Machine for Risk-Controlled Recursive Self-Modification*, arXiv:2510.10232.

## New source contract

Primary implementation:

`apps/metaengine-browser/src/rsi-open-ended-search-policy.mjs`

### Parent portfolio

Every search generation may select up to four distinct roles:

- `PARETO_EXPLOIT`
- `STEPPING_STONE`
- `NICHE_COVERAGE`
- `ANCESTOR_REVIVAL`

Selection is deterministic from exact archive digest + generation + challenge evidence.

There is still no scalar winner and parent selection is explicitly not promotion.

### Experience memory

`metaengine.rsi.experience-lesson.v1`

The memory admits only typed failure classes, mechanism tags, challenge families, recommendation codes and bounded evidence refs. Free-form candidate memory is forbidden at this boundary.

### Curriculum

`metaengine.rsi.curriculum-challenge.v1`

Every challenge is exact-bound to:

- challenge id/family;
- difficulty;
- source class;
- suite digest;
- hidden manifest digest;
- attempted/solved counts;
- externally verified origin.

The task manifest and solution remain hidden from candidate code.

### Novelty prefilter

`metaengine.rsi.proposal-novelty.v1`

- exact structural duplicate -> reject before expensive evaluation;
- high structural/mechanism overlap -> require external novelty review;
- otherwise -> admit to cheap evaluation;
- LLM novelty judgment is never authority.

### Proposal-model routing

`metaengine.rsi.model-routing.v1`

A deterministic UCB1-style routing policy may allocate proposal attempts among externally measured model arms. An untried arm receives one exploration opportunity before mature arms monopolize the budget.

This affects only proposal sampling; evaluator and promotion roots remain unchanged.

## New trust-root rule

`rsi-open-ended-search-policy.mjs` is added to:

- isolated candidate immutable exact paths;
- tournament trust-root paths;
- promotion trust-root paths.

A candidate therefore cannot improve its apparent performance by rewriting how its own parent, curriculum, novelty or search budget is selected.

## Anti-gaming lessons from current benchmark research

OpenAI's 2026 audits of SWE-bench Verified and SWE-bench Pro show that public coding benchmarks increasingly suffer from contamination and task/test defects.

METAENGINE already required separate holdout digests. V1.10 strengthens the intended operating model:

- private/hidden challenge manifests;
- production-derived incidents;
- transfer challenges;
- adversarial-history challenges;
- no candidate selection of holdouts;
- no single public benchmark as promotion authority.

The next evaluator generation should also record benchmark freshness, provenance and contamination-risk class.

## Hard non-goals

V1.10 does not:

- execute a Browser command;
- create a DevOS lease;
- install a candidate;
- deploy Edge Functions or DDL;
- authorize self-update;
- grant candidate signing authority;
- make an LLM novelty judge authoritative;
- use one scalar fitness as promotion truth;
- allow optional stopping;
- expose holdout manifests or solutions;
- let candidate-authored memory become trusted history.

## Next implementation slices

1. Exact-head CI for current-release convergence + V1.10.
2. V1.11 statistical recursive-risk budget inspired by SGM.
3. V1.12 adversarial challenge producer using external evaluator failures and production incidents.
4. V1.13 experience attribution: distinguish which mutation/mechanism actually contributed to a measured gain rather than assigning credit to the whole candidate.
5. Physical BrowserCell tournament only after live Browser mesh and Fleet admission are restored.
