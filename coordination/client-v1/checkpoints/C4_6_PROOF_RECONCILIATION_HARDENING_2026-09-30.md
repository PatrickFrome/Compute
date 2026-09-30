# C4.6 checkpoint — Exact proof reconciliation

Date: 2026-09-30.
Branch: `work/client-v1-c4-proof-reconciliation-hardening-v1`.
Parent: `work/client-v1-c4-physical-agent-qualification-v1 @ a798561cc462d7a625177e98f18bab47f42b82fa` (#1082).
Roadmap: `metaengine-client-v1`, `C4_TYPED_PRODUCT_CONTROL`, alignment epoch 3.

## Fresh source audit

C4.4 (#1081) and C4.5 (#1082) were already published. This slice reuses them.
The complete non-shallow remote inventory contains 745 branches: 190 contained, 548 divergent, 6 unrelated histories and 1 exact head. All namespaces are included. Full inventory: `C4_6_BRANCH_INVENTORY_2026-09-30.json`.

Parent runtime/package/installed-chat/soak/self-update checks passed. Two parent checks failed for independently verified reasons:

- R83 equivalence: the deployed canary lacked `/v1/devos/environment-state`.
- Signed canary: 54/54 contracts passed, then enrollment approval timed out; no goal was submitted by that run.

## Reproduced defects and fixes

Before changes, 13 of 14 new behavioral cases failed:

- accepted result did not require available result proof;
- result-summary/result digest equality was not checked;
- REJECT/BLOCKED/FAILED disposition could be projected as accepted;
- Agent proof could claim lease generation zero;
- previous positive proof survived changes to progress lease/state/result digests;
- a late proof could overwrite a newer lease;
- restart retained mismatched historical proof;
- failed durable storage already changed the published in-memory journal.

The contract now rejects inconsistent positive claims. The journal retains proof only when its exact identity, lease, state and result digests match current progress. Disk restoration applies the same rule. Journal mutations serialize against the latest durable state and publish only after a successful storage write. A failed queue item does not block subsequent recovery writes.

No goal resend or external Browser effect replay is added.

## Qualification topology

`Client V1 C4 Goal Contracts` runs automatically on relevant PR changes.
Signed canary and physical Agent qualification require dispatch or their explicit PR labels. This supports stacked branches whose workflow is not registered on the default branch. Exact PR head checkout is retained.

The shared signed harness also supports explicit LOCAL origin metadata with a separate local run ID/client namespace; such evidence must never be represented as a GitHub Actions run.

## Deployment readback

Recovery project: `jhriwwsryeqsvvvufkok`.
Canary: `a2-browser-native-supervisor-v14-canary`, version 22.
EZBR SHA-256: `53ea85117de5d1ee8dee8414a3bdc4c2cbb54782d7f03c3eac9259e271307336`.
All ten remote imports now use parent source pin `a798561cc462d7a625177e98f18bab47f42b82fa`. Every deployed source file was read back and matched the deployment input byte-for-byte. This slice changes no Edge module or SQL migration relative to that pin.

Stable rollback readback: version 8, source pin `00d7c814213a97ac17504d5c598818bd99c588cb`, EZBR `3ce87ea81481dbf8fd6afee819bed3bd3b41528e7b5c6842a2d7b7be38ccf829`.
The qualification manifest is updated to these observations; promotion remains false. Stable production was not deployed.

## Verification at publication

- 89/89 focused Client V1 tests passed.
- 16 dedicated integrity/restart/storage/concurrency cases passed.
- Complete isolated Browser regression suite: 3,723 cases, 3,721 PASS, 2 existing skips, 0 failures.
- Node syntax and `git diff --check` passed.
- Exact-head remote CI and signed qualification are pending at this source checkpoint; their terminal evidence belongs to the PR/run artifacts, rather than a source manifest mutation after qualification.

## Physical boundary

Fresh DB observations: `refill_enabled=false`, `supervisor_admission_enabled=false`, available slots 0, capacity source `UNSPECIFIED_FAIL_CLOSED`. Admission and fleet lifecycle are not overridden by this slice.

C4 exit `USER_GOAL_TO_DEVOS_AGENT_READBACK` remains PHYSICAL_AGENT_PENDING.
CI/package success or synthetic proof must not close it. C5 useful verified work and restart qualification also remain pending.

Research: `research/METAENGINE_CLIENT_V1_C4_PROOF_RECONCILIATION_RESEARCH_2026-09-30.md`.
