# METAENGINE Windows EXE source verification

2026-11-03. Status: **SOURCE FIXES VERIFIED; WINDOWS BUILD AND RELEASE HOLD**. No Windows EXE was produced or installed. No dependency installation, user database/service changes, release publication, merge, new trust root or weakened admission check occurred.

## Verified source and applicable patch

The earlier Library transfer blocker was resolved through the newly authorized public Git channel. Exact transfer commit: `accb28e72c87c059e780efb8e6681886b33e9b4f`, branch `work/source-transfer-c26565e-20261103`, repository `PatrickFrome/Compute`. Concatenating `coordination/source-transfer/c26565e/archive.part00`, `archive.part01`, `archive.part02` produced SHA256 `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`.

The extracted `Compute/` tree exactly matched `2dbe253e97379532f6f4b52ef7edf26109a9266d`, source revision `c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6`. The old four patches were not reapplied. `AGENTS.md` and `.agents/skills` are absent from this snapshot. A local reconstructed Git base was created only to verify the tree and generate the diff; it does not establish the original commit history.

Patch: `metaengine-windows-exe-source-fixes-c26565e.patch`.

SHA256: `64409efbb80fb1134c1b4279202a21d3bb8a41e49998ffcd7dc53f0ab6eaec4a`.

The patch touches 16 source/test/documentation files. It passed `git apply --check`, was applied to a separate clean worktree of the verified base, and produced exactly the same final tree as the edited source: `219e5e2b468154fd3e6a1c1f34c8cdea81d5628f`. Both whitespace checks passed.

From the extracted `Compute/` directory:

```sh
git apply --check /path/to/metaengine-windows-exe-source-fixes-c26565e.patch
git apply /path/to/metaengine-windows-exe-source-fixes-c26565e.patch
```

This public review contains patch/report/evidence artifacts. The repository root of the transfer branch differs from the archived source; the patch must be applied to the verified archived tree above.

## Changes

- Selected pinned custom Electron 44.9.3 in `electron-builder.test.json`. Integrated the existing byte gate before tool staging, after packaging and during final executable readback. Stock, missing and stale runtime distributions fail closed. Byte receipts remain nonauthoritative build evidence.
- Fixed the custom source builder's duplicated `electron/` interface-patch path. Preserved locked upstream origins while recording observed patched checkout heads separately. Normalized the authenticated OpenSSL receipt into the package gate's existing `version` contract. Existing source lineage, postimage and signature checks remain required.
- Made bootstrap proof/launch logs use a validated temporary-directory fallback when CI-only `RUNNER_TEMP` is absent.
- Made Vault ACL setup and owned PostgreSQL process inventory use the existing fixed Windows OS rail and narrow environment. Disabled PowerShell module discovery, explicitly loaded OS CIM/Utility modules for process inventory, passed PID as data and closed unused stdin. Vault/key semantics and PID/PGDATA/port/incarnation checks remain intact.
- Added negative packaging/hook integration, Python-to-real-JS-gate, original-vs-fixed configuration and relocated-source import regressions. Updated stale integration documentation.

## Validation

These are distinct command groups; counts overlap and must not be summed into one suite. Raw available logs and exact commands are in `test-evidence.tar.gz`. `autoconfig-runtime-verification.json` explicitly identifies earlier command results for which raw output was not retained.

| Check | Result |
| --- | --- |
| Final Browser `node scripts/check-source.mjs` | 292 PASS |
| Original-main launch static source | 81 PASS, 1 expected FAIL: `wire_route_authenticates_then_launches`; real route remains HOLD |
| BEGIN model, normal and ASAN/UBSAN | 9 PASS each |
| Owner wait model, normal and ASAN/UBSAN | 13 PASS each |
| Requester session model, normal and ASAN/UBSAN | 15 PASS each |
| Required three Node protocol/owner/enrollment files | 17 PASS |
| Original-main source verifier | 23 PASS, 0 FAIL, 5 NOT RUN |
| Custom source-builder models | 16 PASS |
| Independent packaging gate/materialization/lock/payload group | 150 PASS |
| Packaging/native/bootstrap group | 51 PASS, 12 Windows-only skips |
| Offline runtime model group | 34 PASS, 3 Windows-only skips |
| Runtime focused group | 61 PASS, 4 Windows-only skips |
| Source closure focused group | 7 PASS |
| Browser provider/Guardian focused group | 69 PASS |
| Two new configuration regressions | Original source: 2 FAIL; patched source: 2 PASS |
| Standalone relocated source import | 1 PASS; no startup or database effect |
| Full runtime package/startup group | 28 PASS, 19 FAIL, 4 skips; failures reach absent locked `node_modules/postgres` package/directory |
| ASAR binding file | Blocked import: absent `@electron/asar`; combined original group: 146 PASS, 1 failed test-file load |
| Actual custom-dist preflight in this workspace | HOLD, exit 2: `custom_electron_package_receipt_regular_file_required` |
| Windows compile/link, real process/pipe/Job/WTS/ACL, install | NOT RUN |

