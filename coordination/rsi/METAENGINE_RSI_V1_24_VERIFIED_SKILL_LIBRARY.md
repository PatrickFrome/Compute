# METAENGINE RSI V1.24 — Verified Composable Skill Library

Status: SOURCE IMPLEMENTED / STACKED ON V1.23 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-recursive-depth-v1 @ e4915127d9ab09b20705524388e1228e62971a51`

Implementation branch:

`work/metaengine-rsi-skill-library-v1`

## Purpose

The RSI line now has open-ended search, group experience exchange, adaptive retrieval, architecture search, clade guidance, comparative mutation operators, hierarchical evaluation, async islands, proxy calibration and recursive depth.

The next compounding mechanism is reusable **verified procedural knowledge**.

Experience lessons are useful, but they remain advisory. Architecture genomes are expressive, but rebuilding the same analyzer/retriever/verifier subgraph for every candidate wastes samples. V1.24 therefore introduces a lifecycle-managed library of bounded, typed skills that can be composed without granting direct execution authority.

## Research mechanisms adopted

### Voyager — compositional skill library

Voyager's strongest lifelong-learning mechanism is an ever-growing library of executable, temporally extended and compositional skills. Reusing skills lets later tasks build on earlier discoveries instead of solving every problem from scratch.

METAENGINE adopts:

- durable skill identity/versioning;
- compositional reuse;
- exact interface contracts;
- transfer testing before reuse in a new context.

Unlike Voyager, METAENGINE does **not** let a stored skill directly act on the environment. A skill capsule is a typed artifact with zero process/browser/tool authority.

Reference: Wang et al., *Voyager: An Open-Ended Embodied Agent with Large Language Models*, arXiv:2305.16291.

### MUSE-Autoskill — full skill lifecycle

MUSE-Autoskill treats skills as long-lived assets with creation, memory, management, evaluation and refinement instead of isolated static snippets.

METAENGINE adopts:

- external skill evaluation;
- runtime-feedback evidence;
- stable versions;
- per-skill reuse evidence;
- negative transfer as durable memory;
- refinement via a successor version, never in-place replacement.

Reference: Lin et al., *MUSE-Autoskill: Self-Evolving Agents via Skill Creation, Memory, Management, and Evaluation*, arXiv:2605.27366.

### MetaSkill-Evolve — separate task skills from meta-skills

MetaSkill-Evolve recursively evolves both task skills and slower meta-skills controlling Analyzer/Retriever/Allocator/Proposer/Evolver components.

V1.24 prepares this structure with explicit skill roles:

- ANALYZER
- RETRIEVER
- ALLOCATOR
- PROPOSER
- EVOLVER
- VERIFIER
- TRACE_SUMMARIZER
- PLAN_TRANSFORM

V1.25 should evolve a branch-local meta-skill profile over these verified role capsules under a slower external evidence loop.

Reference: Wang et al., *MetaSkill-Evolve: Recursive Self-Improvement of LLM Agents via Two-Timescale Meta-Skill Evolution*, arXiv:2607.05297.

### HASP — programmatic skills need stable intervention boundaries

HASP argues that passive textual advice is weaker than modular program functions that intervene at failure-prone states. It also highlights the need for stable skill-library evolution.

METAENGINE adopts typed procedural artifacts, but deliberately keeps their capability surface narrower:

- no direct tool calls;
- no shell/eval/process/network authority;
- no scheduler/promotion/self-update/signing authority;
- only verified-context transforms, memory selection, proposal shaping and typed checking.

A trusted runtime may later interpret a verified composition plan, but the skill artifact itself is never authority.

Reference: Liu et al., *Harnessing LLM Agents with Skill Programs*, arXiv:2605.17734.

### AlphaEvolve / FunSearch — reuse strong program fragments, preserve evaluator separation

AlphaEvolve and FunSearch both improve search by retaining successful program artifacts and feeding them back into future generation. FunSearch additionally uses population/island structure to preserve diversity.

METAENGINE already has archive/island layers. V1.24 adds the missing reusable subprogram abstraction while preserving the existing immutable evaluator boundary.

References:
- Novikov et al., *AlphaEvolve*, arXiv:2506.13131.
- Romera-Paredes et al., *Mathematical discoveries from program search with large language models*, Nature 625, 2024.

## Skill capsule

Schema:

`metaengine.rsi.skill-capsule.v1`

A skill is exact-bound to:

- skill id + immutable version;
- optional parent skill digest;
- source candidate SHA;
- role;
- input schema digest;
- output schema digest;
- implementation digest;
- typed component digests;
- bounded capability set;
- context/output/invocation budgets.

The capability allowlist is intentionally small:

- READ_VERIFIED_CONTEXT
- SELECT_VERIFIED_MEMORY
- PROPOSE_TYPED_TRANSFORM
- CHECK_TYPED_OUTPUT
- SUMMARIZE_VERIFIED_TRACE
- ALLOCATE_PROPOSAL_BUDGET
- ANALYZE_FAILURE_CODES
- SYNTHESIZE_STRUCTURED_PLAN

Forbidden capability classes include direct tools, shell, eval, process, network authority, filesystem writes, scheduler, promotion, self-update, signing, secrets and model-text authority.

## Skill evidence

Schema:

`metaengine.rsi.skill-evidence.v1`

A reusable skill requires independent external evidence bound to:

- exact skill digest/version;
- hidden holdout digest;
- evaluator-root digest;
- unit-test digest;
- runtime-feedback digest;
- attempts/successes;
- hard-invariant state;
- evidence refs.

Only `verified_for_library=true` plus hard-invariant PASS can enter the reusable library.

The candidate cannot self-certify.

## Verified library

Schema:

`metaengine.rsi.skill-library.v1`

Properties:

- append-only evidence semantics;
- stable skill versions;
- no in-place skill replacement;
- exact version/digest uniqueness;
- only externally verified skills reusable;
- raw model/page/user text and secrets are not stored;
- cross-context portability always requires a separate receipt.

## Skill composition

Schema:

`metaengine.rsi.skill-composition-plan.v1`

Composition is a bounded DAG.

Every edge requires:

`source.output_schema_digest == target.input_schema_digest`

The plan additionally binds:

- verified library digest;
- exact nodes and versions;
- topological order;
- entry/exit schemas;
- maximum depth;
- context/output budgets;
- per-node invocation budgets.

Unverified skills cannot be injected.

Cycles fail closed.

The composition plan itself has no execution authority.

## Usage memory

Schema:

`metaengine.rsi.skill-usage-receipt.v1`

External target-context evaluation records:

- HELPFUL
- NEUTRAL
- HARMFUL
- INSUFFICIENT_EVIDENCE

A HELPFUL result is impossible unless hard invariants passed.

Usage receipts are skill-memory evidence only and never promotion authority.

## Cross-context portability

Schema:

`metaengine.rsi.skill-portability-receipt.v1`

A skill proven in one model/environment cannot silently become trusted in another.

The target-context evaluator binds:

- target model family;
- target environment family;
- target context digest;
- target hidden holdout;
- evaluator root;
- measured delta;
- hard invariants;
- evidence refs.

Possible outcomes:

- PORTABLE_VERIFIED
- NEGATIVE_TRANSFER
- INSUFFICIENT_EVIDENCE

Negative transfer is retained as memory instead of repeatedly rediscovering incompatibility.

## Trust root

`apps/metaengine-browser/src/rsi-verified-skill-library.mjs`

is added to:

- isolated candidate immutable paths;
- tournament trust root;
- promotion trust root.

Candidates therefore cannot redefine what counts as a verified skill or widen the capability allowlist.

## Non-goals

V1.24 does not:

- execute a skill;
- introduce shell/eval/process authority;
- create a second scheduler;
- install or self-update Browser;
- grant skill artifacts promotion authority;
- trust skill portability without target-context evidence;
- store raw user/page/model transcripts as trusted skill memory;
- mutate production.

## Next slice — V1.25 Two-Timescale Meta-Skill Evolution

The high-value next step is to combine V1.24 with MetaSkill-Evolve:

Fast loop:
- refine task skills from external usage/ablation evidence.

Slow loop:
- evolve the branch-local composition of Analyzer/Retriever/Allocator/Proposer/Evolver skills.

Required safeguards:
- meta-skill can choose only VERIFIED skill versions;
- its own mutation requires external evaluation on a distinct hidden holdout;
- meta-skill changes cannot modify evaluator/promotion/scheduler/signing roots;
- fast-loop evidence and slow-loop evidence remain separately digest-bound;
- promotion still requires the existing tournament/risk pipeline.
