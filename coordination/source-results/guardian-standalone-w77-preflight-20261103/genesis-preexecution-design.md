# Genesis pre-execution binding: source-only design

**Windows qualification: NOT RUN. No installer, UAC, process-creation, service or database effect was exercised.** The production elevation route remains HOLD with `GENESIS_ORIGINAL_PRELAUNCH_BINDING_UNPROVEN`. This document neither authorizes installation nor implements a creation owner.

The standalone W77 capture contribution is a **read-only** boundary: derive the fixed package from the original native image, retain its namespace, and validate its release/inventory using the same existing verifier linked into the outer coordinator and inner bootstrap. It does not issue elevated installation custody. The debugger creation owner described below is **not implemented**.

## Supported Windows building blocks

`CREATE_SUSPENDED` prevents the primary thread from running until `ResumeThread`; alone it returns process/thread handles, not an image-file handle. `DEBUG_ONLY_THIS_PROCESS` makes the creating thread the debugger. Windows documents `CREATE_PROCESS_DEBUG_EVENT` before any user-mode execution and before other events for that new process. All threads remain stopped while the event is pending. The event supplies the actual image-file handle with read access/read-sharing. These are documented guarantees, unlike a later pathname observation. [Process creation flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags), [debugging events](https://learn.microsoft.com/en-us/windows/win32/debug/debugging-events).

The creator thread must also own the debug pump and continuations. An event file handle can be NULL; absence must refuse. Its I/O mode is not documented: compare its volume/FileID with the already retained W77 file and hash that known-mode original handle; do not request an oplock on the event handle or substitute a pathname reopen. [WaitForDebugEvent](https://learn.microsoft.com/en-us/windows/win32/api/debugapi/nf-debugapi-waitfordebugevent), [ContinueDebugEvent](https://learn.microsoft.com/en-us/windows/win32/api/debugapi/nf-debugapi-continuedebugevent), [CREATE_PROCESS_DEBUG_INFO](https://learn.microsoft.com/en-us/windows/win32/api/minwinbase/ns-minwinbase-create_process_debug_info).

## Conditional private composition

Only an independently authorized **original elevated native installation owner** could perform this sequence:

1. Retain the original installation consent/context, intended unelevated user, process/token incarnations, cancellation object and one absolute deadline. Consume the original W77 package, exact source/version/policy and fixed bootstrap role. Creation itself is an effect requiring authority, even when suspended.
2. Create only the internally derived bootstrap with `CreateProcessW`, `DEBUG_ONLY_THIS_PROCESS | CREATE_SUSPENDED`, fixed arguments and a bounded owned Job. Retain actual creation handles before fallible readbacks; establish Job ownership before continuation/resume.
3. Hold the first CREATE event. Bind its process/thread to those original objects and its image `hFile` to the same retained signed W77 leaf. Recheck package, scope and deadline. Missing, foreign or uncertain objects refuse before continuation.
4. Continue only admitted events, resume the original primary thread once, and retain ownership through terminal process/Job readback. Apply the separate loader profile below before permitting corresponding execution.

The interface must remain private to that genuine native owner. It accepts no caller path, key/root, verifier callback, claimed token, JSON capability, copied debug event or positive flag. No new trust root is needed. Handle inheritance defaults to disabled; any required transfer must use a narrow original native handle list, not numeric handle assertions. [Handle-list requirements](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute).

## Missing first elevated issuer

`GuardianOriginalInstallUser` rejects elevated tokens (`browser-guardian-original-install-user.cpp:80–88`). Its retained token has query/duplicate/impersonate rights, not `TOKEN_ASSIGN_PRIMARY` (`:219–222`). It observes the intended user; it is not an elevated creator grant. `CreateProcessAsUser` requires an appropriate primary token and privileges. Ordinary `CreateProcess` rejects a required elevation; Shell/AppInfo obtains consent and creates the elevated process. [CreateProcessAsUser](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessasuserw), [UAC architecture](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/user-account-control/architecture).

`runas` does not document transfer of the original coordinator's creator-thread/debug-pump ownership. `ICreatingProcess` can modify creation flags, but its contract does not establish that provenance across AppInfo. A returned process handle, later attach, or a debugged child of an already executing helper cannot retroactively fence that first helper. Consequently, the elevated issuer prerequisite is genuinely absent; no factory or flag may manufacture it. [Shell execution information](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ns-shellapi-shellexecuteinfow), [ICreatingProcess](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-icreatingprocess).

## Loader scope and existing Main code

The future owner requires a fixed **bootstrap-specific profile**, authenticated inside the existing W77 closure, covering package modules and the approved Windows baseline. DLL events expose actual loaded-file handles. The documented initial breakpoint precedes static DLL initialization, but this does not establish all TLS, dynamic-loader or relocation ordering. Unknown modules, missing handles or unsupported phases remain HOLD; image-file identity alone is not continuous mapped-code attestation. [DLL debug information](https://learn.microsoft.com/en-us/windows/win32/api/minwinbase/ns-minwinbase-load_dll_debug_info), [initial breakpoint](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/initial-breakpoint).

`GuardianOriginalMainDebugOwner` provides relevant mechanics, but its private `startOwned` requires Main grant/barrier/admission/policy. Do not reuse those grants, enrollment, Main profiles or recovery permissions for Genesis. Its scope restrictions remain unchanged.

## Negative acceptance matrix — Windows NOT RUN

| Class | Required outcome |
|---|---|
| Swap | Different file object, bytes, signed source/version or event image refuses before continuation/resume; same pathname/digest assertions cannot replace originals. |
| Rename | Preserve real descendant handles and verify ordinary rename refusal. Metadata-only ancestor sharing alone is not the proof; retained descendants independently protect ordinary directory rename. No arbitrary-image exploit is claimed. [Rename rules](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information). |
| Reparse | Reparse/alias ancestry, changed route/FileID or ambiguous canonical resolution refuses; never repair the route to qualify it. |
| Early effect | Later attach/postlaunch checks cannot pass as pre-execution evidence. Missing first event, foreign DLL, unsupported TLS/loader phase or child outside coverage refuses. |
| Cancel | Before creation, consume/refuse without launch. After creation, retain original debug/process/Job custody, terminate only owned objects when required, drain events/I/O and independently join termination. Unknown cleanup stays unresolved. |
| Restart | Do not rehydrate capabilities, adopt prior roots or relaunch from receipts. Preserve intent/history and reconcile unknown outcomes; no automatic retry, deadline renewal or claimed rollback. |

Positive source/model tests cannot qualify these Windows cases or clear the current prelaunch HOLD.
