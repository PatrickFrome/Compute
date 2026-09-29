# C2.2 Incident Checkpoint — Supabase Postgres Disk Exhaustion

Captured: 2026-09-29
Project: xpeibufgzjknrhbhpffp
Plan: Free tier

## Observed failure

Database control-plane calls repeatedly fail with ECONNREFUSED.

Read-only Supabase log evidence shows a persistent PostgreSQL crash/recovery loop. The repeated root error is:

`could not write to file "pg_wal/xlogtemp.<pid>": No space left on device`

Observed recovery sequence repeatedly includes:
- database system was interrupted while in recovery
- automatic recovery in progress
- database system is not accepting connections / is shut down
- pg_wal xlogtemp write fails with No space left on device

No `ready to accept connections` event was observed in the inspected window.

Management API simultaneously reports project status ACTIVE_HEALTHY, so project-level status is not sufficient evidence for DB readiness.

## Root-cause classification

Primary blocker: POSTGRES_DISK_EXHAUSTION_DURING_WAL_RECOVERY

This is infrastructure/storage state, not an R109 source defect.

## Safety decision

Do NOT:
- apply migrations while DB readback is unavailable;
- issue repeated blind DB retries;
- pause/restore as a speculative repair;
- weaken R83;
- promote the Edge canary or release candidate.

The R109 v14 Edge canary remains safely staged at version 2, pinned 10/10 to exact R109 source.

## Research

Supabase documentation states:
- disk size includes database data, WAL and system files;
- Free Plan projects have bounded disk and do not have paid-plan disk auto-scaling;
- WAL can materially consume disk;
- cleanup/VACUUM requires an accepting database connection;
- disk sizing/expansion is a platform-level concern.

Reference:
https://supabase.com/docs/guides/platform/database-size

## Required recovery evidence

Before C2 resumes:
1. platform storage pressure is relieved;
2. Postgres logs show `ready to accept connections`;
3. list_migrations/read-only SQL succeeds;
4. exact migration state is inspected;
5. only then may Agent-origin migration be applied if absent.

Status: BLOCKED_INFRASTRUCTURE_STORAGE.
