# C0.1 Checkpoint — Proven Superseded PR Closure

Captured: 2026-09-29
Target release candidate: ff95e9c886fac35b9302ec5c04a4c6bf7b8e8551

## Closed only with exact ancestry proof

- PR #1070 R108 — R109 +8 / -0
- PR #1065 R104.2 — R109 +46 / -0
- PR #1057 R103.1 — R109 +54 / -0
- PR #1048 R102 — R109 +64 / -0
- PR #1043 R101 — R109 +93 / -0

Each PR received an explicit superseded comment before closure.

## Intentionally not closed

The following inspected PRs are graph-diverged from R109 and therefore require consumer/patch-equivalence review rather than ancestry-only closure:

- #1069 R107
- #1068 R106
- #1066 R105 remove Browser page
- #1061 R104
- #1041 R98.4

No bulk merge, force update, branch deletion or release candidate mutation was performed.

## Research basis

Git documents:
- merge-base --is-ancestor as the direct ancestry test;
- patch-id --stable as a mechanism for identifying likely duplicate/equivalent patches independent of commit identity.

References:
- https://git-scm.com/docs/git-merge-base
- https://git-scm.com/docs/git-patch-id

## Result

Repository entropy was reduced without discarding any change not proven absorbed.
Next cleanup step for diverged lines must use semantic/consumer evidence, not branch names.
