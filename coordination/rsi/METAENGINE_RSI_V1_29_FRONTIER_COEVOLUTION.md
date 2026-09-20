# METAENGINE RSI V1.29 — Verified Frontier Co-Evolution Curriculum

Status: SOURCE IMPLEMENTED / STACKED ON V1.28 BENCHMARK PROVENANCE / CI PENDING / NO LIVE AUTHORITY

Exact predecessor:

`work/metaengine-rsi-benchmark-provenance-v1 @ 0558334a3eb4d4dae480c759331083ce88f62513`

Implementation branch:

`work/metaengine-rsi-frontier-coevolution-v1`

## Purpose

Earlier RSI layers can select, validate and protect curricula, but the strongest remaining autonomy bottleneck is task supply.

V1.29 adds a bounded self-play curriculum loop:

`propose -> externally materialize -> externally verify learnability -> admit as synthetic curriculum -> maintain diverse verified buffer`

The proposer may share the executor's model family, but proposal generation is never trusted evidence by itself.

## Research mechanisms adopted

### Absolute Zero Reasoner

Absolute Zero trains one model in proposer and solver roles. Proposed code-reasoning tasks are grounded by an external code executor, and the proposer receives a learnability reward that is zero when the solver always fails or always succeeds and otherwise increases as the task becomes harder.

METAENGINE adopts:

- proposer/solver self-play;
- deduction / abduction / induction task modes;
- environment-grounded task materialization;
- an AZR-style learnability signal;
- a continually reusable verified task buffer.

METAENGINE does not adopt the paper's raw executor trust assumption. Materialization must be external, sandboxed, deterministic and hidden from proposer/executor.

Reference: Zhao et al., *Absolute Zero: Reinforced Self-play Reasoning with Zero Data*, arXiv:2505.03335.

### Agent0

Agent0 co-evolves a curriculum agent and an executor agent, with tool integration allowing increasingly complex multi-step tasks.

METAENGINE adopts:

- explicit curriculum-agent / executor roles;
- shared-model-family operation is allowed;
- tool-aware task proposals;
- frontier difficulty pressure.

The proposer cannot verify or admit its own task. Tool classes in the proposal are descriptive only and never grant execution authority.

Reference: Xia et al., *Agent0: Unleashing Self-Evolving Agents from Zero Data via Tool-Integrated Reasoning*, arXiv:2511.16043.

### POET-style open-ended curriculum pressure

The existing V1.10/V1.12 curriculum already uses minimal-criterion and transfer ideas inspired by POET. V1.29 makes that curriculum supply recursive: newly generated tasks must remain inside a learnable frontier rather than collapsing to trivial or impossible regions.

## Untrusted proposal contract

Schema:

`metaengine.rsi.frontier-task-proposal.v1`

Modes:

- `DEDUCTION`
- `ABDUCTION`
- `INDUCTION`

Tool capability classes:

- `READ_ONLY`
- `PROPOSAL_ONLY`

A proposal may be executor-authored. That is intentional self-play.

But every proposal states:

- proposal is untrusted until external materialization;
- proposer is not verifier;
- proposer is not promotion authority;
- candidate cannot self-admit task;
- raw task content is not part of the trust root;
- direct tool execution authority is false.

## External materialization

Schema:

`metaengine.rsi.frontier-task-materialization.v1`

The external materializer must bind four distinct digests:

- suite digest;
- hidden manifest digest;
- oracle digest;
- semantic contract digest.

It must additionally prove:

- deterministic replay count;
- deterministic outputs match;
- forbidden-capability scan pass;
- network default deny;
- host repository not mounted;
- hidden manifest/oracle invisible to proposer;
- hidden manifest/oracle invisible to executor;
- candidate cannot mutate verifier;
- candidate cannot select oracle.

The task is explicitly not benchmark promotion evidence.

## External learnability measurement

Schema:

`metaengine.rsi.frontier-learnability.v1`

Minimum evaluation attempts: 8.

V1.29 records both:

- AZR-style proposer learnability:
  `0` at solve-rate 0 or 1, otherwise `1 - solve_rate`;
- symmetric frontier-balance:
  `4p(1-p)`.

Admission uses a precommitted minimal criterion:

- solve rate >= 0.125;
- solve rate <= 0.875;
- external novelty >= 0.20.

The candidate cannot change these thresholds.

The evaluator is neither proposer nor executor, and no V1.11 statistical alpha is spent during curriculum screening.

## Curriculum handoff

A task that passes becomes:

`ADMITTED_SYNTHETIC_FRONTIER_CURRICULUM`

and is translated into the existing:

`metaengine.rsi.curriculum-challenge.v1`

with source class:

`SYNTHETIC_CURRICULUM`.

Even an admitted frontier task has:

- eligible_for_curriculum=true;
- eligible_as_promotion_benchmark=false;
- eligible_for_trusted_memory_ingest=false;
- eligible_for_skill_library_ingest=false;
- benchmark provenance admission still required before any promotion-evidence use.

This prevents self-play from becoming self-certification.

## Diversity guard

Open-ended self-play can collapse into one repetitive task family.

V1.29 therefore adds:

`metaengine.rsi.frontier-task-buffer.v1`

For buffers with at least four tasks, proposer conditioning requires:

- at least two reasoning modes;
- at least two task families;
- no single mode above 75%.

The buffer exposes only identities/digests/metadata, not hidden manifests, oracles or raw task content.

A collapsed buffer remains durable evidence but:

`eligible_for_proposer_conditioning=false`.

## Relationship to benchmark contamination guard

V1.28 and V1.29 deliberately separate two kinds of evidence.

V1.29 self-play tasks are useful **training/search curriculum**.

V1.28 contamination-resistant tasks are needed for **independent evaluation/promotion evidence**.

A self-generated task is never promoted into the latter category merely because the same system can solve it.

## Trust-root changes

`apps/metaengine-browser/src/rsi-frontier-coevolution.mjs`

is added to:

- isolated candidate immutable paths;
- tournament trust root;
- promotion trust root.

A candidate cannot relax its own learnability window, verifier separation, hidden-oracle boundary or buffer diversity requirement.

## Non-goals

V1.29 does not:

- train model weights;
- execute Browser actions;
- create DevOS tasks or leases;
- expose arbitrary code execution;
- let proposer or executor verify itself;
- make self-generated tasks promotion evidence;
- mutate production;
- deploy Edge/DDL;
- authorize install/self-update/promotion.

## Next high-value research

Two mechanisms now become especially valuable:

1. **capability-frontier anti-forgetting replay** — continually sample previously mastered, contamination-resistant tasks so open-ended curriculum expansion cannot silently erase old capabilities;
2. **teacher/executor progress attribution** — measure which generated task families cause later transfer gains rather than rewarding task difficulty alone.

The first should be implemented before increasing self-play autonomy further.
