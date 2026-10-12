# Installed Owner pre-upgrade backup integrity gate

Before retiring the old METAENGINE Browser Owner for an installed upgrade, the operator must hold a fresh, verified logical PostgreSQL backup of the *current* Keeper. The gate in `upgrade-backup-gate.mjs` is **read-only**; it never invokes `pg_dump`, reconnects to PostgreSQL, starts a Browser, installs a package, or clears a wake.

## Contract

`verifyInstalledUpgradeBackup({receipt,archivePath,tocReadback,expected})` checks:
- an existing one-shot receipt marked PASSED, with no installer started and no database mutation;
- exact pinned incumbent Owner PID/config SHA-256, Keeper PID/postmaster SHA-256;
- the absolute expected private backup directory and fixed `postgresql-17-snapshot.dump` filename;
- a regular non-symlink archive with consistent size, SHA-256 and PGDMP signature;
- TOC supplied **independently** by a separate `pg_restore --list` run, pinned to the receipt hash and entry count;
- explicit no-automatic-retry and owner-only storage claims in the receipt.

The result is always `upgrade_authorized:false`, even when `backup_verified:true`. Positive archive integrity is only one prerequisite, not evidence of a successful restoration or authority to upgrade. Additional live process-incarnation fencing, journal snapshot, quiescent maintenance, protection of the old Owner, independent restore/verification and rollback proof are separate mandatory gates.

## Current .59 to .61 incident

On 2026-10-12 the attempted live backup failed closed. The only produced archive is 0 bytes; no PASSED receipt exists. The backup outcome was generically `backup_stage_unconfirmed`: it does **not** prove which PostgreSQL error occurred. Neither the earlier isolated .61 physical Owner PASS nor `pg_isready` is proof of a successful live backup. Do not rerun the original one-shot script, reuse its destination, assume credentials worked, or install .61 while the gate remains blocked.

For this incident, the ignored local read-only consumer is `.audit-local/qualify-local61-preupgrade-backup-readonly.mjs`. It terminates before opening any archive if the PASS receipt is absent. Its output is intentionally limited to status/error categories and never prints credentials, SQL rows, TOC, or profile internals.

Use `node --test infra/client-state-runtime/upgrade-backup-gate.test.mjs` for synthetic tests. Symlink creation may be unavailable to a non-elevated Windows account; that case is marked SKIP, not PASS.

There is no demonstrated real agent goal -> claim -> ChatGPT result -> independent critic -> checkpoint cycle yet. A verified backup permits investigation of the installed Owner upgrade but is not evidence of continuous autonomous development.
