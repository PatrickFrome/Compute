# METAENGINE RSI V1.19 — Trace-Guided Harness Repair

Status: SOURCE IMPLEMENTED / STACKED ON V1.18 / CI PENDING / NO LIVE AUTHORITY

Predecessor:

`work/metaengine-rsi-comparative-lineage-v1 @ 20da11bbb9e652d06163e210468bea98431fc026`

Implementation branch:

`work/metaengine-rsi-trace-guided-harness-repair-v1`

## Purpose

V1.18 improves mutation proposals through comparative lineage evidence.

V1.19 improves **where a harness repair is aimed**.

A recurring self-improvement failure mode is broad patching from final-task failure alone:

`task failed -> edit a large amount of harness code -> rerun benchmark`

This is expensive and confounds diagnosis, mutation and evaluation.

V1.19 inserts a typed diagnostic boundary:

`raw trace -> external trace IR -> exact responsible harness component/layer -> bounded repair specification -> matched-budget + heldout verification`

## Research basis

### HarnessFix

HarnessFix compiles raw execution traces and harness code into a Harness-aware Trace Intermediate Representation (HTIR), preserving step-level provenance and control-flow relations. It attributes failures to responsible trace steps and harness layers, consolidates recurring diagnoses into flaw records, then maps those flaws to scoped repair operators.

METAENGINE adopts:

- typed harness-aware trace IR;
- step-level provenance;
- control-flow DAG;
- exact component/layer localization;
- scoped repair operators;
- recurring flaw evidence;
- external validation after repair.

Reference: Chen et al., *From Failed Trajectories to Reliable LLM Agents: Diagnosing and Repairing Harness Flaws*, arXiv:2606.06324.

### Agentic Harness Engineering (AHE)

AHE identifies three observability pillars:

1. component observability;
2. experience observability;
3. decision observability.

METAENGINE adopts all three:

- every editable harness component has an explicit file-level registry entry;
- raw traces are distilled into typed trace IR;
- every repair carries a falsifiable prediction that later external evaluation must verify.

Reference: Lin et al., *Agentic Harness Engineering: Observability-Driven Automatic Evolution of Coding-Agent Harnesses*, arXiv:2604.25850.

### Test-Time Harness Evolution (TTHE)

TTHE shows that a harness can adapt from execution-derived proxy signals during evaluation, but identifies proxy reliability as a central challenge.

METAENGINE adopts the idea that execution traces can generate adaptation hypotheses, but **does not auto-commit** a harness from a proxy signal.

`test_time_auto_commit=false`

Reference: Nie et al., *TTHE: Test-Time Harness Evolution*, arXiv:2607.08124.

### Evaluation critique of harness evolution

Recent 2026 evaluation work reports that automatic harness evolution may not consistently beat simpler test-time scaling under matched budgets and may overfit the benchmark used during search.

METAENGINE therefore adds two mandatory repair-evaluation controls:

- matched feedback/inference budget baseline;
- heldout generalization suite.

A repair cannot pass merely because it improved the same searched tasks.

Reference: Wang et al., *Rethinking the Evaluation of Harness Evolution for Agents*, arXiv:2607.12227.

## Harness component registry

Schema:

`metaengine.rsi.harness-component-registry.v1`

Layers:

- EXECUTION
- TOOLS
- CONTEXT
- LIFECYCLE
- OBSERVABILITY
- VERIFICATION
- GOVERNANCE

Each component binds:

- component id;
- exact relative source path;
- layer;
- digest;
- editable flag;
- revertible flag;
- authority-root flag.

Authority-root components are never eligible repair targets.

## Harness-aware Trace IR

Schema:

`metaengine.rsi.harness-trace-ir.v1`

Every step binds:

- step id;
- ordinal;
- kind;
- component id/path/layer;
- predecessor step ids;
- event code;
- result code;
- payload digest;
- provenance digest.

The trace is a DAG. Missing predecessors and cycles fail closed.

Trusted IR contains no raw:

- payload;
- page text;
- user input;
- secrets.

Model text is not authority.

## Flaw record

Schema:

`metaengine.rsi.harness-flaw-record.v1`

A flaw record binds:

- one exact component;
- one exact harness layer;
- one structured failure code;
- evidence trace digests;
- responsible step ids;
- one bounded repair operator.

Allowed repair operators:

- SCOPED_GUARD
- BOUNDED_RETRY_POLICY
- CONTEXT_REPAIR
- TOOL_CONTRACT_REPAIR
- LIFECYCLE_FENCE
- OBSERVABILITY_REPAIR
- VERIFICATION_REPAIR
- GOVERNANCE_FENCE

The record is external diagnosis only. It is not patch authority.

## Repair specification

Schema:

`metaengine.rsi.harness-repair-spec.v1`

A repair spec is exact-bound to one editable/revertible non-authority component.

It requires:

- predicted target failure-code reduction;
- predicted objective codes;
- regression guard codes;
- hidden heldout suite digest;
- matched-budget baseline digest.

It explicitly fixes:

- decision observability=true;
- falsifiable prediction required=true;
- exact component scope required=true;
- broad patch forbidden=true;
- heldout generalization required=true;
- matched feedback budget baseline required=true;
- test-time auto-commit=false;
- patch materialization external=true;
- scheduler authority=false.

## Repair outcome

Schema:

`metaengine.rsi.harness-repair-outcome.v1`

A repair is VERIFIED only if all hold:

1. target failure count decreases;
2. matched-budget baseline delta is positive;
3. heldout delta is non-negative;
4. unacceptable regression count is zero.

Otherwise:

`REPAIR_REJECTED`

Even a verified repair remains only:

`REPAIR_VERIFIED_FOR_EXTERNAL_REVIEW`

and has no promotion/install/self-update authority.

## Relationship to earlier RSI layers

V1.13:
component-level post-hoc ablation attribution.

V1.18:
comparative evidence used before mutation proposal.

V1.19:
trace-localized harness diagnosis and scoped repair contract.

These are complementary:

`failure -> localization -> comparative repair proposal -> isolated candidate -> evaluation -> component attribution`

## Why this is stricter than direct HarnessFix/TTHE adaptation

METAENGINE does not permit:

- raw trace text to become trusted candidate context;
- proxy signal to auto-commit a repair;
- repair of authority-root components;
- broad multi-layer edits from one flaw record;
- same-benchmark improvement without heldout check;
- extra compute to masquerade as harness improvement.

## Trust root

`apps/metaengine-browser/src/rsi-trace-guided-harness-repair.mjs`

is added to:

- isolated candidate immutable paths;
- tournament trust root;
- promotion trust root.

## Next slice — V1.20 Hierarchical Evaluation Economy

SIFT and multi-fidelity search research indicate that full benchmark evaluation is now the dominant RSI cost.

The next layer should create an evidence-preserving cascade:

1. structural/static contract rejection;
2. deterministic micro-tests;
3. cheap external judge triage;
4. targeted benchmark shards;
5. full hidden holdout;
6. V1.11 statistical confirmation only for promotion candidates.

Important requirement:

low-fidelity stages may allocate compute, but only high-fidelity external evidence can authorize archive/promotion review.
