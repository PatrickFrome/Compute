# C0.3 Checkpoint — Legacy R Release-Line Convergence

Captured: 2026-09-29
Canonical Client V1 candidate: R109 @ ff95e9c886fac35b9302ec5c04a4c6bf7b8e8551

## Before / after

- Open PRs: 359 → 331
- Draft PRs: 342 → 319
- Legacy R83–R109 open PRs: 14 → 2

Remaining:
- #1071 R109 — ACTIVE_CANONICAL
- #982 R83 Edge source import — REFERENCE_ONLY / Compute infrastructure; unique historical Cloudflare source tree, not a Client V1 release dependency

28 PRs were closed this cycle only with one of:
- exact ancestry containment;
- explicit semantic/consumer supersession;
- explicit obsolete transient-CI/prototype classification.

No bulk merge, force push, branch deletion, production release mutation or R109 source mutation occurred.

## Research after step

GitHub Rulesets can enforce:
- restricted branch creation/update/deletion;
- required status checks;
- linear history;
- successful deployment before merge.

GitHub merge queues validate queued changes against the latest target-branch state.

Client V1 use:
- do not activate these controls during current recovery/convergence;
- after C7 Stable Baseline, protect the new product trunk and encode WIP/release policy so branch entropy cannot recur.

References:
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue

Status: C0 RELEASE-LINE CONVERGENCE EVIDENCE_READY.
Next C0 substep: find non-R client-authority PRs that still compete with R109.
