# C2 Storage Forensics — Hidden Legacy ME2 Writer

Captured: 2026-09-29
Incident: Free-tier Postgres ENOSPC / pg_wal recovery failure

## Live observation

Before the database crash loop, Edge/API logs show successful writes to:

- public.me2_event_mirror_h205f22
- HTTP 201
- remote runtime user-agent: Bun/1.3.14
- network origin: Alibaba Cloud / Hong Kong

The exact source IP is intentionally not recorded in this governance checkpoint.

## Source reconciliation

Exact R109 Browser source:
- apps/me2-daemon/index.ts supports PROBE_MODE;
- in Browser PROBE_MODE, SqlMirror is replaced with an inert read-only projection;
- the Browser probe does not construct SqlMirror and does not enable cloud/token effects;
- apps/me2-daemon/src/sqlmirror.ts is a legacy/non-probe path that POSTs local ME2 events to me2_event_mirror_h205f22 when ME2_SQL_MIRROR=1.

Therefore the observed live writes are not produced by the canonical R109 packaged Browser probe. They originate from a separate historical/legacy ME2 runtime.

## Risk

SqlMirror is append-oriented and has no remote retention/deletion loop in the inspected implementation. It is zero-authority, but zero-authority does not mean zero-cost: a noncanonical process can still consume DB/WAL/storage budget.

This does NOT yet prove that me2_event_mirror_h205f22 caused the 1 GB physical disk exhaustion. Payload sizes observed in API logs are modest. WAL retention, table/index growth, dead tuples, replication slots or other historical planes remain candidates.

## Decision

- classify the remote ME2 SqlMirror writer as LEGACY_EXTERNAL_WRITER / QUARANTINE_TARGET;
- do not delete/truncate the table before post-restore size and consumer census;
- do not restore this writer as a Client V1 dependency;
- after DB restore, measure table bytes, row count, recent timestamps, consumers, and replication-slot WAL retention;
- if no current production consumer exists, stop the writer / deny further writes and archive or delete the mirror under a separate evidence-gated cleanup.

## Research anchor

Supabase Free-plan projects:
- database-size quota: 500 MB;
- database disk: approximately 1 GB;
- physical disk also contains WAL and system files;
- WAL retention can therefore exhaust disk independently of user table size.

Reference:
https://supabase.com/docs/guides/platform/database-size

Status: FORENSIC_EVIDENCE_READY
authority_effect = false
