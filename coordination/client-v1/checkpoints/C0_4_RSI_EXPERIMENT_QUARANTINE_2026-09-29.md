# C0.4 Checkpoint — RSI / Experiment Quarantine

Captured: 2026-09-29

Live PR census found **222 open RSI-related PRs**, **221 draft**.

These are not deleted. They are classified as **EXPERIMENT_LAB** and removed from the Client V1 release critical path until after C7 stable baseline and the C12–C14 learning/scale stages.

## Release rule

Before C7, RSI work may do isolated research, synthetic evaluation and reference documentation, but it cannot:
- become Client V1 release authority;
- create a second scheduler/effect/updater/state authority;
- block the Client V1 release;
- silently widen production behavior.

Any future promotion from RSI/Lab must name a concrete Client V1 consumer, replace or extend one bounded mechanism, add a positive physical capability test, and pass exact-head qualification.

## Research after step

Continuous-integration guidance strongly favors frequent integration and short-lived branches; long-lived feature branches defer integration risk. Branch-by-abstraction/feature flags are preferable when a large change must evolve without splitting the product into long-lived competing truths.

For METAENGINE this means: keep RSI as experiments until there is one bounded consumer, then selective-port a small slice rather than merging an experimental lineage.

References:
- https://martinfowler.com/articles/continuousIntegration.html
- https://martinfowler.com/articles/branching-patterns.html
- https://martinfowler.com/bliki/BranchByAbstraction.html

Status: EXPERIMENT QUARANTINE RECORDED.
No RSI PR was bulk-closed or merged.
