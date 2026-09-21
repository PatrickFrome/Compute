# Pigsty DB Integration (`infra/pigsty`)

Self-hosted PostgreSQL 17 appliance that replaces the Supabase cloud postgres
for the METAENGINE Compute Fabric. Born from the 2026-09-20 Supabase evacuation
(free-tier limits exhausted): the full database now lives in a Pigsty-flavored
rootless PG17 cluster, and everything needed to stand it up again lives here,
next to the code.

## Live instance (sandbox profile)

| fact | value |
|---|---|
| cluster | `/home/z/my-project/pigsty/rootless/PGDATA` |
| port | `55432` (TCP `*`) + unix socket `rootless/run` |
| version | PostgreSQL 17.11 (Debian packages extracted with `dpkg-deb -x`, no root) |
| database | `postgres` (single-DB Supabase layout) |
| extensions | pg_cron 1.6 (background-workers mode), pgmq 1.13.1, pg_net 0.20.4, supabase_vault 0.3.1, pgcrypto 1.3, uuid-ossp 1.1, pg_stat_statements 1.11 |
| wal_level | `logical` (`supabase_realtime` publication intact) |
| schemas | auth, cron, destruktion_meta, extensions, graphql, net, pgmq, public, realtime, storage, supabase_migrations, vault |
| size | ~289 MB, 250 user tables |

## Verified restore (2026-09-20)

- 264-table row-count manifest diff: **256 exact matches**.
- 8 hot tables differ because the restored backup is **newer** than the snapshot
  manifest (live writes continued until 13:38 UTC before the freeze):
  `cron.job_run_details`, `destruktion_meta.compute_fabric_cat_reconciliation_receipt_h205f22`,
  `destruktion_meta.compute_federation_supervisor_sweep_h205f22`,
  `destruktion_meta.devos_fleet_{claim,event,task}_h205f22`,
  `public.compute_fabric_a2_browser_device_{enrollment_request,nonce}_h205f22` —
  seven show MORE rows, one (nonce) fewer because expired nonces were purged.
  No data loss.
- `storage.objects` 1831/1831; `auth.users` 1/1; 16 Supabase roles restored.
- 5 pg_cron jobs live and succeeding: supervisor sweep (10s), fleet watchdog
  (30s), attestation reconcile (1m), cat-trust reconcile (1m), baseline sync (2m).

Full record: `RESTORE-REPORT-20260920.md`.

## Layout

| path | purpose |
|---|---|
| `conf/pigsty-tuning.conf` | canonical tuning (source of truth for `PGDATA/pigsty-tuning.conf`) |
| `conf/pg_hba.conf` | auth policy (sandbox trust profile — harden before production) |
| `bin/pg-start` `bin/pg-stop` `bin/pg-restart` `bin/pg-status` | cluster control |
| `bin/env.sh` | psql environment (source it) |
| `bootstrap/01-bootstrap-rootless-pg17.sh` | stand up rootless PG17 from Debian packages |
| `bootstrap/02-build-extensions.sh` | build pgmq / pg_net / supabase_vault from source |
| `bootstrap/03-restore-supabase-backup.sh` | restore an evacuation dump (.dump or .sql) |
| `bootstrap/04-verify-restore.py` | 264-table row-count diff vs manifest |
| `smoke.sh` | cluster health check |
| `APP-INTEGRATION.md` | how the app / edge worker reach this DB |
| `RESTORE-REPORT-20260920.md` | live verification record |

## Operating

```bash
source infra/pigsty/bin/env.sh     # PGHOST/PGPORT/PGUSER + psql on PATH
infra/pigsty/bin/pg-status         # ctl status + isready
infra/pigsty/bin/pg-restart        # after conf changes
infra/pigsty/smoke.sh              # extensions, cron, storage, tables
psql -c 'select count(*) from storage.objects;'
```

All `bin/` scripts honour `PIGSTY_ROOT` (default `/home/z/my-project/pigsty`)
and `PGCLIENTBIN` (client tools tree) so the kit relocates to any host.

## Sandbox constraints that shaped this profile

- **No root**: server packages are extracted into a user tree with
  `dpkg-deb -x`, `initdb` runs against that tree's binaries.
- **No IPv4 localhost** (only `::1` resolves): pg_cron's libpq connect to
  `localhost` fails in this sandbox, so jobs run via
  `cron.use_background_workers = on` — no connection needed at all, which is
  also the lower-overhead mode in general.
- **~8 GB disk**: `max_wal_size 1GB`, aggressive autovacuum, `shared_buffers 512MB`.

## Production path (VPS)

1. Provision an Ubuntu/Debian VPS; run the real Pigsty distribution
   (pigsty.cc) or plain PG17 with `conf/pigsty-tuning.conf`.
2. `bootstrap/03-restore-supabase-backup.sh` the evacuation dump
   (`download/supabase-backup-20260920/full-snapshot-consistent.dump`).
3. Point the edge worker `DB_URL` at
   `postgres://postgres:<password>@<host>:5432/postgres` — direct connection,
   NOT a transaction pooler.
4. Client constants change only when an HTTP API layer fronts this DB —
   see `APP-INTEGRATION.md`.
