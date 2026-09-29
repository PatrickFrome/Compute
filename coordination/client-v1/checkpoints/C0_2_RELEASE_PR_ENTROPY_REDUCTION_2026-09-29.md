# C0.2 Checkpoint — Release-Line PR Entropy Reduction

Captured: 2026-09-29
R109 target: ff95e9c886fac35b9302ec5c04a4c6bf7b8e8551

## Result

Open PR count reduced from 359 to 343.
Draft PR count reduced from 342 to 328.

Exactly 16 PRs were closed only after exact ancestry proved their heads are fully contained in R109 with 0 commits behind:

#1070, #1065, #1057, #1048, #1043,
#1025, #1024, #1022, #1017, #1016,
#1004, #1001, #1000, #998, #997, #994.

Each was commented as superseded before closure.

## Held for semantic review

Graph-diverged examples observed and deliberately not closed:
#1069, #1068, #1066, #1061, #1041, #1033, #1028, #1002, #999.

These require consumer/tree/patch-equivalence evidence.

## Research basis

Git merge-base ancestry is used for direct containment.
Git patch-id --stable is the planned secondary test for likely duplicate patches on diverged histories.

References:
- https://git-scm.com/docs/git-merge-base
- https://git-scm.com/docs/git-patch-id

No branch deletion, force push, release mutation or bulk merge was performed.
