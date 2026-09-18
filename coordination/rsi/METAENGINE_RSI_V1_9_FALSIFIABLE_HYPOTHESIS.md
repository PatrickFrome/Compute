# METAENGINE RSI V1.9 — Falsifiable Hypothesis Boundary

Status: IMPLEMENTED / CI PENDING / NO LIVE AUTHORITY

Green predecessor: `a3559b81f3b97d49cd31a668b0e6ef31a7963877` on `work/metaengine-rsi-v1-l1-command-stall`.

This generation turns a zero-authority RSI opportunity into a precommitted, falsifiable experiment contract before any candidate code is generated.

## Why this boundary exists

A recursive improver must not be allowed to define success after seeing its own candidate result. Free-form prompts such as “improve reliability” create benchmark-gaming and hindsight-selection pressure. V1.9 therefore commits the claim, hard gates, required external receipts, falsification cases, objective directions, paired comparison, holdout requirement, minimum repetitions, no-optional-stopping rule, and no-scalar-reward rule before the existing DevOS scheduler receives an experiment.

The production-derived L1 incident from 2026-09-17 is the first concrete learning episode. It produced two P0 signals in V1.8:

- `RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING`
- `COMMAND_PLANE_STALL_WITH_HEALTHY_HEARTBEAT`

V1.9 converts those signals into hypotheses that can be disproved.

## Contract

The immutable runtime root is `apps/metaengine-browser/src/supervisor-rsi-experiment-hypothesis.mjs`.

For each registered signal it fixes:

- a causal claim;
- a bounded mutation surface;
- non-authoritative suspected-component hints;
- hard gates that cannot be traded against performance gains;
- required external receipt classes;
- explicit falsification cases;
- objective metric names and directions;
- paired parent/candidate evaluation;
- holdout evaluation;
- minimum five paired repetitions;
- no optional stopping;
- no authoritative scalar reward;
- no candidate-authored receipts.

Every hypothesis is digest-bound to:

`exact source SHA + observation digest + opportunity ID + signal + mutation surface + acceptance contract`.

The existing DevOS bridge accepts a hypothesis only when its digest and all causal bindings still match the observation. The hypothesis digest becomes part of the experiment identity, target branch identity, task constraints and task payload.

## Trust boundary

The hypothesis root intentionally lives under the existing `apps/metaengine-browser/src/supervisor-*` immutable namespace. The Candidate Builder already rejects that namespace, and the Promotion Gate already treats it as a trust-root prefix. A candidate therefore cannot improve its apparent result by first editing the rules that define success.

This generation does not create a task lease, assign an agent, bind a workspace, run a candidate, issue a Browser command, install a build, deploy production DDL, invoke self-update, grant promotion authority, or replay an ambiguous physical effect.

## L1 result-delivery hypothesis

Hard gates include:

- zero duplicate irreversible effects;
- at most one physical effect execution;
- bounded wall-clock result delivery;
- durable receipt reconciliation;
- zero follow-up mutation while outcome is ambiguous;
- command-cycle progress recovery.

Required evidence includes fault-injected result-transport timeout, one-attempt effect proof, durable receipt readback, command-progress recovery and a healthy negative control.

The intended repair remains deliberately outside this generation. V1.9 specifies what a repair must prove; it does not give RSI permission to implement or install the repair autonomously.

## Research basis

The design follows four useful patterns from current self-improvement/evaluation work:

1. Darwin Gödel Machine: preserve open-ended stepping stones and empirically validate changes rather than relying on an unverifiable global proof of improvement.
2. AlphaEvolve: separate proposal generation from automated evaluators and keep feedback machine-checkable.
3. WebArena-Verified: prefer deterministic, replayable evaluation over judge-model opinion where a structural evaluator is possible.
4. Sakana AI RSI Lab: treat off-distribution drift, benchmark-passing/deployment-failing changes and shortcut exploitation as central RSI engineering failure modes rather than edge cases.

These ideas are adapted to METAENGINE's stricter authority model: candidate code never controls the evaluator root, promotion gate, Self Update authority or one-attempt effect semantics.

## Next boundary

V1.10 should add a hypothesis-specific evidence admission gate between Candidate Handoff and the generic Evaluator Mesh. It must require exact candidate/hypothesis binding, fixed trusted receipt producers, complete coverage of every precommitted hard gate and falsification case, and preserve a `FALSIFIED` outcome as useful archive evidence rather than converting it into a retry.
