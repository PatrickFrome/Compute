# R1 fresh-project continuity convergence — 2026-10-05

Status: IMPLEMENTATION CANDIDATE / no canonical promotion  
Canonical owner: **R1 Continuity Plane Adoption**  
Level-2 gates: `R1_CONTINUITY_PLANE_ADOPTION` → `R2_TWO_DOMAIN_PERSISTED_READBACK` → `R3_RESTORE_DRILL_QUORUM`

## Fresh finding

The current qualified Browser source is `eb08a46ad5093bfb0b2e17da6acc6b01fb9996f8`.
The current live Supabase project `jhriwwsryeqsvvvufkok` has zero `compute_continuity_*` tables/functions, while the repository still contains the historical H41–H49 contract and rollback semantic test.

The historical migration chain is not safe to replay verbatim into a fresh project: `20260821044158_r1_continuity_plane_adoption.sql` creates an index/comment against continuity tables that are only created later by `20260821044429_r1_continuity_schema_contract.sql`.

## Implementation decision

Create one live-specific convergence artifact that reuses the historical contract **without changing semantics**, but applies it in a fresh-project-safe order:

1. transaction-scoped advisory lock and strict preflight;
2. schema contract (10 tables);
3. semantic guards (15 security-invoker functions, pinned empty search_path);
4. trigger contract (16 triggers);
5. RLS/ACL contract (10 deny policies; anon/authenticated table/function access revoked);
6. historical index/comment adoption patch;
7. structural postconditions.

The migration refuses to run if any R1 continuity artifact already exists. It intentionally does **not** include STEP09B ingestion, provider credentials, persisted-readback rows, H47C seals, restore receipts, or canonical roadmap promotion.

## Verification

`scripts/metaengine-r1-continuity-fresh-project-canaries.sql` first checks deployed structure/ACL and then runs the existing `r1_continuity_plane_adoption.sql` semantic suite inside a transaction that ends with `ROLLBACK`.

Passing this step proves only the R1 state-machine substrate. It does not prove independent durability.

## Upstream research used

- PostgreSQL 17 advisory locks: https://www.postgresql.org/docs/17/explicit-locking.html
- PostgreSQL function security: https://www.postgresql.org/docs/current/perm-functions.html
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase migration workflow: https://supabase.com/docs/guides/local-development/cli-workflows

Supabase documents migration files as transactional in branching/db-push workflows; the convergence uses only transaction-safe DDL.

## Acceptance boundary

After deployment and rollback canaries:
- R1 implementation substrate may be **EVIDENCE_READY**;
- R2 remains **NOT_PROVEN** until two real current persisted readbacks exist in two independently evidenced domains;
- R3 remains **BLOCKED_BY_R2** until two real restore/readback drills pass;
- no operational audit row or schema presence may be treated as a Supervisor semantic seal.
