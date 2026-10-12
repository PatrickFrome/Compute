# METAENGINE PG17 one-shot backup and disposable restore — 2026-10-12

Baseline: `f5b1b1a802ef5af74d188675b0df3fbc3d4963a9`, branch `work/client-autonomous-continuity-v1`.
This checkpoint is about **source and disposable test infrastructure**, not a fresh backup of the installed .59 Owner.

## Why this stage matters

The installed Owner still has an externally attached PostgreSQL Keeper listening on 127.0.0.1:55432, but API and Edge remain unavailable. The old pre-upgrade backup is zero bytes, lacks a PASSED receipt, and its exact pg_dump failure is UNKNOWN. Never reuse that archive, assume old credentials work, retry that effect blindly, promote .61, or replay the historical ambiguous wake.

PostgreSQL 17 primary references:
- https://www.postgresql.org/docs/17/app-pgdump.html — custom-format archives, lock timeout, default synchronized writes, scope limited to one database
- https://www.postgresql.org/docs/17/app-pgrestore.html — TOC inspection and isolated single-transaction restore; archive SQL may execute privileged code
- https://www.postgresql.org/docs/17/app-pg-dumpall.html — global objects (including roles and tablespaces) are outside one-database pg_dump
- https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/ — unknown effect is not an authorization to repeat a step

## New source contracts

`infra/client-state-runtime/pg17-backup-effect-barrier.mjs`:
- PREPARED includes exact owner PID and SHA, Keeper PID and postmaster SHA, source HEAD, and an absolute new archive path. No credentials or permission for installer/automatic retry.
- Writes an exclusive, fsync'ed immutable intent file before any external effect.
- Creates an exclusive, durable directory-level archive reservation, so two UUIDs cannot claim the same destination. Archive must reside in the exact canonical private journal directory, never a redirect/alias.
- A subsequent exclusive fsync'ed barrier marks EFFECT_MAY_HAVE_STARTED. It must be acknowledged **before** running pg_dump. After process death, a lost ACK or an incomplete marker implies EFFECT_UNKNOWN; no automatic re-entry.
- Reads do not take action, authorize upgrade, classify success, or access PostgreSQL.

The module **does not certify Windows ACLs, user authorization, keeper process incarnation beyond provided pins, freshness of credentials, or actual backup success**. Production callers must supply separately attested Owner/PGDATA/Vault/ACL identity and private trusted execution.

`infra/client-state-runtime/disposable-pg17-logical-restore.integration.test.mjs`:
- Requires an explicitly supplied offline PostgreSQL 17 binary directory and Windows, never references the installed Owner or original Keeper connection.
- Creates two brand-new temporary PG17 data directories and starts individually owned postmasters on distinct fresh loopback ports; both must stop with ownership proof before the fixture is deleted.
- Seeds a small test table, records its row count and canonical content MD5 from server-side SQL, publishes/crosses one test-only backup intent, creates a real synchronized `pg_dump --format=custom` archive with bounded lock wait and no password prompting, checks PGDMP, archive SHA-256 and independent `pg_restore --list`.
- Restores into the second PG17 cluster using `pg_restore --single-transaction --exit-on-error`. Compares exact source/destination data fingerprints, distinct `pg_control_system()` identities, and unchanged archive hashes; does not emit row contents or credentials.
- Injects one altered row *only in disposable destination*, proves the content digest changes even with the same row count.
- A synthetic fixture receipt explicitly has `promotion_authorized:false` and does not satisfy the existing installed-upgrade physical restore authority gate.

## Test results and limits

- Standalone backup barrier: 9/9 PASS, including 12 concurrent attempts and two different UUIDs targeting the same archive.
- Installed upgrade archive/restore consistency regressions: 34 PASS, 1 SKIP (Windows symlink privilege), no failures.
- Real isolated two-postmaster dump/restore E2E: 1/1 PASS (~53 seconds), including same-count data drift detection.
- Full project source checks and final exact SHA must be retested after the last source change.
- Physical QA source data is tiny and manufactured; no large-scale production volume, custom role membership, Vault state, RLS or extension compatibility was proven. A successful pg_restore in a fixture cannot by itself authorize an installed upgrade.

