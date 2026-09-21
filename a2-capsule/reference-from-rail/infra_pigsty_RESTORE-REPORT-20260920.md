# Restore report — 2026-09-20 (Pigsty rootless PG17)

Source: user-supplied Supabase backup (`uploaded.backup`, 207 MB raw /
217 MB cleaned SQL) taken AFTER the snapshot-consistent evacuation dump
(`download/supabase-backup-20260920/full-snapshot-consistent.dump`).
Target: `/home/z/my-project/pigsty/rootless/PGDATA` (PG 17.11, port 55432).

## Row-count verification (vs row-count-manifest-snapshot.json, 264 tables)

- **256 exact matches, 0 losses.**
- 8 tables drifted forward (restored backup is newer — live writes ran until
  13:38 UTC; manifest snapshot was taken ~13:00 UTC):

| table | manifest | restored | note |
|---|---|---|---|
| cron.job_run_details | 427939 | 429152 | local retry runs keep adding rows |
| destruktion_meta.compute_fabric_cat_reconciliation_receipt_h205f22 | 43789 | 43810 | +21 live writes |
| destruktion_meta.compute_federation_supervisor_sweep_h205f22 | 269372 | 269490 | +118 live writes |
| destruktion_meta.devos_fleet_claim_h205f22 | 168 | 171 | +3 |
| destruktion_meta.devos_fleet_event_h205f22 | 2418 | 2430 | +12 |
| destruktion_meta.devos_fleet_task_h205f22 | 883 | 886 | +3 |
| public.compute_fabric_a2_browser_device_enrollment_request_h205f22 | 3146 | 3150 | +4 |
| public.compute_fabric_a2_browser_device_nonce_h205f22 | 953 | 886 | -67 expired nonces purged |

## Object-level checks

- `storage.objects` = 1831/1831 (byte-exact object set also exported to the
  evacuation kit under `storage-objects/`)
- `auth.users` = 1/1
- 16 Supabase roles restored (anon, authenticated, authenticator, service_role,
  supabase_* admins, dashboard_user, a2_peer_runtime, ...)
- `supabase_realtime` publication present; `wal_level=logical` active

## Restore errors (all cosmetic, resolved)

1. `pgmq.create_partitioned(text,text,text)` / `pgmq.pop(text)` — REVOKE ACLs
   reference pre-1.5 signatures; rebound via bootstrap/03 step 4b.
2. `wal_level is insufficient to publish logical changes` warning on
   `CREATE PUBLICATION` — fixed by `ALTER SYSTEM SET wal_level='logical'` +
   restart.

## pg_cron incident + fix

Jobs failed with `connection failed` for ~100 minutes: the sandbox resolves
`localhost` only to `::1` and pg_cron's libpq connect could not establish the
session. Fix (now canonical in `conf/pigsty-tuning.conf`):
`cron.use_background_workers = on` — jobs run as background workers with zero
connection overhead. All 5 fabric jobs (supervisor sweep 10s, watchdog 30s,
attestation 1m, cat-trust 1m, baseline sync 2m) succeed since 16:12:10 UTC.
