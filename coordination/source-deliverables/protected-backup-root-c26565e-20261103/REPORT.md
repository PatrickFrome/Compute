# Protected backup root selector with mandatory recovery HOLD

The selected backup/restore consumer has no retained original kernel handles for backup/PGDATA directories or their mutable ancestry. Path, native identity and ACL observations can succeed before a subsequent swap. The sealed selector alone therefore cannot admit any recovery effect.

## Correction and exact boundary

`native-coding-recovery-directory-custody.mjs` supplies a fixed refusal only: `requireOriginalRecoveryDirectoryCustody()` always throws the privately registered `native_recovery_original_directory_custody_required`. There is no positive issuer, boolean, callback, supplied handle or alternate authority.

The actual producer calls it after an original root observation and before source-pool allocation, work-directory/file creation, journal publication or native launch. The standalone native adapter also refuses before process-controller construction. The retained service reports `HOLD / ORIGINAL_NATIVE_DIRECTORY_CUSTODY_REQUIRED`, a null report and false proof/upgrade flags. An effect-free refusal may drain successfully without pretending physical completion is UNKNOWN. One-shot admission and no automatic retry remain enforced.

The required native interface is detailed in `EFFECT_CUSTODY_REVIEW.md`: handles for exact selected objects and necessary ancestry; canonical identity measured from those handles; binding to the original authenticated job/Owner/Host/deadline; actual fixed operations under those held objects; retention through cancellation, child/SQL/effect joins and terminal HOLD on lost custody. Guardian installed-package handles and process Job custody cannot substitute. That native interface is NOT implemented here. Production recovery effects remain disabled pending it.

## Adversarial evidence

The new 11-test suite runs the real Host root provider, producer and fixed refusal. Synthetic native phase registries return a captured final observation after replacing actual temporary backup/state/PGDATA directories or aliasing root to PGDATA. The reader can still return the old observed digest; the fixed veto then refuses before any owned source pool, backup mutation or native creator. Original and replacement trees remain object/content identical after the fixture swap. Unswapped valid observations also HOLD; one-shot refusal, pending-read drain and the standalone adapter are covered.

Existing algorithm fixtures explicitly substitute the missing veto only in unique synthetic query modules. An isolation regression confirms that production imports still refuse. Those fixtures do not qualify native directory custody or production reachability.

## Source and patches

The verified source-only archive is published at PatrickFrome/Compute, source-transfer branch `work/source-transfer-c26565e-20261103`, exact commit `accb28e72c87c059e780efb8e6681886b33e9b4f`. Concatenate `archive.part00`, `archive.part01`, `archive.part02` under `coordination/source-transfer/c26565e`. Verified archive SHA256: `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`.

- `protected-backup-root-provider.patch` is cumulative against source c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6, verified tree `2dbe253e97379532f6f4b52ef7edf26109a9266d`. It includes the sealed original selector and the mandatory custody HOLD.
- `directory-custody-hold.patch` is the incremental correction against the earlier #1438 result tree `b6c5977b519c9332158af1d5b7de295fa452c1e6`. Apply it only to that prior result; do not apply both patches to the same base.

Both check/apply routes were verified independently and produce tree `0139c9fd5d5d04558dbb57bbf08c9cd047062822`. Exact hashes are in `source-base.json`; evidence is in `patch-application.json`. The prior cumulative patch SHA256 62c23c0fe581766bb319ddafc46effe2db503b10476445a655965726807e6640 is superseded. Neither patch targets the public repository's older default-branch source.

The sealed selector retains canonical client/device/key and state/source/root identity in existing encrypted Supervisor storage. Interrupted registration, replacement or uncertain persistence fails closed; key/Owner bytes and existing backup contents are preserved. The selector still grants no backup/restore permission. No DACL, database, key/trust root or installed profile was changed.

## Validation and remaining blockers

576 focused tests PASS, zero failures/skips; 299 source checks PASS. Full commands/results are in `validation.json` and logs. Independent static closure resolves all 152 recovery-consumer source dependencies including the fixed veto. Default Host/replacement closures remain 268/269 files because the separate production recovery service is unmounted; this correction does not add that mount.

Package verification remains blocked by absent `postgres@3.4.7` (previous package attempt: 1 pass, 18 fixture setup failures). Installation is prohibited and was not performed. Native Windows/Guardian and PostgreSQL integration were not run. No native directory lease, physical restore or installation/upgrade readiness is claimed. No actual backup/restore operation was executed.

Results are saved as public patch/report artifacts in draft PR #1438 and locally. Earlier Space writeback hit two automatic-permission-review timeouts; no further Space write was attempted for this correction. No common branch was modified and no merge was performed.
