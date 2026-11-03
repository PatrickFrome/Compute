# METAENGINE bootstrap prelaunch HOLD

Source-only review revision for draft PR 1434. Native genesis now stops BEFORE elevation with `GENESIS_ORIGINAL_PRELAUNCH_BINDING_UNPROVEN`, even after existing package qualification succeeds. The post-ShellExecute process predicate and reachable launch/window path have been removed. Clean Windows installation remains HOLD; final installer launch safety is not claimed.

## Why the previous postcheck was insufficient

A child may execute image initialization, imported DLL code or effects before ShellExecuteExW returns its process handle. SEE_MASK_NOASYNC waits for launching work; it does not establish a suspended-before-first-instruction contract. A negative returned-process check cannot erase an earlier effect. The earlier private predicate was useful only as a consistency observation, not prelaunch permission. [Microsoft SHELLEXECUTEINFO](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ns-shellapi-shellexecuteinfow).

The existing retainedImageMatchesOriginalProcess implementation explicitly limits itself to consistency for an already original process. It checks QueryFullProcessImageNameW and the identity of a file reopened at that pathname; it does not inspect the original kernel image section or issue startup custody. This is a source finding in browser-guardian-active-policy-activation-namespace.inc.hpp:1–27.

## What retained W77 custody actually provides

W77 keeps original GENERIC_READ file handles with FILE_SHARE_READ, hashes through those handles, checks FileID/link count/path/ACL and retains Read oplocks. These are meaningful barriers against ordinary incompatible writable/delete opens. Acquisition rejects existing writable mapped sections; a later writable-section operation breaks the oplock without waiting for acknowledgment. That latter rule alone does not demonstrate a writable-section bypass because sharing restrictions also apply. [Granting oplocks](https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/granting-oplocks), [section synchronization](https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/fs-filter-acquire-for-section-synchronization2).

Ancestor directory opens request FILE_READ_ATTRIBUTES|READ_CONTROL. Those rights alone are outside the data/execute/write/delete access mask participating in the sharing algorithm, so absent FILE_SHARE_DELETE on the metadata handle alone is not a rename proof. [MS-FSA sharing algorithm](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/8c0e3f4f-0729-49f4-a14d-7f7add593819).

However, directory rename separately checks open descendants. Retained matching child opens can independently block the rename, irrespective of that sharing-access mask. W77 retains those descendants and requests Read-only oplocks rather than handle caching. Thus ordinary ancestor rename appears protected by subtree rules. No successful NTFS substitution was reproduced or claimed. [FileRenameInformation](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/87f86c9b-6c2a-4803-84b7-131a74a434fa), [open descendants](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/133840e4-778e-44ca-9b41-da2323615075).

The remaining gap is a qualified composition from retained signed file/namespace to the exact system image open and permitted early loader inputs before execution. Path-based launch is not inherently unsafe, but source rechecks and a postlaunch pathname/FileID comparison do not establish that complete property. Windows/UAC/loader qualification remains absent.

## Current implementation

requestVerifiedGenesisElevation preserves original-coordinator checks, consumes its attempt before qualification, retains existing W77 package/user custody and checks its signed window. It then returns HOLD with ERROR_ACCESS_DENIED. It cannot call ShellExecute, CreateProcess, connectOriginalBootstrap, window-frame construction or packet transmission. Repeating the consumed request cannot requalify or dispatch. The coordinator contract now reports `uac_implemented=false` and `prelaunch_file_binding_qualified=false`.

The prior originalCoordinatorBootstrapExact addition is removed from Genesis .hpp/.cpp, restoring those files to the base. The independent elevated consumer checks are preserved. Shared installed-namespace mechanics, Main/challenge/recovery flows, trust roots and other threads' scopes were not changed by this review.

The earlier JS closure remains: missing-service activation cannot launch through openPath, even with unchanged bytes, mutation during observation, fabricated JSON or concurrent calls. No new callback, flag, hash or caller path acts as authority.

## Adversarial regression and final checks

