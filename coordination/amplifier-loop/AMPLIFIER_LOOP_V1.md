# METAENGINE AMPLIFIER LOOP V1

Status: cross-cutting engineering execution policy. This policy is additive to the sealed Compute Fabric roadmap; it does not change milestone authority, bypass gates, or admit production capabilities by itself.

## Goal

Make GPT, GLM, and the Compute engine improve continuously during development by running a closed loop:

`research -> candidate -> bounded implementation -> real use -> measurement -> accept/rollback -> learned strategy`

The loop favors free/open-source or already-included resources and converts measured development experience into reusable strategy data.

## Mandatory agent behavior

At every meaningful checkpoint, newly observed bottleneck, repeated failure, or material performance/reliability regression, each active agent SHOULD perform a bounded deep-research pass for relevant amplifiers. A micro-edit does not trigger research by itself.

During blind A2 PROPOSE phases, GPT and GLM research and propose independently and MUST NOT use hidden peer material. After reveal, their candidates and evidence may be reconciled.

For each research pass:

1. Prefer primary sources: official documentation, upstream repositories, specifications, releases, and benchmarks.
2. Find at least two plausible candidates when the ecosystem has meaningful alternatives.
3. Record version/date, source, license, zero-cost status, expected benefit, integration scope, rollback path, and risks.
4. Reject candidates that require unapproved paid resources, weaken security/isolation/provenance, bypass milestone gates, introduce synthetic evidence, or require destructive/unbounded actions.
5. A free tier with quota is not treated as unlimited/free authority. Crossing a quota or creating a chargeable resource remains `PAID_RESOURCE_OR_BUDGET_REQUIRED`.

## Immediate implementation rule

The best eligible candidate SHOULD be implemented immediately when all of the following are true:

- the change is bounded and reversible;
- it stays inside the current claim/directive/mutation domain;
- it does not cross a hard gate;
- it uses zero-cost local, CI-included, self-hosted, or already-authorized capacity;
- a baseline and a falsifiable success metric can be collected;
- a kill switch / rollback exists.

Before dependent production milestones are satisfied, implementation is PREP/SHADOW/CANARY only. Research and laboratory evidence may accumulate before C1/C5, but it must not be mislabeled as production acceptance.

## Real-use tournament

A candidate is not accepted because it installed successfully. It must be used on a real project task or representative real CI workload.

Minimum evidence where practical:

- baseline command/workload identity;
- candidate command/workload identity;
- correctness/result equivalence;
- median wall-clock duration;
- CPU time or utilization when available;
- peak memory when available;
- cache hit/miss or reuse metrics when applicable;
- test flake/error rate when applicable;
- external monetary cost for the tested path (must remain zero unless a separate budget gate authorizes otherwise);
- at least three repetitions for short/medium benchmarks, or two bounded repetitions for expensive workflows with variance noted.

Default performance acceptance: `candidate_median <= 0.95 * baseline_median` with correctness/security unchanged. A smaller speedup may still be accepted for a material reliability, observability, portability, or capability gain, but the tradeoff must be explicit. Any correctness, security, authority, isolation, or provenance regression is an automatic rollback.

## Learning record

Every amplifier experiment SHOULD persist a compact evidence record with:

- `amplifier_id`
- `candidate_version`
- `task_class`
- `context_fingerprint` (toolchain/runtime/worker class/repo state dimensions that affect validity)
- `baseline_metrics`
- `candidate_metrics`
- `correctness_pass`
- `security_pass`
- `zero_cost_pass`
- `speedup_ratio`
- `reliability_delta`
- `sample_count`
- `verdict` = `ACCEPT`, `KEEP_SHADOW`, or `ROLLBACK`
- source/evidence references
- rollback instructions

Persist the material result to the normal project evidence/A2 checkpoint path. Do not persist browser chat text as authority.

## Compute-engine self-improvement

"Learning" in this phase means evidence-driven strategy improvement, not ungoverned model-weight training.

The engine may autonomously improve by:

1. accumulating the experiment records above;
2. ranking previously accepted amplifiers by task/context;
3. reusing the best proven strategy for matching contexts;
4. exploring at most one unproven amplifier at a time in bounded shadow/canary scope;
5. demoting or rolling back strategies whose measured benefit decays or whose correctness/reliability regresses;
6. updating non-authority configuration, heuristics, benchmark baselines, cache policies, scheduling hints, and candidate rankings through normal reviewed repository changes.

Before `C5_TRUSTED_TELEMETRY`, learning inputs are explicitly CI/lab evidence. After C5, trusted telemetry may feed the learner. `C6_DURATION_SCHEDULER_TOURNAMENT` is the roadmap milestone that upgrades duration/scheduling learning into a verified scheduler capability.

The engine MUST NOT autonomously retrain or replace foundation-model weights, change sealed roadmap definitions, grant itself claims/directives, or turn research evidence into milestone acceptance.

## Seed amplifier families

The seed registry lives in `seed-amplifiers.json`. It is discovery input, not pre-approval. Every use still requires current-source verification and a bounded measured experiment.

## Safety fences

Always preserve:

- current roadmap hard gates;
- claim/directive fencing;
- provider and budget protections;
- reproducibility and cache identity;
- hermetic/toolchain identity requirements;
- non-authority browser transport;
- negative canaries and rollback;
- explicit distinction between PREP/SHADOW evidence and VERIFIED production evidence.
