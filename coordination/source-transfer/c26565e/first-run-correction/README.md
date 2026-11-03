# Correction to Guardian first run PR 1437

The review finding is valid. The previous terminal-journal parser authenticated neither the original writer nor native installation completion. This correction removes its accepting path entirely and adds explicit cancellation before status-read quiescence.

## Scope and threat boundary

The fresh writer calls `protectOwnerOnlyWindowsDirectory` and `secureAttachedPrivateFile`. The latter sets the current SID as Owner and grants it Read,Write,ReadPermissions,Delete; SYSTEM gets FullControl. The parent root grants current SID/SYSTEM/Administrators inheritable FullControl. These are storage access restrictions, not executable identity or completion authentication. An ordinary process with the current SID can rewrite or replace the journal after the original installer exits. See [Microsoft's DACL access check description](https://learn.microsoft.com/en-us/windows/win32/secauthz/how-dacls-control-access-to-an-object).

The old record consisted only of unsigned public observations, public JWK/fingerprint and matching fields. Canonical JSON, file identity/stability and even the intended DACL cannot establish the producer. Adding an ACL check would not close this gap.

Recognized raw `METAENGINE/client-first-run-v1` claims now always HOLD before Host startup. The guard has no imports or file/ACL/native/DB acquisition and no terminal-success or caller override path. This deliberately holds even an apparently completed existing fresh layout until genuine native completion authority exists; files are preserved without repair or retry.

**Remaining limitation:** the public Owner descriptor itself is mutable by the same SID. Relabeling its paths can evade this scoped classification. A second mutable root/journal existence marker cannot authenticate that descriptor and can break unrelated attached/upgrade paths. Those paths retain their existing admission; this patch does not qualify them against descriptor relabeling. Genuine native descriptor-and-completion binding is absent, so first-owner enrollment and ORIGINAL Main remain HOLD.

## Status cancellation and physical completion

Main forwards the observer's own AbortSignal through `statusLoaded`, the launcher, actuator and fixed owner-read pipe. Quiesce invalidates the original generation, pauses further reads through activation, requests abort synchronously and awaits the same original source promise. That pipe promise settles only after the original socket `close` event. Abort, destroy, EOF, a response, diagnostic timeout or a premature record is not a join.

If `close` never arrives or a source ignores cancellation forever, quiesce remains pending and paused. No successful cleanup or activation is inferred. A validated activation result can resume observations only after that join. Tests use the actual production JS composition with synthetic sockets; actual Windows pipe/kernel cleanup remains NOT RUN.

## Apply exactly one patch

| Artifact | Required clean base tree | SHA256 |
| --- | --- | --- |
| [Separate correction after PR 1437](guardian-first-run-correction-after-1437.patch) | `2e00ee9976fcc939ee3021bf2cde31eccbb50f08` | `551ad7942a0064717448a3e7ef1ce3efffeea88e98c9f364fe51c26ff9a9dc28` |
| [Cumulative patch from c26565e](guardian-first-run-cumulative-c26565e.patch) | `2dbe253e97379532f6f4b52ef7edf26109a9266d` | `7af203d6dd6d785384928f5f4e555fb32a95d511f0c5a59368503c63c5f305ce` |

Both independent clean-base apply/index checks reproduce result tree `c5c432b8973bbf4d0e618b19ac433a2bea6479d4`. Final local reconstructed verification commit: `59ccb6cb33a94583bc515ff508dc3bdc30b1b2ab`. It is not original Git history.

Run `git apply --check /path/to/chosen.patch`, then `git apply --index /path/to/chosen.patch` from the corresponding clean Compute root. [Applicability evidence](patch-apply-evidence.json) retains exact base/result hashes. Do not apply both versions.

Original source archive: [immutable three-part transfer](https://github.com/PatrickFrome/Compute/tree/accb28e72c87c059e780efb8e6681886b33e9b4f/coordination/source-transfer/c26565e), SHA256 `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`. The saved Library bundle also contains that unchanged archive in `base/source-c26565e.zip`.

## Final verification

| Check | Result |
| --- | --- |
| JS/portable contracts including adversarial journal and cancellation suites | 120 PASS, 0 FAIL, 2 SKIP |
| Source checks | 294 PASS |
| BEGIN model, normal and ASAN/UBSAN | 9 PASS each |
| Owner-wait model, normal and ASAN/UBSAN | 13 PASS each |
| Requester-session model, normal and ASAN/UBSAN | 15 PASS each |
| Launch source | 81 PASS, 1 existing FAIL |
| Aggregate source | 23 PASS, 0 FAIL, 5 NOT RUN |
| Both independent clean-base patch checks and result trees | PASS |

The two skipped JS tests require actual Win32 ACL protection/readback. The five aggregate NOT RUN checks require pinned OpenSSL, pinned BoringSSL, exact Electron/Node source, official Electron/patched headers and Win64 compiler inputs. Its nested Node suite also skips real Windows pipe/process mechanics. Windows runtime, full custom Electron build, production launch grant/release positive/W77 qualification and LeakSanitizer remain NOT RUN.

The unchanged launch failure is `wire_route_authenticates_then_launches`; the genuine authenticated sender composition remains absent. No route or test was weakened to make it green.

Journal adversarial tests include a canonical record with a valid public EC key and matching fingerprint, replay/cross-device copies, atomic replacement, truncation/rewrite through an original open handle, raw path normalization, zero Host/health calls and preserved bytes. No handmade JSON is used as positive completion proof. Status tests include abort before queued dispatch, before/after connection, after complete response, diagnostic timeout, missing close, late READY, premature record, and the exact Main activation wait ordering.

[Machine-readable result](result.json), [updated authority review](authority-review.md) and exact command/log evidence are included. All final commands ran against the clean final commit above. No installation, real Browser/Guardian/service/OS pipe, production DB, production credential, new trust root, security weakening or merge was performed. Existing isolated signing fixtures create only temporary test keys; none are saved in the results.

