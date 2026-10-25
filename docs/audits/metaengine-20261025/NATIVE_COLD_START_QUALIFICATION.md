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

The observed failures fall into four groups:

1. Linux Current Source and Shell each failed one real Electron MAIN_PROCESS
   ASAR regression because no X display was available. Their complete suites
   reported 5,970 tests: 5,905 pass, one fail and 64 platform skips.
2. Windows capture fixtures aborted inside libuv `src/win/fs-event.c`, before a
   JavaScript assertion could report the problem. Directory `fs.watch` was used
   on both sides of their private readiness/stop channel.
3. Windows native controller startup stopped in the `Add-Type` interval: Current Source
   recorded `PS_ENTER` at 254 ms and `ADD_TYPE_BEGIN` at 265 ms, no compilation
   completion, no validated ready frame, and helper close at 30,044 ms. A
   separate Critical Audit run spent approximately 24,948 ms in that same
   interval. This includes command/module initialization and does not isolate
   time spent inside the external compiler. Later runs took only a few hundred
   milliseconds under different warm/load conditions.
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

## First published Windows readback and build cleanup follow-up

Published functional source `afbd629779e8d07e595a4f108751c4f36951d1e4`
reached the three independent Windows build preparation paths: Live Mechanics,
Critical Audit and Current Source. All three stopped at removal of their own
build temporary directory with `EBUSY`, after approximately 37, 33 and 31
seconds respectively. Node 24.22.1 and 24.19.0 reproduced the failure.

These jobs did not reach the boot, capture or controller tests. The original
`finally` could overwrite an earlier build error, so the available logs do not
establish whether compilation itself succeeded. No process was identified as
the lock holder. Exact job IDs, failure excerpts and complete-log digests are
retained in `windows-build-cleanup-ci.json` in the evidence directory.

The follow-up launches the build driver from fixed System32, keeping all
compiler inputs/outputs absolute. Owned-directory cleanup checks its captured
identity before each of at most six attempts; transient EBUSY/EPERM/ENOTEMPTY
backoff totals at most 1.5 seconds. A primary build failure is retained; combined
build/cleanup failures retain both errors. Cleanup failure still fails the build.
These changes do not alter native source bytes or task runtime deadlines.
Windows documents that a process current directory is locked while that process
executes; removing the temporary directory from that role avoids this unnecessary
lifetime coupling without claiming which process held the observed lock.

The exact `afbd6297…` Linux Current Source job subsequently passed: 5,921 Browser
passes / zero failures / 65 platform skips, with a real Electron 44.0.0 main
process and physical ASAR digest/tamper checks. Its source preflight was 124/124;
State Runtime was 614 pass / zero fail / 19 platform skips. Shell also passed
on synthetic merge `886fce1f…`, whose tree was independently verified identical
to the published source tree. These are source/Linux results, not Windows native
qualification. See `linux-exact-ci.json`.

The cleanup follow-up passed 34 integration tests with zero failures and one
Windows-only build skip; all 240 source parser checks and 124 current/historical
source preflight tests passed. Independent review
found no blocker. Six new failure scenarios cover real owned directories/locks
with injected transient removal failures, replacement and error preservation.
The 577-path current seal refresh changes only the two reviewed build/test blobs.

References:

