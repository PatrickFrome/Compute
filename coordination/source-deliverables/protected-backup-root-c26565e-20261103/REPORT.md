# Protected backup root provider source patch

The standing protected root selector is implemented within the existing owned Host and Supervisor authority. Main now passes its genuine sealed selector into the original W74/W76 recovery provider, which rechecks it before Owner binding and each root observation.

The destination is a fixed child of the original Host private state. Its canonical native parent, PGDATA and root identities and client/device/key binding are sealed in the existing encrypted identity store. REGISTERING is durable before exclusive directory creation; READY is immutable. Missing/replaced roots, interrupted registration, stale generations and uncertain persistence fail closed. Existing contents are retained. The provider performs no DACL mutation, database connection, migration, backup/restore, update installation, key initialization or trust-root replacement.

## Base and application

The source archive is already published in PatrickFrome/Compute, branch `work/source-transfer-c26565e-20261103`, exact commit `accb28e72c87c059e780efb8e6681886b33e9b4f`. Concatenate `archive.part00`, `archive.part01`, `archive.part02` under `coordination/source-transfer/c26565e` in that order. SHA256 is `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`.

Extract into a separate directory and preserve executable modes. The source revision is `c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6`; verified tree is `2dbe253e97379532f6f4b52ef7edf26109a9266d`. Do not apply the previous four patches over this updated snapshot. This patch targets that tree, not the public repository's older default-branch source.

From the extracted source root, use `git apply --check <path>/protected-backup-root-provider.patch`, then `git apply <path>/protected-backup-root-provider.patch`. Fresh-archive application was verified; resulting tree is `b6c5977b519c9332158af1d5b7de295fa452c1e6`. Exact source and patch hashes are in `source-base.json`; application evidence is in `patch-application.json`.

## Validation

404 focused tests PASS, zero failures or skips; 295 source syntax checks PASS. The suite includes negative original-authority checks, real temporary native directory identities, existing encrypted identity persistence using synthetic storage, canonical identity preservation, restart/UNKNOWN fences, cancellation/drain, original root-to-Main integration and existing W74/W76/producer/gate/deadline regressions. Positive Windows/Guardian authority boundaries are explicit test doubles, not installed-runtime evidence.

Full commands and counts are in `validation.json`, with logs alongside it. Static source closure resolves all source inputs and includes the provider in Host/replacement modes (268/269 files; provider closure 67).

## Remaining blockers

- Package suite: 1 PASS, 18 setup failures due to missing `infra/client-state-runtime/node_modules/postgres/` (`postgres@3.4.7`). Dependencies were not installed because installation is forbidden. Full package behavior remains unverified.
- Native Windows ACL/Guardian and PostgreSQL integration qualification: NOT RUN in Linux source-only environment. No real database was accessed or changed.
- Production Host recovery service still requires its separate `hooks.createRecoveryService` mount; this patch does not supply that service or a new recovery command.
- Path observations do not establish a native directory-handle lease. Physical operation retention and source freshness remain the existing producer's responsibility.

No installation or upgrade readiness is claimed. No common branch was modified, no merge was performed, and no secrets or signed transfer URLs are included. The earlier Library network blocker was resolved for this task by the separately authorized Git source transfer. Repository instructions check found no AGENTS.md or .agents/skills in the snapshot.
