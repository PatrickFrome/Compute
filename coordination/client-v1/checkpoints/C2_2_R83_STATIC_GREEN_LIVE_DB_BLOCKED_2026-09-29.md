# C2.2 Checkpoint — R83 Static Green / Live DB Blocked

Captured: 2026-09-29

## IMPLEMENT

Created minimal successor branch:
work/client-v1-c2-edge-source-convergence-v1

Exact base:
ff95e9c886fac35b9302ec5c04a4c6bf7b8e8551

Commit:
31042b5a3d5048c3eba2b86d0a0ab4d5401b8a08

Draft PR:
#1072 Client V1 C2: bind R83 canary evidence to exact R109 source

Diff:
- 1 commit
- 1 file
- +4 / -4
- only coordination/convergence/R83_EDGE_CANARY_QUALIFICATION_V1.json

No Browser/runtime/Edge implementation bytes changed.

## VERIFY

Exact-head workflow:
R83 Edge Canary Qualification V1
run 36533604099
conclusion: SUCCESS

Every step is green, including:
- exact candidate head
- source equivalence to deployed v14 canary pin
- fail-closed qualification manifest
- required capability presence
- focused Edge convergence contracts
- zero authority effect

The manifest intentionally remains:
- live_qualification.completed = false
- promotion_authorized = false

## LIVE BLOCKER

Postgres is currently not usable even though project metadata reports ACTIVE_HEALTHY.

Observed independently:
- execute_sql: ECONNREFUSED ...:5432
- list_migrations: ECONNREFUSED ...:5432
- production native supervisor: HTTP 502
- PostgREST: HTTP 503 / PGRST002
- function log: native_supervisor_v13_failure connect ECONNREFUSED ...:5432
- function log: "the database system is starting up"

Therefore:
- R83 STATIC = GREEN
- DB migration state = UNKNOWN
- R83 LIVE = NOT QUALIFIED
- promotion = FORBIDDEN

## RESEARCH

Supabase official guidance:
- Edge Functions can use Postgres.js with prepare:false.
- Serverless applications generally benefit from Supavisor transaction mode (6543) for connection scalability.
- Transaction pooling cannot be substituted blindly for session-dependent behavior.
- METAENGINE uses a dedicated LISTEN connection for Postgres NOTIFY wake, which is session-oriented; connection strategy requires explicit split/research rather than global port replacement.

References:
- https://supabase.com/docs/guides/functions/connect-to-postgres
- https://supabase.com/docs/guides/database/connecting-to-postgres

## NEXT

1. Audit current DB connection consumers and separate:
   - request/transaction SQL
   - session-bound LISTEN/NOTIFY
2. Do not change frozen R109.
3. Resume DB migration/readback as soon as Postgres is reachable.
4. Keep #1072 draft until live qualification is real.