- [Windows current-directory lifetime](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setcurrentdirectory).
- [Node filesystem removal and transient-error retry options](https://nodejs.org/api/fs.html#fspromisesrmpath-options).

## Compiler lifetime made explicit after preserved diagnostics

The cleanup follow-up `e95423f87f562ac2f166d6a796dd6fd8f376b1a2` reached
Windows build preparation again. Current Source, Critical Audit and Live
Mechanics all failed with
an intact primary error: strict-mode access to an unset `$LASTEXITCODE` after
`& $compiler @arguments`. The PowerShell wrapper exited with code 1 and was not
killed; none of their logs contained a cleanup error. These are compiler-launch/exit
observation failures, before native execution, not a successful compiler result.
Exact receipts are in `compiler-lifetime-ci.json`.

The next build-only repair uses an owned `System.Diagnostics.Process` for the
fixed signed compiler, an explicit argument vector encoded for Windows, a fixed
System32 working directory and `UseShellExecute=false`. Both output streams are
drained concurrently, the actual process exit is awaited and its `ExitCode`
determines compilation success. Timeout terminates only that owned process and
requires bounded exit observation. The existing 180-second outer build deadline
is unchanged; the inner elapsed budget accounts for signature verification and
leaves time for termination and diagnostic drain. Task startup and boot-read
budgets remain 30 and 12 seconds.

A physical Windows negative case now supplies invalid C# and requires both a
real `CSdddd` compiler diagnostic and a nonzero observed compiler exit. The
previous accepted helper/manifest and lock cleanup are checked after this
refusal. The original native C# source and successful artifact checks are
unchanged. Linux cannot establish this Windows compiler behavior.

The final local build/runtime integration passed 34 tests with zero failures and
one Windows-only skip; 240 source parser checks and 124 current/historical
source preflight tests passed. The Windows compilation
and refusal cases remain a mandatory physical gate. Only the two reviewed
build/test blobs were refreshed in the 577-path current source seal.

PowerShell's documented treatment of some GUI applications is consistent with
the observed unset variable and earlier cwd lock, but the compiler's actual PE
subsystem was not observed, so this is an inference rather than an asserted
root-cause subtype.

References:

- [PowerShell native process waiting semantics](https://devblogs.microsoft.com/powershell/managing-processes-in-powershell/).
- [Process redirected output and deadlock avoidance](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.standardoutput?view=netframework-4.8.1).

## Early native failure receipts while complete coverage continues

Source `28b105a23e8ffa28083b27313f784c6a75b8e046` passed actual Windows helper
preparation on the Live Mechanics and Current Source runners (32 and 24 seconds).
This includes compilation, reflected entrypoint validation, publication/readback
and owned cleanup. Linux exact-source qualification also passed with 5,927 Browser
passes, zero failures and 65 platform skips, including real Electron/ASAR checks.

The Live Mechanics isolated Windows native stage then failed at 21:26:19 UTC,
after 9 minutes 13 seconds, within its unchanged ten-minute ceiling. The full
suite correctly continued. The GitHub job-log endpoint returned `404 BlobNotFound`
while the containing job remained active, so the failing assertion was not yet
available. No successful Windows runtime qualification or new package identity
was inferred from successful build preparation.

The workflow follow-up captures the isolated native stage output with `tee` under
its existing `set -euo pipefail`, then uploads that receipt immediately after the
stage succeeds or fails. The full regression suite still runs after successful
prerequisites, including when the native stage failed. The same six complete
native test files, concurrency, time ceilings and failure propagation remain in
force; neither this artifact nor its upload grants qualification. Cancellation is
still honored. The source/run/attempt-scoped log gives a reviewer the native
failure details before the longer complete regression job finishes.

The observed stage statuses are retained in `native-stage-observability.json`.

## Terminal Windows results and fixture repair

The normal, completed Current Source Windows job for
`28b105a23e8ffa28083b27313f784c6a75b8e046` ran **6,001 tests: 5,988 passed,
five failed, eight skipped, zero cancelled**. The real producer and invalid-C#
refusal passed. All controller cases, the forced output-order case and physical
window capture passed. Capture completed without the earlier libuv fs-event
assertion. The exact run and job receipts are in `windows-native-runtime-ci.json`.

Three failures came from fixture assumptions: the malformed here-string negative
used an LF-only mutation against the CRLF Windows checkout, and both physical
birth scenarios prepared their helper below a child directory even though their
native observer requires the helper and birth channel beside the owned cwd.
The negative now exercises both LF and CRLF and requires changed bytes before
asserting refusal. The birth helper is prepared in that owned cwd; the existing
native `private_fixture_paths` guard and physical birth assertions are retained.

The two other failures are real bounded-read failures: boot identity exceeded
12 seconds and process inventory exceeded 15 seconds. A separate normal Live
Mechanics job confirmed both: its isolated six-file suite had 129 passes, four
failures and one skip. Controller, output order and physical capture passed;
the two readers and two birth fixtures failed. Its later full suite reported
5,987 passes, five failures, one cancelled test and eight skips; the fault-helper
test hit its own 180-second ceiling. This is not a completely qualified Windows
suite, and a cancelled test is not counted as a pass.

The startup phase receipt localizes one remaining delay more precisely. Current
Source loaded the prepared assembly from 182 to 188 ms, then spent 188 to
22,615 ms in the combined `ReadLine | ConvertFrom-Json` interval. Live Mechanics
showed the same broad location: assembly 165–170 ms and request 170–17,596 ms
in its isolated run; assembly 236–244 ms and request 244–28,528 ms in its full
run. These observations do not distinguish stdin wait from JSON/cmdlet
initialization and do not prove runner contention.

The existing post-failure, read-only diagnostic returned boot identity in
17,648 ms and process identity in 17,370 ms using its separate 60-second
diagnostic ceiling. Those later results cannot replace the original failed
12/15-second observations. The diagnostic now inserts fixed, uniquely anchored
stderr phase labels around native binding, each CIM read, owner lookup and JSON
serialization, retaining the readers' stdout, validations, owned child handles
and failure propagation. Only bounded stage names/times and unknown-byte counts
are emitted; command text, paths, rows, environment and native errors are not
exported. A changed or ambiguous source anchor refuses before execution.

The disposable output-order helper likewise distinguishes `ReadLine` completion
from JSON parsing. Its custom C# preparation runs in a separate build hook;
the producer's 180-second subprocess ceiling and owned cleanup remain in force,
and the hook allows 210 seconds for that preparation and cleanup. The measured
native test keeps 60 seconds, controller startup 30 seconds and child lifetime
15 seconds. Teardown waits for the owned preparation to settle before removing
its directory. Neither instrumentation changes the production helper template.

The four suspended-cleanup fault variants each change real C# and still receive
one separate build; reusing the production assembly would erase those faults.
Their preparations now precede the unchanged 180-second native test in an owned
suite hook, with four 210-second preparation envelopes around the unchanged
180-second producers. Every fault and cleanup/canary assertion remains present.
The suite cleanup uses the same bounded settlement barrier, retaining the
original setup error and refusing to remove a directory still owned by a build.
These changes do not shorten the complete suite by themselves and do not widen
the existing 10/20-minute workflow qualification steps.

A separate Windows diagnostic job runs the two instrumented reads and the
disposable output-order case on a fresh runner, with exact source verification
and fixed time ceilings. It has no package installation or model invocation.
This shorter diagnostic makes stage evidence available independently of the
long full-suite job; the original isolated probe, full suite and PostgreSQL job
remain mandatory and unchanged. Diagnostic completion does not establish
source, installed-client, release or cooperative-autonomy acceptance.

The combined local fixture/controller/diagnostic regression passed **169 of
180 tests, zero failures and 11 Windows-only skips**, with 240 source parser
checks. Controlled rejected/late-settling preparation probes exercised the
actual fixture modules and confirmed cleanup ordering while retaining setup
failure; they did not execute a Windows compiler or native helper. The fresh
diagnostic import graph resolved 24 local modules and 16 Node builtins without
packages, and a negative control proved the package-resolution refusal.
These checks and file hashes are retained in `native-fixture-verification.json`.

The preceding `1ca3587b1104002f11b9cd86a0555ff4efbdcd30` early artifact was
successfully downloaded and digest-checked before its full job ended. Its
isolated log is partial, with no final counts, after a 607-second step against
a ten-minute ceiling. Five failure rows and a passing output-order observation
are present; the full runner timeout message was not yet available. It is
recorded separately in `early-native-partial-ci.json`, not treated as a normal
terminal qualification or combined with the completed 28b results.

## Fixed system-module imports after stage localization

The independent Windows diagnostic on
`6adb7836ffcc5e9424747759d14701e2d0efcd02` completed normally. It measured
**2 ms stdin read, 8 ms assembly load and 23,024 ms JSON parsing** in the
prepared helper. The boot reader's first `Get-CimInstance` took **30,999 ms**;
its following CIM reads took 31 and 22 ms. The process reader's first CIM call
took **22,462 ms**, followed by a 21-ms owner lookup. Both extended readers
returned valid identities, but exceeded their production deadlines. These
receipts are in `native-stage-localization-ci.json`; they localize the slow
calls without proving that module discovery, rather than module/provider
initialization, accounts for every millisecond.

On another runner for the same source, the complete isolated six-file stage
passed **132 tests, failed one, skipped one, cancelled zero**. Both physical
birth scenarios, suspended-cleanup faults, output ordering and capture passed.
Only boot identity exceeded 12 seconds. The process read and JSON parsing were
faster under those different conditions, so that observation is not attributed
to the later import change. `native-fixture-windows-ci.json` records that
completed stage separately from its still-running containing full-suite job.

That containing job later completed normally: its full Browser suite passed
**5,996 tests, zero failures, eight skips, zero cancelled** (6,004 total), in
179,591 ms. Later reads on that runner took only 565/459 ms. The job still
failed because its earlier isolated boot read exceeded 12 seconds. This is
direct evidence that a later successful full suite does not repair the earlier
cold-read failure; the terminal follow-up is retained separately in
`native-fixture-windows-full-ci.json`.

The next narrow repair disables automatic module discovery inside each fixed
PowerShell session and explicitly imports the required OS manifests from the
fixed `C:\Windows\System32\WindowsPowerShell\v1.0\Modules` directory. The boot
reader imports CimCmdlets and Utility; process inventory imports CimCmdlets;
the prepared helper imports Utility inside its existing controlled-error
`try` block. The build driver imports Utility, Management and Security for its
existing JSON, path and Authenticode commands. Missing modules fail at import;
there is no alternative path or task retry.

The PowerShell variable affects this session only. No `$env:PSModulePath`,
profile, registry or child environment is modified. WMI queries, CIM date
handling, owner SID, boot double read, JSON parser and request fields are
unchanged. All existing 12/15/30-second runtime deadlines include module import.
The build's 180-second ceiling, compiler signature checks and process custody
also remain unchanged.

The C# bytes are exactly preserved: **16,766 bytes**, SHA-256
`b93bc3707d783890434912e0ee3af93215073107d4481f3eb9c4d3f39987883e`.
Only the two PowerShell trailer lines change the source template digest to
`60f70fdb0ff5ddab3f61efb46060931e862cb71d8601a5ad3d3b1c19868ec5d6`.
An explicit rebuild and the unchanged template/helper/manifest checks still
bind the prepared runtime. Disposable observations now measure module import
as a separate stage, so moving a delay into import cannot appear as an overall
startup improvement.

Local combined regressions passed **204 of 217 tests, zero failures and 13
Windows-only skips**; 240 source parser checks passed. Portable checks do not
establish Windows performance. A fresh exact-source Windows run is required
before this candidate can retire either native-read blocker or select a new
package identity.

Primary references for the narrow import choice:

- [Windows PowerShell module import by file path](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/import-module?view=powershell-5.1).
- [Windows PowerShell startup and module search paths](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_psmodulepath?view=powershell-7.6#windows-powershell-startup).
- [Module-qualified command resolution](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_command_precedence?view=powershell-5.1#use-module-qualified-names).

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
