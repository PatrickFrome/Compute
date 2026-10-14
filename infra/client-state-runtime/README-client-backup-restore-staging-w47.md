# W47 protected backup/restore staging (source candidate)

Scope: **generated fixture only**. This work extends the existing immutable
`pg17-backup-effect-barrier.mjs`, disposable-only `pg17-one-shot-disposable-dump-executor.mjs`,
real two-cluster `disposable-pg17-logical-restore.integration.test.mjs`,
and read-only installed `upgrade-backup-gate.mjs`. It neither creates another
executor/scheduler nor invokes a live Host, Keeper, Owner, installer, Vault,
profile, PostgreSQL data directory or production migration.

The one-shot fixture dump must cross the durable effect marker **before** the
existing `pg_dump -Fc` invocation. A lost ACK, crash, pre-existing archive,
old request ID or interrupted durable write remains **EFFECT_UNKNOWN / no retry**.
Post-restore `sealClientBackupRestoreStagingW47` only reads bytes and appends
one immutable metadata record under a newly generated temporary journal.
It independently checks full SHA-256 archive bytes, pinned `pg_restore --list`
TOC, source SHA/Owner/PG epoch, two distinct PostgreSQL 17 cluster identities,
data fingerprint equality and a separately preserved rollback fixture digest.
A subsequent call cannot overwrite the marker.

On Windows, Node's POSIX mode bits are **not** a verified NTFS DACL:
`ACL_REVIEW_REQUIRED` is the best possible W47 staging outcome pending
independent native Owner-only DACL readback. On POSIX, staging checks private
directory/file mode, still **not** installed Owner authority.

A test uses newly initialized disposable PG17 clusters with random loopback
ports away from known installed Keeper ports, generated rows only,
independent `pg_restore --list`, real `pg_restore --single-transaction
--exit-on-error`, source/destination SQL readbacks and a negative SQL-grant
fixture. It runs **only on Windows with**
`LOCAL_STATE_TEST_PG_BIN_DIR` pointing at pinned PG17 test binaries; without
that environment it reports **SKIP**, never PASS. The previous `.59` backup
is still UNKNOWN and must **never** be retried or reused.

Run:

```text
npm.cmd run test:w47:staging
npm.cmd run test:w47:pg17
```

No staging receipt, even one with `STAGING_PASSED`, can satisfy the installed
backup preflight. The source consumer explicitly rejects `SYNTHETIC/STAGING`.
An installed upgrade additionally requires a new authenticated native
Owner/Keeper incarnation, verified Windows DACL, exact source/physical data,
independently measured restore and rollback/quiescence evidence. No release or
installed activation is authorized by this PR.
