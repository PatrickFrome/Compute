# RSI R8C — Stable-Source One-Attempt Exposure Effect Research

Date: 2026-09-19
Scope: post-implementation research for the Phase36 DORMANT_CAP -> EXPLORATION_ACTIVE effect boundary.
Authority: advisory/source-only; no production, Browser, scheduler, promotion or self-update authority.

## Decision

The implementation should not add another search engine, trainer, scheduler, or effect plane. The highest-value improvement is to make the existing verified-search machinery cumulative while keeping every learned artifact behind external evaluation, exact lineage, durable attempt fencing, and staged exposure.

The R8C effect therefore remains deliberately narrow:

1. a fully verified Phase36 certificate must already exist in the durable zero-effect certificate ledger;
2. the effect attempt is persisted before any retrieval-exposure mutation;
3. after durable ATTEMPTED, exact predecessor roots are re-read immediately before effect;
4. an ambiguous ATTEMPTED state is reconciliation-only and never replayed;
5. the only state change is one held skill DORMANT_CAP -> EXPLORATION_ACTIVE;
6. full ACTIVE promotion is a later independently certified phase;
7. attempt evidence is bounded to 64 KiB.

## External research mapped to METAENGINE

### Darwin Gödel Machine — adopt archive diversity, reject self-authorized adoption
Source: https://arxiv.org/abs/2505.22954

DGM preserves diverse stepping stones in an archive and empirically validates self-modifications. METAENGINE should preserve the archive/diversity principle, but not let the candidate own the evaluator or adoption effect. The current separation of proposer, certificate/review owners, durable effect executor and readback owner remains stronger for our environment.

### AlphaEvolve — adopt proposer/evaluator separation
Source: https://deepmind.google/blog/alphaevolve-a-gemini-powered-coding-agent-for-designing-advanced-algorithms/

AlphaEvolve couples broad LLM proposal generation with automated evaluators and an evolutionary program database. This supports keeping our search plane broad while concentrating authority in external deterministic evaluators. It does not justify granting the search plane Browser or promotion authority.

### GEPA — adopt rich trajectory feedback and Pareto retention
Source: https://arxiv.org/abs/2507.19457

GEPA uses trajectory-level textual feedback and a Pareto frontier rather than collapsing learning to one scalar. METAENGINE already has the right substrate: credited Browser outcomes, Experience Graph, quality-diverse frontier and external evaluation. The next optimization should improve diagnosis/proposal quality and frontier selection, not weaken admission.

### Agent Lightning and TRACE — adopt externalized credit assignment
Sources:
- https://www.microsoft.com/en-us/research/blog/agent-lightning-adding-reinforcement-learning-to-ai-agents-without-code-rewrites/
- https://www.microsoft.com/en-us/research/publication/trace-turn-level-reward-assignment-via-credit-estimation-for-long-horizon-agents/

Both reinforce the architecture in which environment execution is decoupled from learning and credit is assigned at step/transition granularity. METAENGINE should keep Browser execution immutable from the learner's perspective and improve credit quality through external trajectory analysis.

### Experience Graphs / Trellis and EXG — adopt durable experience as database state
Sources:
- https://arxiv.org/abs/2606.29823
- https://arxiv.org/abs/2605.17721

Experience should be a durable, queryable graph with causal lineage, sibling comparisons and replayable provenance, not disposable session text. This strongly supports METAENGINE's existing Experience Graph and append-only ledgers. The practical next step is better graph materialization/retrieval and counterfactual evaluation, not another memory store.

### H-EPM — adopt hybrid episodic/procedural retrieval, preserve contextual validation
Source: https://www.microsoft.com/en-us/research/publication/experience-evolving-multi-turn-tool-use-agent-with-hybrid-episodica%C2%A2a%C2%ACaeoeprocedural-memory/

H-EPM's tool graph plus compact episodic context supports partial reuse of successful tool-use histories. METAENGINE should keep procedural skill families separate from contextual episodes and require consumer-local validation before a procedural prior becomes active.

### MemEvolve / EvolveMem — experiment with memory-policy evolution only behind evaluator roots
Sources:
- https://arxiv.org/abs/2512.18746
- https://arxiv.org/abs/2605.13941

Both show value in evolving the memory/retrieval architecture itself. For METAENGINE this belongs after R10 continuous health, because changing retrieval policy can silently change the effective decision distribution. Any memory-policy evolution should be isolated, counterfactually evaluated, and rollbackable.

### SkillGLoW and SkillOpt — adopt procedural-family consolidation and commit gates
Sources:
- https://arxiv.org/abs/2609.02217
- https://www.microsoft.com/en-us/research/blog/skillopt-agent-skills-as-trainable-parameters/

SkillGLoW argues that reusable skill units should be procedural families rather than instance-bound memories, and admits them through a real-execution non-degradation gate. SkillOpt similarly treats skill edits as bounded, validated parameters. This directly supports METAENGINE's DORMANT_CAP -> EXPLORATION_ACTIVE -> later ACTIVE lifecycle and suggests a Phase37 requirement: promotion must be based on real bounded execution across a procedural family, not one task.

## ADOPT NOW

- Durable zero-effect certificate record before effect preparation.
- Durable ATTEMPTED before effect.
- Exact post-ATTEMPT predecessor readback.
- Readback-only ambiguity; no effect replay.
- EXPLORATION_ACTIVE-only release.
- 64-KiB bounded attempt evidence.
- Pareto/quality-diverse archive retention.
- Durable Experience Graph as the cross-session memory substrate.
- External step-level credit assignment.
- Procedural-family grouping for future skill consolidation.

## EXPERIMENT AFTER R8C QUALIFICATION

- Counterfactual retrieval ablations over Experience Graph neighborhoods.
- Procedural-family clustering for skills with identical typed IO/effect signatures.
- Shadow-only memory-policy variants inspired by MemEvolve/EvolveMem.
- GEPA-style reflective proposal generation fed by verified trajectory deltas.

## DEFER

- Model-weight online RL.
- Autonomous memory-architecture mutation in the live Browser.
- Open-ended self-rewrite of evaluator roots.
- Full ACTIVE promotion before an independent Phase37 certificate.

## REJECT

- Candidate-owned evaluator or release executor.
- Scalar reward as the sole admission signal.
- Blind retry after an ambiguous mutation.
- Treating historical memory as transferable truth without current consumer validation.
- A second scheduler, effect journal, skill library, evaluator or CAS plane.

## Next gate

Do not progress to ACTIVE promotion until:
- exact-head R8C CI is terminal green;
- predecessor R5F/R7/R8 evidence is qualified;
- live GitHub/DB/runtime source identity is genuinely converged;
- a new independent Phase37 protocol proves sustained non-regression under bounded real execution.