The runner extracts the entire ACTUAL request method and compiles it with synthetic package/user/clock/OS boundaries. Its positive package fixture is explicitly not signature authority. Five abstract historical controls mutate route/oplock/bytes, cancellation or deadline inside fake dispatch and preserve one early effect each despite false postchecks. These controls do not claim those namespace attacks are feasible against retained NTFS descendants. The current extracted method reaches zero dispatch/connect/window/early effects, and restored custody or late package availability cannot rearm the consumed attempt.

| Final check | Result |
| --- | --- |
| Actual request model | 21 cases PASS, including 5 historical controls; 11 source guards PASS |
| ASan and UBSan model | PASS; production dispatch/early effects 0, historical early effects 5 |
| Bootstrap regression group | 45 PASS, 0 FAIL, 2 Windows SKIP |
| Original Main protocol and owner/enrollment | 17 PASS |
| BEGIN / owner wait / requester session models | 9 / 13 / 15 PASS, each normal and ASan/UBSan |
| Client source check | 292 PASS |
| Original Main source runner | 23 PASS, 0 FAIL, 5 NOT RUN |
| Original Main launch guard | 81 PASS, unchanged expected FAIL wire_route_authenticates_then_launches |
| Exact-base cumulative patch and previous-revision delta | Both apply checks PASS |

Commands/exit codes/logs are in evidence/final/results.json. The five source-runner NOT RUN checks are pinned OpenSSL 3.5.9 static regression, pinned BoringSSL regression, patched Electron source interface, official Electron header syntax, and Win64 cross-build. Actual Windows process/pipe/Job/WTS/ACL/UAC/NTFS/loader tests, full custom Electron build, production release-positive and Main grant, continuous loaded code custody and leak sanitizer are NOT RUN. The two bootstrap tests and one source-regression subgroup test requiring Windows remain skipped.

## Minimal compatible composition to qualify next

Keep the same existing W77 root, signed package, original coordinator/user/token and bounded one-shot scope. Introduce only a PRIVATE launch lease/operation whose original producer retains the verified executable and complete namespace until the system image-open and permitted early loader inputs are bound before effects. Qualify the exact volume/device mapping, reparse/ancestor/subtree behavior, sharing/mapping restrictions and loading environment on Windows. A caller-supplied path, digest, bool, JSON, arbitrary transport or returned process check cannot mint that lease.

A path launch can be reconsidered only after that retained-namespace composition is demonstrated; otherwise it remains HOLD before the OS boundary. No replacement elevation broker or custom low-level process launcher was invented here. The current producer does not provide this qualification. Existing W77 signer and authenticated sidecar handoff also remain blockers; genesis does not authorize enrollment/Main/PostgreSQL provisioning or upgrade.

## Base and patch identities

Source was reconstructed from transfer commit `accb28e72c87c059e780efb8e6681886b33e9b4f`, archive SHA256 `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`, declared source commit `c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6`. The verified base tree is `2dbe253e97379532f6f4b52ef7edf26109a9266d`; no previous e6-to-c265 patches were applied. No AGENTS.md or .agents/skills is present in the source archive. Local history is reconstructed, not original.

Cumulative patch `guardian-bootstrap-custody-c265.patch` SHA256: `4ae48c040f9e6954aa8813c2b9120baffb5f99b0c63ae578cb96ac9889b8cd89`. It applies ONLY to the verified c265 base.

Review delta `guardian-bootstrap-prelaunch-review.delta.patch` SHA256: `1316e225bf01f8bfc1f390feb590e9b13eedb020f95aa34ec39e7feb16ddd406`. It applies ONLY after the prior patch tree `c90b4494cf3cae6a6a90d5b1e2821a0e6a8ad864`. Both yield `cc5ac21ed40e48d07c051c8019a83fb361e0e30e`. Choose one route; do not apply both to the same tree. The superseded cumulative patch digest is recorded in source-base.json. The current cumulative patch changes six files.

No installer, Windows effects, installed client, services, user DB or machine settings were run or modified. Publication is limited to this independent source-only patch/report branch; no merge or shared-branch change is performed. Credentials, signed transfer URLs and private keys are excluded.
