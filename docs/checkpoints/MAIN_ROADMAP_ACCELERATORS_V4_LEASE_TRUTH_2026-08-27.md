# MAIN ROADMAP ACCELERATORS V4 — LEASE TRUTH CHECKPOINT

Date: 2026-08-27
Branch: `work/main-roadmap-accelerators-v4`
Source head before checkpoint: `1d7c3012776371b561502cbda9484307a0b6deac`
Upstream projection head: `c1f52796b5338cd9f1cb97b3643caa34fa85e63e`
Current `main` observed during the cycle: `0d1c074c7f513f25000d967761c7bb13912dacaa`

## Semantic result

Implemented `MAIN_ROADMAP_LEASE_TRUTH_V1` as a fail-closed, PREP-only guard in front of normal PLAN/PUBLISH roadmap execution.

Artifacts:

- `controller/roadmap/roadmap_lease_truth_guard.py`
- `supabase/prep/main_roadmap_lease_truth_snapshot_v1.sql`
- `tests/test_main_roadmap_lease_truth_guard.py`
- `research/main-roadmap-accelerators/lease-truth-fence.md`
- `.github/workflows/main-roadmap-cycle-oracle.yml`
- `docs/ROADMAP_EXECUTION_PROTOCOL.md`

## Live Supabase witness

Read-only observation time: `2026-08-27T20:07:36.917662+00:00`.

Observed facts:

- selected Level-2 target: `W1_PERSISTENT_LINUX_WORKER_SAFETY`;
- durable Level-1 owner: `C1`, mapping kind `PRIMARY`;
- fresh raw active claim IDs: `[]`;
- stale raw rows still labelled ACTIVE: claim `[32]`;
- alignment active claim IDs: `[32]`;
- supervisor projected active claim IDs: `[]`;
- stale raw directives still labelled ACTIVE: `[25,26,29]`.

Expected and correct guard outcome on this live state:
`BLOCK_MAIN_ROADMAP_LEASE_TRUTH_NONAUTHORITY`.

This is negative live evidence of control-plane lease projection drift. It is not a W1 failure and is not permission to promote W1. `W1` remains `READY`, not `VERIFIED`.

## Verification

GitHub Actions exact-head run for the implementation source head:

- workflow: `Main Roadmap Cycle Oracle`;
- run: `33111742738`;
- result: `success`;
- compile deterministic guards: PASS;
- positive/adversarial lease contracts: PASS;
- read-only SQL contract: PASS;
- non-authority source-visible contract: PASS.

A previous exact v3 projection proof also remains green:

- Main Roadmap Cycle Oracle: `33109180953` — success;
- Main Roadmap Projection Guard: `33109180944` — success.

## Research basis

The design was checked against:

- Kubernetes Lease semantics (`renewTime` + `leaseDurationSeconds`);
- PostgreSQL `statement_timestamp()` semantics;
- GitHub Actions least-privilege guidance.

Research details and primary references are recorded in `research/main-roadmap-accelerators/lease-truth-fence.md`.

## Boundaries / non-claims

- `canonical=false`;
- `authority_effect=false`;
- no DDL applied;
- no DML cleanup applied;
- no Edge deployment;
- no provider mutation;
- no PR merge;
- no force-push;
- no canonical checkpoint promotion;
- no W1 VERIFIED claim.

## Next semantic step

Repair lease truth at the authoritative read surface and/or add an explicit lease reconciliation path, then re-run the same live snapshot. Only after the stale ACTIVE rows no longer contaminate alignment and the lease-truth guard passes should the main-roadmap cycle resume publication toward the real W1 live persistence proof.