The five original-main source-verifier NOT RUN checks are: pinned OpenSSL regression, pinned BoringSSL regression, Electron source-interface, official Electron/internal Node header syntax, and win64 cross builds. The verifier also explicitly leaves Windows execution, full custom Electron build, production launch grant, production release positive and continuous code custody unproven. Its nested Node regressions contain one platform skip. Leak sanitizer is disabled on this ptrace host; ASAN and UBSAN model checks passed.

Required commands, run from `Compute/` unless shown otherwise:

```sh
python3 apps/metaengine-browser/test/native/verify-guardian-original-main-launch-source.py
python3 apps/metaengine-browser/test/native/verify-guardian-main-begin-model.py
python3 apps/metaengine-browser/test/native/verify-guardian-main-begin-model.py --sanitize
python3 apps/metaengine-browser/test/native/verify-guardian-main-owner-wait-model.py
python3 apps/metaengine-browser/test/native/verify-guardian-main-owner-wait-model.py --sanitize
python3 apps/metaengine-browser/test/native/verify-guardian-requester-session-model.py
python3 apps/metaengine-browser/test/native/verify-guardian-requester-session-model.py --sanitize
node --test apps/metaengine-browser/test/browser-guardian-original-main-launch-protocol.test.mjs apps/metaengine-browser/test/guardian-owner-loaded-read.test.mjs apps/metaengine-browser/test/browser-guardian-native-ticket-enrollment-contract.test.mjs
(cd apps/metaengine-browser && node scripts/check-source.mjs)
python3 apps/metaengine-browser/test/native/verify-guardian-original-main-source.py --repo "$PWD" --out /workspace/metaengine-evidence/guardian-original-source-details
python3 -B apps/metaengine-browser/test/test_custom_electron_source_build.py
```

## Remaining blockers

1. **Windows build prerequisites missing.** This host is Linux x86_64, Node 24.19.0. Windows PowerShell, MSVC, GN, Ninja, NSIS, Wine and MinGW are absent from PATH. No custom Electron distribution/receipt, staged Guardian/peer/bootstrap binaries, offline runtime bundle or installed Node dependencies are present. Nothing was installed to manufacture a build result. `build-prerequisites.json` records the checks.
2. **Single delivered EXE is not implemented by the current NSIS contract.** `build/installer-transaction-overrides.nsh:546-564` requires four fixed release-proof/package-code/SLSA siblings of the installer. The V2 proof hashes immutable final installer bytes, so embedding that same proof into the hashed installer creates a self-reference. A separate nonauthoritative container around an unchanged inner installer and real signed sidecars is a possible interface, not implemented or qualified here.
3. **Protected release signer unavailable.** `release-proof-producer-w77.mjs` exposes `EXISTING_PROTECTED_RELEASE_ROOT_SIGNING_CAPABILITY_NOT_WIRED`; production sidecars/release authorization remain false. Final artifact inventory reports `package_code_release_signature_available:false`. No synthetic success or replacement key was introduced.
4. **Unsigned-install path unresolved.** The user's Authenticode waiver is recorded, but existing W60/W68, installer admission and Guardian custody consumers require a genuine OS-native signature fact in addition to internal Ed25519 proof. No equivalent unsigned path exists in this snapshot. Those independent checks were preserved; this patch does not deliver the requested unsigned-install capability. It never equates the Authenticode waiver with permission to disable the internal release signature.
5. **NSIS native purpose interface missing.** NSIS runs embedded stock Node support before candidate extraction. Its chain enters `guardian-connected-peer-native.mjs:13-18`, which only admits packaged Electron browser Main. A source-only probe reproduces `GUARDIAN_CONNECTED_PEER_PACKAGED_MAIN_REQUIRED` without any OS call. A genuine NSIS/bootstrap-purpose mount retaining original installer custody is required.
6. **Clean first-owner/upgrade authority remains HOLD.** A locally initialized provider/schema/device record does not supply the authenticated Guardian owner bridge. No ADMIN identity or native enrollment/Main authority was invented. Fresh setup still reports Guardian/runtime readiness false. The fixed `C:\Windows` rail retains its existing nonstandard-SystemRoot limitation; OS-native root resolution and physical Windows qualification remain separate work.

Source availability is resolved. Build, release custody and clean-machine authority prerequisites remain blocked; no build/install action has an uncertain outcome and no automatic approval review denied an action. Four GPT 6.1 agents worked as independent implementation/review pairs for packaging and configuration. No production secret, transfer token or signed download URL is included in these deliverables.
