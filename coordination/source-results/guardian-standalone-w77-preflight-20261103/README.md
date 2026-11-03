# Standalone W77 package preflight with prelaunch HOLD

This source-only followup implements namespace preparation through the EXISTING W77 authority without a preinstalled Guardian, PostgreSQL or fixed installed Main location. It does not implement or authorize the first elevated launch. `GENESIS_ORIGINAL_PRELAUNCH_BINDING_UNPROVEN` remains unchanged and occurs before OS dispatch.

## Implemented production step

The private `GuardianActivePolicyPackage::captureOriginalCoordinator(original process, original primary token, original cancel, failure output)` derives only a candidate fixed package layout from the retained original coordinator's native image. There is no caller pathname, version, verifier, signature-success flag or new root input. The lexical path helper returns DATA only.

The factory reuses `GuardianInstalledNamespace::capture`, original file/ancestor/descendant handles, immutable ACL rules, Read oplocks, W77 signature binding and capsule/inventory verification. The policy determines the final exact versioned coordinator image. Installed-profile lookup is no longer required by either Genesis package capture path. A complete matching signed package is still required; user-writable ZIP extraction is still refused. No roots or files are created to make a candidate qualify.

The package retains duplicated original process/token/cancel objects, process birth/PID/image and token facts. Exit, replacement, token/owner changes, cancel or namespace drift cause sticky revocation. No process is reopened by PID. Borrowed cancellation outlives namespace destruction. A standalone namespace cannot be moved out separately: `releaseOriginalNamespace` refuses and revokes rather than splitting its original lifetime. Existing `captureFixed` behavior is preserved; its actual source body remains byte-identical.

The native build commands now include the same 16-source authority closure for outer coordinator and inner bootstrap, the SAME existing crypto build context/macros/archives, separate map/PE checks and output registration. The wrapper comment was corrected. These are source changes: Windows/PowerShell/MSVC link and real PE gate execution are NOT RUN.

## Exact remaining pre-effect gap