## Production upgrade gates still open

1. Authenticated, least-privilege read-only postmortem of original attached Keeper failure, with secret-free finite error codes; if unavailable retain UNKNOWN.
2. Fresh owner-ACL-protected journal and new destination; exact Owner, Keeper PID/process incarnation and postmaster epoch pins; fresh role/connection authority separately verified.
3. One write-ahead backup intent; at most one fresh pg_dump effect; independent TOC, SHA, complete data and roles/meta verification.
4. Independent restore in an isolated PostgreSQL 17 cluster with measured full-table row/content identity, restore stderr redaction and object/global role accounting.
5. Verified rollback source, quiescence and exact SHA packaged Owner/PG/UI E2E; only then a separately authorized installed upgrade.
6. Real admitted user goal -> lease -> agent ChatGPT effect -> independent critic -> durable result -> next goal; later measured multiagent scaling and crash-recovery soak.

No attempt in this stage accessed the installed database or changed the running Browser/Guardian/keeper.

## Follow-up: disposable executor with actual subprocess semantics

`infra/client-state-runtime/pg17-one-shot-disposable-dump-executor.mjs` now owns the complete test-only operation rather than relying on a caller to perform an ad hoc dump between the intent barrier and readback:
- refuses live Keeper port 55432 and known API/Edge ports and any source PGDATA or journal outside the canonical OS temporary directory;
- resolves exact regular `pg_dump.exe`, `psql.exe` and `pg_restore.exe` resources; binds the custom pg_dump binary to a caller-pinned SHA-256;
- ensures PostgreSQL server 17 SQL identity, system identifier, port and start time agree before and after the dump, with an exact postmaster.pid readback matching the fixture-owned postmaster PID;
- narrows inherited environment to minimum Windows functionality plus explicit loopback connection settings; SQLSTATE diagnostics are finite and private stderr is bounded (16 KiB) and not persisted;
- records the exact one-shot durable effect barrier before spawning pg_dump; on timeout, failed process, stderr warning, failed archive integrity or ambiguous readback, the barrier is never removed and the effect cannot be blindly retried;
- validates PGDMP header, regular file, size and SHA-256, plus an independently executed `pg_restore --list` and rehashed archive; emits an immutable `ARCHIVE_ONLY_VERIFIED` receipt, explicitly `physical_restore_proven:false` and `upgrade_authorized:false`;
- has a real isolated two-cluster integration test, including the independent actual restore and same-count content corruption check. Unit tests reject the installed source port, a production PGDATA path, a mismatched executable digest and a retargeted connection before any effect intent.

Critical limitation: **this executor is deliberately DISPOSABLE-ONLY**, and the test fixture currently provides a temporary password through the child environment (never printed or persisted by the executor). This is not suitable for production authority/secret handling. A future installed-Owner executor needs independent native attestation of process incarnation/ACL, protected credential ingress (such as a locked-down passfile), active local capabilities, isolated archive storage, a fresh backup namespace and an independent physical restore with all application roles, extensions and source-data verification. This artifact is not a new live backup and does not lift the installed update gate.

Official references:
- https://www.postgresql.org/docs/17/app-pgdump.html (pg_dump archive format, stderr warnings, global-data limitations)
- https://www.postgresql.org/docs/17/app-pgrestore.html (readable TOC versus actual transactional restore)
- https://docs.temporal.io/activity-definition (workflow history does not guarantee an Activity side effect occurs only once)

### Qualified result on this source turn

Windows disposable executor integration: **5/5 PASS** (real two-cluster physical PG17 export/restore plus four pre-effect authority/digest/retarget fences). Backup and restore existing regressions: **37 PASS, 1 SKIP**, no failures. METAENGINE source check: **190 PASS**. The isolated source and destination PG17 clusters are stopped by the fixture. Exact commit SHA will be recorded by Git after these tests. Installed backup remains explicitly unqualified.
