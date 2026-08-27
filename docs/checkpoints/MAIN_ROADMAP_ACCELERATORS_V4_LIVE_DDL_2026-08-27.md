# MAIN ROADMAP ACCELERATORS V4 — LIVE LEASE RECONCILIATION DDL CHECKPOINT

Date: 2026-08-27
Branch: `work/main-roadmap-accelerators-v4`
Verified source head before this checkpoint: `d4b8a3d2534172be4cdf6d75c20590642653319a`
Verified source tree: `723ad865385e060bbb2c5d6db24a17d3271ecc3b`
Current `main` observed in this cycle: `0d1c074c7f513f25000d967761c7bb13912dacaa`

## Live Supabase DDL

Applied migration:

- version: `20260827201322`
- name: `main_roadmap_lease_reconciliation_v1`
- function: `destruktion_meta.compute_fabric_supervisor_reconcile_roadmap_leases_h205f22(uuid)`

The migration installs the reconciliation primitive only. It does not call it.

## Live function readback

Readback after migration verified:

- `SECURITY INVOKER` / `prosecdef=false`;
- ACL: `postgres=EXECUTE`, `service_role=EXECUTE`;
- `anon` execute: false;
- `authenticated` execute: false;
- `service_role` execute: true;
- active supervisor token is still required by the function body;
- transaction-level advisory lock remains present;
- one `statement_timestamp()` remains the reconciliation observation time;
- claim/directive updates remain expiry-scoped and use `UPDATE ... RETURNING`.

No supervisor token was queried, copied, logged, embedded or requested.

## No-implicit-mutation witness

A read-only witness after the DDL, at `2026-08-27T20:15:15.573437+00:00`, still observed:

- selected Level-2 milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`;
- durable Level-1 owner: `C1`, mapping kind `PRIMARY`;
- fresh ACTIVE claims: `[]`;
- stale rows still labelled ACTIVE: claim `[32]`;
- alignment claim IDs: `[32]`;
- supervisor projected active claim IDs: `[]`;
- stale rows still labelled ACTIVE: directives `[25,26,29]`.

Therefore the definition-only DDL did not perform reconciliation. The correct lease-truth result remains:

`BLOCK_MAIN_ROADMAP_LEASE_TRUTH_NONAUTHORITY`.

## Verification

GitHub Actions exact-source run:

- workflow: `Main Roadmap Cycle Oracle`;
- run: `33112462560`;
- exact head: `d4b8a3d2534172be4cdf6d75c20590642653319a`;
- result: `success`.

AppVeyor for the same source head was still `pending` when this checkpoint was written (`build 54616847`) and is deliberately not counted as green evidence.

## Post-DDL advisors

Security and performance advisors were both run after the migration.

No advisor item identified the new reconciliation function as a vulnerability or performance problem.

Existing project-wide security findings remain, notably:

- INFO: multiple RLS-enabled tables without policies;
- WARN: `public.coordination_read_barrier_h205f22()` remains a publicly executable `SECURITY DEFINER` function for anon/authenticated roles;
- WARN: leaked-password protection is disabled in Supabase Auth.

Performance findings are existing INFO-level unused-index candidates. No index is removed in this checkpoint because usage telemetry and workload proof are required before destructive index cleanup.

## Research basis

The live DDL keeps the previously researched semantics:

- Kubernetes Lease expiration / takeover model;
- PostgreSQL statement-time observation semantics;
- PostgreSQL transaction-level advisory locks;
- PostgreSQL `UPDATE ... RETURNING` exact mutation receipts;
- GitHub Actions least privilege.

Full reasoning is in `research/main-roadmap-accelerators/lease-truth-fence.md`.

## Boundaries / non-claims

- reconciliation function definition: LIVE;
- reconciliation invocation: NOT PERFORMED;
- claim/directive data reconciliation: NOT PERFORMED;
- supervisor secret access: NOT PERFORMED;
- provider mutation: NOT PERFORMED;
- Edge deployment: NOT PERFORMED;
- PR merge: NOT PERFORMED;
- force-push: NOT PERFORMED;
- canonical checkpoint promotion: NOT PERFORMED;
- W1 live persistence proof: NOT CLAIMED;
- W1 remains `READY`, not `VERIFIED`.

## Next authoritative step

An authority-bearing supervisor path must explicitly invoke lease reconciliation, after which the exact read-only lease witness and lease-truth guard must be rerun. Only a PASS on that live state clears roadmap publication to resume the W1 real-persistence closure path. No stale row should be silently treated as authoritative before that point.