Supported Windows debugging can provide the needed image-open evidence in an ALREADY authorized creator: `DEBUG_ONLY_THIS_PROCESS | CREATE_SUSPENDED` and the original CREATE debug event supply an image file handle before initial user-mode execution; the creating thread owns the debug pump and continuations. This is the proposed next private creation-owner composition, not an implemented producer. [Debugging Events](https://learn.microsoft.com/en-us/windows/win32/debug/debugging-events), [creation flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags).

The current coordinator is asInvoker, and `GuardianOriginalInstallUser` deliberately refuses elevated tokens and retains identity/query rights, not an elevated creator grant. `CreateProcess` does not perform UAC elevation: AppInfo creates the elevated process after consent. No documented transfer of original debugger/thread ownership across `runas`/AppInfo has been established. A late process handle, PID attach, copied event or positive JSON cannot fill this gap. [UAC architecture](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/user-account-control/architecture).

A future clean-purpose native owner must consume the real existing install scope and retained W77 package, hold original process/thread/Job/debug objects, compare actual CREATE-event hFile identity with the retained signed leaf before continuation, and enforce a bootstrap-specific package/OS loader profile on actual DLL events. It must not reuse Main grant/barrier/recovery permissions, borrow caller-selected paths/tokens/events, add privileges or create another trust root. Initial breakpoint documentation does not establish every TLS/dynamic-loader phase; unsupported inputs must remain HOLD. The full supported composition and acceptance matrix are in genesis-preexecution-design.md.

The first original privileged issuer and qualified bootstrap loader profile are absent. This patch cannot make a protected staging directory or valid release producer exist on an empty PC. Existing protected W77 signer/sidecar and Windows qualification blockers remain. Namespace preflight authenticity is not loaded coordinator/startup code attestation, enrollment, Main permission, PostgreSQL provisioning or an upgrade grant.

## Adversarial and regression results

| Check | Final result |
| --- | --- |
| Actual extracted package State/factory/recheck/image/handoff model | 43 PASS; 17 source/build guards PASS |
| Real portable path DATA helper | 72 PASS; no native/signature authority claimed |
| Both above with ASan/UBSan | PASS |
| Actual prelaunch request model | 28 PASS; 11 guards PASS, also ASan/UBSan |
| Abstract historical early-effect controls | 8 effects retained despite false postchecks; current production dispatch/early effects 0 |
| Bootstrap regression group | 45 PASS, 0 FAIL, 2 Windows SKIP |
| Staged native package verification | 21 PASS |
| Original Main protocol and owner/enrollment | 17 PASS |
| BEGIN / owner wait / requester session models | 9 / 13 / 15 PASS, each normal and ASan/UBSan |
| Client source check | 292 PASS |
| Original Main source runner | 23 PASS, 0 FAIL, 5 NOT RUN |
| Original Main launch source guard | 81 PASS, unchanged expected FAIL wire_route_authenticates_then_launches |
| Exact integrated-base and full original patch-chain application | PASS |

Tests cover file/root identity swaps, modeled rename/reparse refusal, invalid signature/capsule boundary, token/cancel drift, early effects, consumed attempts, restored state and same-PID/new-birth restart. Namespace/W77/Win32 boundaries in the extracted-method models are explicit simulations. The abstract rename/reparse controls do not claim an NTFS bypass; real retained descendants provide ordinary rename restrictions. Actual Windows/NTFS/ACL/oplock/UAC/debug/loader behavior is NOT RUN.

The source runner's five named NOT RUN checks remain pinned OpenSSL 3.5.9 regression, pinned BoringSSL regression, patched Electron source interface, official Electron header syntax and Win64 cross-build. PowerShell execution, MSVC compile/link, real static PE/map checks, production release-positive/Main grant, full custom Electron, continuous loaded-code custody and LeakSanitizer are NOT RUN. Two bootstrap tests and one source subgroup test requiring Windows remain skipped. The existing Main FAIL is intentionally preserved; no grant or success flag replaced its HOLD. Exact commands/logs are in evidence/results.json.

## Baseline and application

Baseline is the locally reconstructed corrected #1434 tree `cc5ac21ed40e48d07c051c8019a83fb361e0e30e`. This is not a claim about the parent thread's original Git commit history. The original source archive remains SHA256 `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`, declared source c26565e and tree `2dbe253e97379532f6f4b52ef7edf26109a9266d`. No AGENTS.md or .agents/skills existed in that archive.

Incremental patch: `guardian-standalone-w77-preflight.patch`. SHA256 `3a10a7ebfbd89fc2c2604ed8098380f3116ee7ae62d36afeec0ace61237ff35a`. Result tree `810ef3b8a52d31ce43f843a067c7982b47a8c001`. It changes 11 files. Apply ONLY this delta if the corrected #1434 source is already integrated:

```sh
git apply --check guardian-standalone-w77-preflight.patch
git apply guardian-standalone-w77-preflight.patch
python3 apps/metaengine-browser/test/native/verify-guardian-original-package-capture-model.py
python3 apps/metaengine-browser/test/native/verify-guardian-original-package-capture-model.py --sanitize
python3 apps/metaengine-browser/test/native/verify-guardian-genesis-launch-binding-model.py
python3 apps/metaengine-browser/test/native/verify-guardian-genesis-launch-binding-model.py --sanitize
```

For reconstruction from the original c265 ZIP only, apply base/integrated-prelaunch-hold.patch (SHA256 `4ae48c040f9e6954aa8813c2b9120baffb5f99b0c63ae578cb96ac9889b8cd89`) first, confirm the corrected baseline tree, then apply this delta. Both steps were verified against separate Git indexes. The Library bundle includes the exact original base ZIP; public artifacts reference its already-published transfer commit without duplicating it.

No installer, services, UAC, machine policy, user database or installed client was run or changed. No new key/root, privilege, hosted fallback, effect retry or merge is introduced. Publication contains only this separate source-only patch/report/evidence result; common branches are not modified. No credentials or signed transfer URLs are included.
