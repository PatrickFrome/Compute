# C2 Infrastructure Incident — Free-plan Disk Exhaustion

Captured: 2026-09-29
Project: xpeibufgzjknrhbhpffp (METAENGINE_H205F22_RECOVERY)
Organization: jlzgdcwejnwynafwliuo
Plan: FREE / tier_free

## Verified failure chain

PostgreSQL logs prove a storage-exhaustion crash/recovery loop:

- SQLSTATE 53100
- FATAL: could not write pg_wal/xlogtemp.*: No space left on device
- startup process exits with code 1
- database shuts down
- automatic recovery restarts
- clients see SQLSTATE 57P03: database system is starting up / not accepting connections

Downstream symptoms:
- PostgREST 503 / PGRST002
- native supervisor Edge 502
- execute_sql/list_migrations ECONNREFUSED :5432
- Browser control-plane state/lease/heartbeat paths degraded

Management metadata reporting ACTIVE_HEALTHY is not sufficient release evidence while these physical readbacks fail.

## Plan constraint

Supabase organization metadata reports Free plan.

Official platform behavior:
- Free projects have a 500 MB database-size quota and approximately 1 GB project database disk.
- Paid-plan automatic disk expansion does not apply to Free projects.
- Pause and Restore is available specifically to Free-tier projects and restores from physical backup.
- Pause/Restore includes downtime but preserves project data; it provisions through the platform recovery path rather than deleting WAL/data manually.

## Recovery decision

Do NOT:
- delete WAL manually;
- issue blind destructive SQL;
- weaken R83/live qualification;
- promote release while DB state is unknown;
- upgrade to a paid plan as an implicit fix.

Use platform-supported Free-tier Pause → Restore recovery, then re-read:
1. project status;
2. SQL availability;
3. migration ledger;
4. exact Agent-origin function contract;
5. Edge health and Browser heartbeats.

## Client resilience follow-up

PR #1073 remains independently useful: dependency outages must not produce a zero-delay lease retry storm even after the database incident is recovered.

References:
- https://supabase.com/docs/guides/platform/database-size
- https://supabase.com/docs/guides/platform/upgrading
- https://supabase.com/docs/guides/troubleshooting/how-to-bypass-cooldown-period

promotion_authorized = false
