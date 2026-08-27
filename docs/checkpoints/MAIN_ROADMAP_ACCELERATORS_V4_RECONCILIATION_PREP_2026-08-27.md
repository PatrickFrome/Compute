# MAIN ROADMAP ACCELERATORS V4 — LEASE RECONCILIATION PREP CHECKPOINT

Date: 2026-08-27
Branch: `work/main-roadmap-accelerators-v4`
Source head before checkpoint: `17a9b533ec8d0c74572b75df61425ebf04a1c29a`
Source tree: `28d07010c762dcbe6524df587b33c377453c8d12`

## Result

Prepared an explicit supervisor-only roadmap lease reconciliation primitive:

`destruktion_meta.compute_fabric_supervisor_reconcile_roadmap_leases_h205f22(uuid)`

Migration:
`supabase/migrations/20260827201500_main_roadmap_lease_reconciliation_v1.sql`

Contract tests:
`tests/test_main_roadmap_lease_reconciliation_sql_contract.py`

## Semantics

A real invocation requires the current ACTIVE `COMPUTE_FABRIC_MAINLINE` supervisor token, takes a transaction-level advisory lock, binds all decisions to one `statement_timestamp()`, and then:

- transitions only expired finite ACTIVE claims to `EXPIRED`;
- transitions only expired finite ACTIVE directives to `SUPERSEDED` and records `superseded_at`;
- resets `IN_PROGRESS` milestones to `PLANNED` only when no fresh ACTIVE claim remains;
- uses `UPDATE ... RETURNING` to report the exact mutated IDs.

A successful invocation explicitly reports `database_mutation=true` and `authority_effect=true`; provider, Edge, PR-merge, and checkpoint-promotion effects remain false.

## Verification

GitHub Actions:

- run `33112143146`;
- exact head `17a9b533ec8d0c74572b75df61425ebf04a1c29a`;
- result `success`.

The workflow verifies cycle-oracle contracts, lease-truth guard contracts, reconciliation SQL scope, read-only snapshot purity, and non-authority boundaries for the PREP guards.

## Research checkpoint

The reconciliation design was compared with:

- Kubernetes lease expiry / coordinated leader election;
- PostgreSQL transaction-level advisory locks;
- PostgreSQL `UPDATE ... RETURNING` exact mutation receipts;
- existing H205F22 claim/directive lifecycle constraints and current supervisor functions.

Details are recorded in `research/main-roadmap-accelerators/lease-truth-fence.md`.

## Live state and boundaries

The last read-only live witness still shows stale claim `[32]`, stale directives `[25,26,29]`, alignment claim `[32]`, and supervisor fresh claims `[]`.

Therefore publication remains fail-closed until reconciliation is explicitly authorized and performed through an authority-bearing path.

This checkpoint does **not** claim:

- live DDL applied;
- reconciliation invoked;
- supervisor secret accessed;
- stale rows mutated;
- W1 live persistence proved;
- W1 `VERIFIED`;
- PR merge;
- force-push;
- provider mutation;
- Edge deployment;
- canonical checkpoint promotion.
