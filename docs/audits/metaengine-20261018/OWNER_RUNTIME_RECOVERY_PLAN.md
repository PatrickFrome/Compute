# Owner / installed offline runtime incident — 2026-10-18

Scope: the local Windows QA client, **not** an approved production release.

## Read-only physical reproduction

- Installed QA package: `0.7.0-dev.1107139874568.1`, source `b4caa18c1a1e255dd8ae43a1825692989e97c74a`.
- Installed `resources/app.asar` bytes were identical to the local `dist-test/win-unpacked/resources/app.asar` candidate.
- Protected installed ASAR and runtime manifest pin `a9becd9d764d743080ca24b7eaa319e88f505c63254e20572b5f340131446392`.
- Existing protected Owner descriptor (created before the new package) pins `8e72494a924d4cc271f2b8861914a278cc2eb42f69ff5e88c4a3ba7cad8c4df5`.
- Runtime path still points to the installed resources, but the digest does not match.
- The installed EXE and QA installer report Windows Authenticode status `NotSigned`. Neither an executable digest nor a local build log is a production authorization proof.
- The previous QA installer ran NSIS before checking the Owner pin; both Electron dialogs were produced at normal runtime bootstrap. The targeted source fix in PR #1317 differentiates that refusal and prevents the duplicate uncaught dialog.

## This source increment

`scripts/owner-runtime-preinstall-compatibility.mjs` performs read-only source/resource checks against a staged candidate. It verifies the full offline runtime inventory using the existing protected ASAR verifier before examining the existing Owner pin. Only exact Owner-runtime digest and destination path equality permit QA installer continuation. It does not modify any protected profile, database or service.

`scripts/bootstrap-install-and-launch.ps1` refuses an existing Owner unless the caller supplies an independently staged candidate resources directory for that exact prospective package. A missing, unverified, malformed, foreign or stale pin fails before invoking `install-package-bounded.ps1`. This is a **QA pre-install compatibility fence**, not a signed installer-to-staging correspondence receipt, and it does not change the interactive NSIS installer.

Read-only physical check of the current broken installation using these new source bytes returned `state:BLOCKED`, `reason:owner_runtime_digest_mismatch`, exit 3, installer_effect_attempted=false and owner_mutated=false. Unit and fixture tests are independently recorded.

## Unresolved recovery requirements

Do not copy a new SHA into the old profile or remove its data. To repair the *already installed* client:

1. Obtain genuine immutable source-to-release builder provenance and trusted Authenticode/Ed25519 installation readback. Current local unsigned QA artifacts cannot satisfy the required production proof.
2. Define an existing-authority-bound, explicit owner-approved upgrade transaction, not a second enrollment or root. It must verify native Owner and Guardian device/project/epoch, current PostgreSQL postmaster incarnation and lease status and ensure no active ambiguous effect.
3. Preserve and hash the exact protected Owner/config/runtime prior bytes; verify DACL, link/reparse/physical identities and keep a protected restorable backup.
4. Verify the exact new installed runtime bundle/manifest/verifier against the reviewed release, with a precondition on the old digest and expected source/epoch. Use atomic compare-and-swap write with readback and rollback on failure; never silently rebind via renderer or process environment.
5. After reopening the Browser, require a new canonical authenticated Host/Guardian/PG17 attestation and independent useful-work continuation proof.

If any gate is UNKNOWN, preserve the original Owner and block promotion/automatic retry. No installed process or Owner file was changed by this source increment.