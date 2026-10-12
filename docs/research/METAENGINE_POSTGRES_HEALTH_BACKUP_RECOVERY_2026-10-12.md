# METAENGINE P0 — PostgreSQL health evidence and protected backup recovery
Date: 2026-10-12
Source branch: `work/client-autonomous-continuity-v1`
Scope: local source and offline regressions; **not** installed recovery.

## Physical facts, not interpretations
- Installed .59 Owner Browser PID 2888, Guardian 3288 and PostgreSQL Keeper PID 10776 were observed. Keeper loopback port 55432 accepted TCP; API/Edge ports 55433/55434 were absent. The previous local read-only census reported runtime STOPPED, Admin unavailable and a historical WAKE_AMBIGUOUS with no proven agent work.
- .61.1 built from exact source `c5917a9...` passed a **disposable** PostgreSQL 17 + Owner + Browser/UI/CDP physical E2E. It was not installed as the successor to the working Owner.
- One attempted .59->.61 live logical backup failed closed, leaving a 0-byte `postgresql-17-snapshot.dump` and **no PASS receipt**. Its specific pg_dump error was not captured by the old executor. No duplicate backup attempt, live restore, wake replay, or install was performed in this cycle.
- Historical local59 backup receipt represents a prior snapshot (2,587,784 bytes, different time/config). It is not evidence of fresh data preservation before .61.

## Research grounding
PostgreSQL 17 documentation: [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html) issues SELECT, requires the exporting role to have sufficient rights, and uses libpq environment options. A live TCP port or `pg_isready` is **not** a successful authenticated pg_dump.

[CREATE ROLE](https://www.postgresql.org/docs/17/sql-createrole.html) states that pg_dump sets row_security=OFF by default and returns an error if its role cannot dump the table under RLS. [libpq environment](https://www.postgresql.org/docs/17/libpq-envars.html) documents PGOPTIONS and warns against PGPASSWORD in environments. Future backup capability should prefer a protected passfile and ensure its storage/ACL contract, not store credentials or stderr in telemetry.

[Temporal Activity Definition](https://docs.temporal.io/activity-definition) and [AWS Durable Execution idempotency](https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/) distinguish deterministic workflow checkpoints from side-effect attempts. An unknown effect must not be replayed merely because a worker died or a timeout elapsed.

## New source mechanism
`infra/client-state-runtime/postgres-utility-diagnostic.mjs` is a pure bounded finite-classification boundary for psql/pg_dump stderr. It returns only a fixed category code; it does not return original text, passwords, SQL, role names, endpoints, credentials, or an authorization to retry.

`infra/client-state-runtime/launcher.mjs` now pipes a maximum of 16 KiB of private stderr for **classification only**, then discards it. stdout remains bounded and complete only on process `close`, not early `exit`. A 16 KiB stderr overflow fails closed with a finite code and terminates **only the freshly owned child**. The native runtime health failure whitelist includes the new categories, and runtime-host may persist them unchanged as sanitized public metadata.

The new code is for **future candidate** bundles; already-installed .59 does not gain this capability from a source commit.

| Observed future finite code | Meaning for recovery planning |
|---|---|
| postgres_inspection_auth_failed | inspect credential/authentication proof absent; review owner-controlled private settings and existing grants, no auto retry |
| postgres_inspection_permission_denied / row_security_denied | role capability/SQL policy refusal; review limited grants rather than elevating blindly |
| postgres_inspection_connection_refused / server_unavailable | distinguish unavailable postmaster from forbidden SQL; still require exact process-incarnation proof |
| postgres_inspection_query_timeout | possible resource, lock or query timeout; diagnose before bounded action |
| postgres_inspection_database_missing | database pin not found; do not adopt a different database |
| postgres_inspection_query_failed | unknown error; preserve conservative fencing |
| postgres_inspection_stderr_limit | diagnostic overflow; suppress raw data and fail closed |

The same pure classifier can be used by a **new separately-identified** backup attempt harness, but no live backup was retried in this development cycle. These codes are diagnostic hints, **not authenticated receipts** and not licenses to mutate DB state.

## Work required before installation
1. Produce a trusted *nonsecret* postmortem of previous pg_dump failure using previously authorized logs or independently grounded diagnostics; if inconclusive report UNKNOWN.
2. Build a new bounded, exact-incarnation, new-destination backup transaction with one immutable effect intent, stage journal, independent readback, owner-only ACL and no automatic retry after unknown results.
3. Confirm full pg_dump custom archive, independently run pg_restore --list and restore into a strictly disposable PostgreSQL cluster; validate tables and data. Verify postmaster/Vault/Owner hashes unchanged.
4. Prove old Owner is safely quiescent and preserve history/rollback. Only then promote a newly built candidate with all post-.61 source changes.
5. Physically confirm Admin/Edge/runtime ready, then a real admitted goal -> leased agent -> ChatGPT readback -> independent critic -> durable checkpoint -> next cycle; eventually 4-agent and 72-hour restart tests.

## Explicit limits
No live .59 diagnostic failure was reclassified retroactively; original raw stderr did not survive the old executor. A passing synthetic classifier test is not proof that current Keeper credentials work or that future pg_dump will complete. This document reports source-level hardening, not restored autonomy.
