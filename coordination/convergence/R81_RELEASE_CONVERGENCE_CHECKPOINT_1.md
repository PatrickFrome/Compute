# R81 Release Convergence Checkpoint 1

Date: 2026-09-26
Branch: `work/r81-browser-release-convergence-v1`
Base authority: `release/self-update-ambiguity-live-v2` @ `cf747798a285f113ac3ae1563da4be8bd4e56705`

## Scope

This checkpoint starts R81 from the exact current Browser release ancestry. It deliberately does not merge `main`, `sandbox/me2-os`, `me2/r78-desktop-from-scratch`, PR #967, or PR #965 wholesale.

## Fresh evidence before mutation

- Browser release authority remained `cf747798a285f113ac3ae1563da4be8bd4e56705`.
- No pre-existing R81 branch was present.
- The branch-lineage auditor defaulted to `^(work|integration|release)/`, excluding current namespaces such as `me2/`, `repair/`, `fix/`, `sandbox/`, `scratch/`, and `perf/`.
- An unrelated history caused the old auditor to fail when `git merge-base` returned no merge base.

## Research basis

Git documents `git merge-base` as a best-common-ancestor query; a pair of histories is not guaranteed to have a common ancestor. Git also documents `git for-each-ref` as the generic ref iterator and `git rev-list --left-right` as a symmetric-difference classifier. R81 therefore treats absence of a merge base as evidence (`UNRELATED_HISTORY`) instead of an exceptional condition.

References:
- https://git-scm.com/docs/git-merge-base
- https://git-scm.com/docs/git-for-each-ref
- https://git-scm.com/docs/rev-list-options

## Implemented in checkpoint 1

1. Default audit coverage is now all branches in the selected namespace; `--include` remains an explicit narrowing option.
2. No-common-ancestor histories are classified `UNRELATED_HISTORY` and retain `merge_base_sha=null` plus `history_related=false`.
3. Unrelated branches are inventoried from their head tree instead of aborting the audit.
4. Added a Node regression test under the Browser test glob covering root, `me2/`, `repair/`, `fix/`, `scratch/`, `perf/`, and an independent `sandbox/` history.

## Safety / authority

Read-only audit semantics are preserved. The auditor does not mutate refs or worktrees, invoke schedulers, merge branches, actuate Browser, deploy Edge functions, or promote releases.

## Next R81/R82 gates

- Run exact-head Browser regression and branch-auditor test.
- Execute full remote branch audit and persist counts/classifications.
- Re-read live Supervisor state and repair `ROLLOVER_AMBIGUOUS / supervisor_composer_not_unique` without blind retry.
- Reproduce and close residual `native_supervisor_idle_maintenance_wait_timeout`.
- Prove positive conversation seed/readback and monotonically progressing useful supervisor cycles before moving to R83 Edge convergence.
