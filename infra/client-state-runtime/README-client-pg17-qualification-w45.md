# Client W45 — disposable PG17 qualification (SYNTHETIC/STAGING)

This branch is **not** W43 convergence or a physical Owner/Guardian qualification.
It is based on W37 PR #1266 (exact SHA in the adjacent machine-readable parent ledger)
and dynamically imports W26's real supervisor lease and W39's fixed project query
from exact-head, full-source CI checkouts. W37 already carries W25 restart-admission
and W5 claim-trigger source. W30 is checked as a separate frozen upstream source.

Real-test contract: only run on Linux with explicit W45_PG17_DOCKER=1 using the
digest-pinned official PG17.6 container. A new random container ID, anonymous
Docker volume and loopback-assigned port are created by the test; no ambient
PGDATA, DATABASE_URL, PGHOST/PORT/PASSWORD or Owner file is consumed.
The container and its anonymous volume are deleted even after assertion failure.
The test asserts actual SQLSTATE permission errors, RLS SELECT isolation,
READ ONLY versus SELECT FOR SHARE, supervisor row CAS under racing connections,
lost reservation ACK reconciliation, monotonic event cursor, postmaster restart,
W5 advisory transaction lock, resource slots and committed return.

**Qualifying limit:** the RLS and EXECUTE test tables/functions and claim-task
rows are explicitly *synthetic*; this does **not** establish the real installed
Owner transaction/grants, W39 seeded project's actual SELECT FOR SHARE call,
accepted independent critic, emergency-stop executor E2E, or Windows physical
PG17. In particular, W39's project snapshot must run under an authenticated
Owner-bound REPEATABLE READ transaction that is **not READ ONLY** where its
real device-grant function uses SELECT FOR SHARE. Do not claim read-only SQL
compatibility merely because an observer's caller uses fixed SELECT text.

On hosts lacking the pinned PG17 Docker fixture, local test output is
SKIP/UNKNOWN, never PG17 PASS. No installed Browser/Guardian/DevFleet
or PostgreSQL, production migration, Supabase, hosted fallback, live task
or scheduler is touched. Keep this PR Draft and all ancestors Draft.
