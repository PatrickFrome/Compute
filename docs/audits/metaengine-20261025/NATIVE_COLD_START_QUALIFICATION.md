# Native cold-start qualification after PR #1347

Date: 2026-10-25. Branch: `work/native-admission-readiness-20261025`.

## Current baseline and observed failures

The preceding source increment is
`4e5de5c7fb9d9e0fe34a83c839aab58fca4cdb8e`, in draft
[PR #1347](https://github.com/PatrickFrome/Compute/pull/1347). A fresh terminal
read of that exact commit found 21 workflows: 11 successful and 10 failed;
56 job checks: 44 successful, 11 failed and one skipped. Both Windows and Linux
passed the 124-test current/historical source preflight. These outcomes replace
the earlier in-progress snapshot; they are not inherited qualification for this
continuation.

The failures have four independent causes:

1. Linux Current Source and Shell each failed one real Electron MAIN_PROCESS
   ASAR regression because no X display was available. Their complete suites
   reported 5,970 tests: 5,905 pass, one fail and 64 platform skips.
2. Windows capture fixtures aborted inside libuv `src/win/fs-event.c`, before a
   JavaScript assertion could report the problem. Directory `fs.watch` was used
   on both sides of their private readiness/stop channel.
3. Windows native controller startup stopped inside `Add-Type`: Current Source
   recorded `PS_ENTER` at 254 ms and `ADD_TYPE_BEGIN` at 265 ms, no compilation
   completion, no validated ready frame, and helper close at 30,044 ms. A
   separate Critical Audit run spent approximately 24,948 ms in that same
   compilation phase. Later warm runs took only a few hundred milliseconds.
   The boot reader also exceeded its 12-second deadline; its old path compiled
   a small C# P/Invoke class on every independent native read.
4. Package Smoke correctly refused to reuse version
   `0.7.0-dev.1107139874594.1`, already reserved for
   `602d4b07f755f7cd61a6da3af06985d4384b859a`. Five dependent installed/update/soak
   jobs then reported `installer_provenance_producer_failed`. Their missing
   producer is not evidence of five independent installed-runtime defects.

The redacted exact-job observations are retained in
`evidence/audits/metaengine-20261025-native-cold-start/baseline-ci.json`.

## Repairs and preserved execution boundaries

### Real Linux Electron qualification

The two affected full-suite workflow steps run under `xvfb-run -a`. Linux still
executes the actual Electron main process, and the Windows command is unchanged.
The actual ASAR/original-fs digest and tamper assertions remain registered.

### Windows capture fixture lifetime

The existing atomic nonce-bound file protocol remains intact. Instead of
directory notifications, each side reads only its owned ready/stop file every
50 ms, within the existing lifetime and readiness deadlines. Stop, abort,
failure and child close release the timers; a stop before Electron readiness
also prevents a later window from being created. The exact PID/HWND selection,
one native observation, one capture, PNG/pixel/geometry checks and ordered
owned-process cleanup remain required.

### Kernel boot read without an external compiler

The boot reader emits one fixed in-memory P/Invoke binding with .NET Framework
`Reflection.Emit`, targeting the fixed System32 `ntdll.dll` export
`NtQueryInformationProcess`. No generated DLL is written or loaded from a cache.
The native return signature, telemetry class 64, 65,536-byte buffer, layout and
current-process checks, unsigned fields, independent PID4 creation anchor and
before/after boot comparison are retained. The read deadline remains 12 seconds.

Primary API references:

- [TypeBuilder.DefinePInvokeMethod](https://learn.microsoft.com/en-us/dotnet/api/system.reflection.emit.typebuilder.definepinvokemethod?view=netframework-4.8.1).
- [PROCESS_TELEMETRY_ID_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/devnotes/process_telemetry_id_information_type).
- [Windows PowerShell Add-Type compilation semantics](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/add-type?view=powershell-5.1).

### Native job helper compilation belongs to the build

The existing C# Job Object implementation remains the reviewed source template.
An explicit build preparation compiles those exact C# bytes and emits a
self-contained PowerShell helper containing the managed assembly bytes. Runtime
launch loads that assembly; it never compiles C#, prepares a missing artifact,
selects a cache or retries a task.

The normal package hook prepares the helper and includes its expected digest
manifest inside `app.asar`; the external helper retains its established
`resources/native-coding/codex-cli-job-runner.ps1` path. Source runs require the
same explicit preparation and reject a changed template. Each launch checks the
prepared bytes before starting the helper. The build manifest describes build
inputs and outputs and does not grant release, device, task or execution authority.

The original 30-second startup budget, native child creation suspended inside
its Job Object, exact incarnation, explicit resume, absolute lease deadline,
cancellation and descendant cleanup contracts remain in force. Counterfactual
physical fixtures prepare their modified source explicitly before exercising
the same native behavior; preparation is not substituted for a task result.

Windows `npm test` prepares the artifact through its explicit `pretest` build
stage, including historical full-suite workflows. The current direct
`node --test` Windows workflows prepare it in a preceding build step. A Linux
pretest reports `NOT_APPLICABLE` and emits no prepared Windows artifact.

## Local verification and evidence

The complete Linux Browser suite ran under a real Xvfb display with Electron
44.0.0 in `MAIN_PROCESS` mode: **5,986 tests, 5,921 pass, zero fail, 65 skips**.
Its full output is retained as `full-browser-regressions.txt`. The skips do not
qualify Windows. A separate real Electron/ASAR run passed seven tests without
skips, including physical/virtual file readback and digest/tamper guards.

Final build/runtime/CI integration checks passed **28 of 29 tests**, with one
Windows-only build test skipped. Registered source parsing passed **240 files**,
and the CI applicability contracts passed **4/4**. Complete current/historical
source preflight passed **124/124**, without skips. The original native C#/
PowerShell template is byte-for-byte unchanged with SHA-256
`0c817a654c14217e4c9292766386a88107d0a9dd7e69ab01e8b6296017f2e54f`.

Commands, source-file digests and explicit platform limits are recorded in
`evidence/audits/metaengine-20261025-native-cold-start/verification.json`. The
current source seal contains **577 paths**; only reviewed current blob entries
were changed. Historical manifests, package transitions, frozen version and
qualification flags were preserved.

The Windows device inventory again reported online, but the one read-only
terminal request returned neither a result nor a process/call ID. Waiting was
interrupted after 1,012 seconds; the remote background-call inventory was empty.
No current Windows checkout or running-process state was established, and no
mutation, installation, restart or goal-dispatch command was sent to that device.

## Acceptance still required

This continuation must be qualified on its own final source commit. Portable
tests and Linux Electron results cannot qualify Windows assembly compilation,
cold native launch, capture, installed Owner admission or cooperative autonomy.
The source increment must pass real Windows contracts before a new package
identity is selected and checked by the existing serialized producer. The
previous `.4594` artifact and its immutable reservation remain historical.

Installed acceptance still requires the explicit goal, native model execution,
independent Critic, own-PostgreSQL checkpoint/Git commit, successor work and
controlled restart described in `AUTONOMY_ACCEPTANCE.md`. An earlier Supervisor
UNKNOWN must retain its original correlation and may not be reset or replayed
to manufacture a successful run.
