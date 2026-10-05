# R1 STEP10 fresh-source identity qualification — 2026-10-06

Status: **EVIDENCE RECORD / PREPARE_ONLY**  
Canonical owner: **R1 Continuity Plane Adoption**  
Level-2 gate: **R2_TWO_DOMAIN_PERSISTED_READBACK**  
Parent source-identity head: `4171e6fc0db88aa6215571ce9925f77f1bc70872`

## Purpose

The fresh-project recovery source chain was re-bound to Supabase project
`jhriwwsryeqsvvvufkok` and recovery-source predicate type v2. The existing STEP10
orchestration remained fail-closed, but its CI trigger did not execute on the successor
branch because it only had pull-request-to-main and manual-dispatch entry points.

This qualification step closes that verification gap without executing the live path.

## Change

`.github/workflows/r1-live-r2-execution.yml` now has a push-only qualification trigger
for `work/r1-step10-source-identity-qualification-v1`.

The contract check additionally proves that:

- the shared source attester expects `jhriwwsryeqsvvvufkok`;
- the old `xpeibufgzjknrhbhpffp` project is not the expected project;
- the shared source predicate type is
  `https://github.com/PatrickFrome/Compute/attestations/r1-recovery-source/v2`;
- STEP09A imports the shared source contract rather than defining an independent stale
  predicate literal;
- the production authority wrapper passes that shared predicate into
  `gh attestation verify --predicate-type`.

All live jobs remain gated by `github.event_name == 'workflow_dispatch'`; the new push
path can execute only `contract-tests`.

## Verification

Commit `30745a61f1dc39947ea7341e1009080a9d76e507` produced:

- **R1 Live R2 Execution Orchestration #5**, run `37382076344`: SUCCESS;
- `contract-tests`: SUCCESS;
- STEP10 adversarial tests: SUCCESS;
- STEP08 / STEP09A / STEP09B regressions: SUCCESS;
- live R2 trust-zone static contract: SUCCESS;
- `preflight-live`, `evidence-assembly`, `aws-materialize`, `authority-gate`,
  and `db-ingestion`: SKIPPED on the push event.

Adding this evidence record changes the branch head, so the final documentation head must
receive another exact-head green STEP10 run before this increment is marked evidence-ready.

## Authority boundary

This qualification does not:

- perform a trusted recovery-source dispatch;
- fetch provider ciphertext from AWS or Backblaze;
- generate a fresh STEP09A live authority receipt;
- invoke STEP09B against the live continuity database;
- create continuity rows or a persisted seal;
- prove or promote R2;
- prove R3.

R2 remains **NOT_PROVEN** and R3 remains **BLOCKED_BY_R2**.

## Roadmap reconciliation

The step advances R1 by proving that the prepared live R2 orchestrator consumes the
fresh-project/v2 source identity chain end-to-end. It does not add a new control-plane
authority or move work to C1 early.

After integration, the remaining R1 blocker is live evidence execution under the existing
STEP10 prerequisites and protected environments. Missing credentials, environments,
freshness, provider evidence or identity bindings must continue to fail closed.
