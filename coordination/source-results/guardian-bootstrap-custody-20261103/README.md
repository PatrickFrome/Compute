# METAENGINE Windows bootstrap custody

Source-only security patch against the verified c26565e snapshot. A clean Windows installation without Guardian and PostgreSQL remains HOLD. The change closes an unsafe JavaScript launch route and binds the native genesis window handoff to the actual returned bootstrap process in the same existing signed package. It does not establish final NSIS installer authority or installation readiness.

## Verified source base

Repository: PatrickFrome/Compute. Transfer commit: `accb28e72c87c059e780efb8e6681886b33e9b4f`, branch `work/source-transfer-c26565e-20261103`. Concatenated archive.part00, archive.part01, archive.part02 in that order. SHA256: `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`.

Declared source commit: `c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6`. The extracted tracked tree independently matches `2dbe253e97379532f6f4b52ef7edf26109a9266d`. No previous incremental patches were applied. The archive contains no AGENTS.md or .agents/skills instructions. Local Git history was reconstructed solely to verify the tree and generate the delta; it is not the original history.

Patch: `guardian-bootstrap-custody-c265.patch`. SHA256: `35227f6d03637c4a3c759fd4f8a00c9cab37fecb6eeeeb50a9e8cfadc8c9917f`. Patched tree: `c90b4494cf3cae6a6a90d5b1e2821a0e6a8ad864`. Applying the patch to a separate index of the verified base passed and produced that exact patched tree. Seven changed files are listed in source-base.json.

## Changes and evidence

The JavaScript launcher previously hashed a bootstrap file, awaited service observation, then passed a mutable pathname to openPath. An inert regression rewrites the file with the same size during observation. Before the fix it reached one launch callback; after the fix it reaches zero. No installer process was started in either test. Logs: evidence/bootstrap-tamper-before.log and evidence/bootstrap-tamper-after.log.

The missing-service activation now returns `HOLD / GUARDIAN_BOOTSTRAP_NATIVE_CUSTODY_REQUIRED`, `uac_launch_requested=false`, `original_file_launch_binding_proven=false`, and `physical_effect_outcome=NOT_ATTEMPTED`. The path callback, launch timer and post-launch polling were removed. Main no longer passes shell.openPath. Digest/size observation, fabricated JSON and repeated or concurrent calls cannot provide native custody or cause a launch. Existing read-only status and existing-owner bridge behavior are preserved.

The native install-origin coordinator retains the actual ShellExecuteExW hProcess immediately. A new private Genesis predicate checks that original live handle against the fixed versioned bootstrap entry in the SAME retained W77 package. It requires generation 1, existing package.originalImageExact and package/lifetime fences before connecting and again before handing over the scoped window. The elevated bootstrap's independent signed-image check remains. No public path factory, verifier callback, new key, root or enrollment/Main permission was added. This post-creation check gates the window handoff; it is not proof that no code ran before the check or that all loaded code remains in custody.

## Final checks

Exact commands, working directories, exit codes and logs are in evidence/final/results.json. The final source runner records the reconstructed base HEAD and the explicit modified working-tree paths.

| Check | Result |
| --- | --- |
| Bootstrap regression group | 45 PASS, 0 FAIL, 2 Windows SKIP |
| Launcher tests within that group | 19 PASS |
| Actual-source Genesis predicate model | 21 synthetic cases and 10 source/order guards PASS |
| Same Genesis model with ASan and UBSan | PASS; leak sanitizer NOT RUN |
| Original Main launch source guard | 81 PASS, 1 expected FAIL: wire_route_authenticates_then_launches |
| BEGIN model, normal and ASan/UBSan | 9 PASS each |
| Owner wait model, normal and ASan/UBSan | 13 PASS each |
| Requester session model, normal and ASan/UBSan | 15 PASS each |
| Original Main protocol and loaded-owner/enrollment group | 17 PASS |
| Client check-source | 292 PASS |
| Original Main source verification | 23 PASS, 0 FAIL, 5 NOT RUN |
| Patch whitespace and exact-base applicability | PASS |

The existing Main FAIL is present before and after this patch; the route intentionally remains HOLD without an authenticated grant. It was not hidden or converted into a positive claim.

The source runner's five named NOT RUN checks are w77-pinned-openssl-regression (pinned 3.5.9 static source/build absent), w77-boringssl-regression (exact pinned static build absent), electron-source-interface (exact patched sources absent), official-electron-header-syntax (verified headers absent), and win64-cross-builds (compiler absent). The two bootstrap skips require actual Windows original-origin pipe and original-user kernel custody. The source-regression subgroup also skips actual original pipe/process references and SCM readback. Windows compilation/linking, actual UAC/process/pipe/Job/WTS/ACL/filesystem behavior, full custom Electron build, production release-positive inputs, production Main grant and continuous loaded-code custody are NOT RUN. Synthetic positives do not qualify them.

## Remaining blockers and required original interface

1. scripts/release-proof-producer-w77.mjs:369–399 explicitly reports BLOCKED: the existing protected release-root signer is not connected, authenticated NSIS sidecar placement is unproven, and the immutable artifact handoff is not runtime-qualified. Existing signature validation remains mandatory; deferred installer Authenticode does not disable it.
2. GuardianActivePolicyGenesis::qualifyOriginalCoordinator still captures Location::Installed. The fixed LocalAppData package must already exist and pass bindRetainedReleaseSignature. This is not a pre-install producer for an empty PC. Genesis authorizes only initial policy; it cannot become enrollment, Main, PostgreSQL provisioning or upgrade authority.
3. The minimal next native interface must privately consume the genuine existing signed release/package scope, select the final installer by its signed installer_sha256 and fixed purpose, and retain original file plus ancestor/security/FILE_ID/oplock custody through the launch effect and original process/Job handoff. Existing upgrade-only GuardianInstallerCustody mechanics provide a pattern, not a clean-install grant. No caller hash, bool, path, PID or JSON can mint this scope. The missing original producer is not fabricated in this patch, so JS launch stays HOLD.
4. scripts/install-package-bounded.ps1:14–20 closes its hash stream before CreateProcess at 79–82 and accepts a caller digest. This separate explicit QA installation helper is not a production authority bridge and has not been invoked or qualified here.
5. First-owner enrollment/local bridge, trusted pre-Main producer, single-instance handoff, absent PostgreSQL provisioning and a distinct data-preserving upgrade path remain unresolved. Existing-root refusal and uncertain-effect/no-retry rules remain unchanged. No installer was launched and no installed client, service, user database or machine policy was modified.

## Apply and review

Obtain the three source-transfer parts from the exact transfer commit, concatenate them, verify the archive SHA256 and extract Compute in isolation. Confirm the base tree before applying this patch. Do not apply the old e6-to-c265 patches again.

```sh
git apply --check guardian-bootstrap-custody-c265.patch
git apply guardian-bootstrap-custody-c265.patch
node --test apps/metaengine-browser/test/browser-guardian-machine-bootstrap-launcher.test.mjs
python3 apps/metaengine-browser/test/native/verify-guardian-genesis-launch-binding-model.py
python3 apps/metaengine-browser/test/native/verify-guardian-genesis-launch-binding-model.py --sanitize
```

Publication contains patch/report/test evidence only in an independent branch. It does not merge or install the change. No signed download URLs, credentials, private keys or completion tokens are included.
