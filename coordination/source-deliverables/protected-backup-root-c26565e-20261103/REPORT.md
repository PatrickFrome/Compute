# Read-only protected backup root selector with namespace HOLD

Original authority does not retain the Host-state or Supervisor identity-store parent namespaces during selector registration. The former path could persist REGISTERING and, after a final identity read, create a child through a replaced ancestor. Recovery-effect custody HOLD alone did not prevent that earlier selector mutation.

## Selector correction

The source selector is now read-only. The entire absent-registration creation branch, registration-ID generation and persistence import were removed. Missing registration throws `owned_protected_backup_root_original_parent_namespace_custody_required` before REGISTERING, mkdir or any other write. Actual opaque selector scopes hardcode `registration:null`; they cannot reach the retained identity writer, including through caller flags, copied scopes or extra records. Composition returns `{mounted:false,composition:null,reason:'original_parent_namespace_custody_required'}`.

An existing READY record may only be requalified by read-only observations. Tests seed such records explicitly as synthetic fixtures; the current selector cannot issue one. Existing REGISTERING, missing/replaced roots, malformed seals and identity changes remain HOLD without repair, rotation or recreation. Sealed transition/CAS tests exercise dormant algorithms under explicit mock issuers and do not establish a current production issuer.

The required original native interface must retain BOTH the Host-state parent/ancestors and the Supervisor identity-store parent/ancestors before the FIRST registration write. It must bind that custody to the existing original authority/lifetime, perform fixed-name exclusive child creation relative to the retained parent, return and retain the original new child atomically, and retain required objects through READY commit and all cleanup joins. `mkdir(path)` followed by `open(path)` leaves a further swap gap. No new authority, callback proof, trusted root or reported handle flag is introduced. Exact contract and consumer trace: `EFFECT_CUSTODY_REVIEW.md`.

## Recovery veto preserved

The recovery producer, standalone native adapter, retained service, shared directory-custody veto and recovery swap regression are byte-for-byte unchanged from the previous result tree. They still HOLD before source-pool allocation, backup files/journal or native controller construction. The retained service reports `HOLD / ORIGINAL_NATIVE_DIRECTORY_CUSTODY_REQUIRED`, null report, false proof/upgrade flags and no automatic retry. `patch-application.json` records unchanged blob IDs.

## Adversarial and regression evidence

The selector fixture uses real isolated directory objects and native identity reads, then replaces the state ancestor or aliases it into retained PGDATA immediately after the last physical observations preceding the old registration/create branch. The actual selector reaches namespace HOLD with ZERO filesystem, sealed-state or DACL write attempts; original and replacement trees remain object/content identical after the fixture's own swap. A separate real opaque-scope regression proves zero encrypt/decrypt/ensure/persistence calls and byte-identical identity storage.

45 selector tests and 16 sealed-scope tests are included in the combined 572 PASS / 0 FAIL / 0 SKIP result; 299 source checks PASS. The unchanged 11-test recovery-effect swap suite also passes. Full commands and logs are in `validation.json` and `focused-tests.log`. No native directory custody or actual backup/restore is claimed.

## Source and patch application

The verified c26565e source archive remains in PatrickFrome/Compute, `work/source-transfer-c26565e-20261103`, exact commit `accb28e72c87c059e780efb8e6681886b33e9b4f`. Concatenate `archive.part00`, `archive.part01`, `archive.part02` under `coordination/source-transfer/c26565e`. Verified SHA256: `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`.

- `protected-backup-root-provider.patch` is the updated cumulative patch for base tree `2dbe253e97379532f6f4b52ef7edf26109a9266d` (source revision c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6).
- `selector-parent-namespace-hold.patch` is the latest delta for the previous #1438 result tree `0139c9fd5d5d04558dbb57bbf08c9cd047062822`.
- `directory-custody-hold.patch` is retained unchanged as the historical delta from tree `b6c5977b519c9332158af1d5b7de295fa452c1e6` to `0139c9fd5d5d04558dbb57bbf08c9cd047062822`; apply the latest selector delta after it if starting there.

Do not apply the cumulative patch on top of another patch. Both current cumulative and latest-delta check/apply routes were independently verified and produce tree `cf8cbe232fef42c5ebf6c76316544e9e1cbe743b`. Exact hashes and unchanged recovery blobs are in `source-base.json` and `patch-application.json`. The prior cumulative SHA256 89dd8893ac98174e37c0dc5334e6b3648856078476e64c9e263b0ba642d55636 is superseded. These patches target the reconstructed source snapshot, not the public repository's older default-branch source.

## Remaining blockers and preservation

Both original parent-namespace creation custody and original recovery-directory effect custody are missing, so fresh registration and recovery effects remain disabled. The production Host recovery service is still unmounted. Package verification remains blocked by absent postgres@3.4.7 (previous fixture attempt: 1 pass, 18 setup failures); dependencies were not installed. Native Windows/Guardian and PostgreSQL integration were not run. Source-closure checks do not establish package behavior or native custody.

No real database, user identity/key/trust root, DACL or installed profile was changed. No common branch was modified, no merge or installation was performed, and no installation/upgrade readiness is claimed. Public artifacts are saved in draft PR #1438 and locally. Earlier Space writeback hit two automatic-permission-review timeouts; no further Space write was attempted for this correction.
