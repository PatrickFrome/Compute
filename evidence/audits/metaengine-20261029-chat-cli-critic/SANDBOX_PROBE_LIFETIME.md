# Sandbox preparation probe: owned lifetime failures

The default profile preparation remains unimplemented. Inspection of its existing
sandbox probe prerequisite reproduced three concrete lifetime failures in the
actual runCodexCliSandboxProbe function: a second log-open failure leaked the
first handle; an observer exception returned before owned process completion;
and an uncertain resume returned without requesting termination or closing logs.

The probe now closes partial log acquisition, joins owned completion after
observer/resume failure, drains already-started observations/log writes, and
closes both logs even after flush failure. Both sync operations settle before
handles are closed; one failed sync cannot release the other pending operation.
A failed termination request cannot be mistaken for completed process cleanup.
Failure produces no successful probe receipt and does not delete uncertain
workspace/canary evidence. No process retry, model request or new authority is
introduced. Existing process controller remains the physical authority.

Seven lifecycle cases execute the shipped function with explicit generated
filesystem/process adapters, not Windows sandbox evidence. They cover partial
open, observer failure, resume failure, spawn failure, failed terminate request,
log-sync failure and a still-pending sibling sync. The first three reproduced
failures before the fix. Combined existing probe + lifecycle + registration:
25 pass, one Linux skip for the existing Windows-only native boot observation.
The Windows workflow now includes both probe files and the real boot identity
read. Actual Codex elevated-sandbox qualification on the installed client is
still required; the synthetic lifecycle adapters cannot establish it.

Previous published 6466dac8d45838e1a10a0d526154a2c2b36a5282 completed both CI
runs successfully: Windows Source 40934014328 (452/453 component with one baseline
skip, native PG17 47/47 without skips) and Runtime Contracts 40934014281 (PG,
Ubuntu, Windows). Its additional local broad Browser run was interrupted by a
reported api.github.com network policy block and has no final test total. The
previous complete local ea751466 run remains 6851 pass / 28 environment failures /
82 skipped, not a full local green claim for this newer source.

## Output overflow and failed shutdown acknowledgement

A further red regression reproduced an unhandled rejected termination promise
from the stream data handler. Shutdown requests now share one owned promise,
retain process-completion custody, and cannot fan out or reject unobserved.
Overflow permanently blocks the probe even if the child later exits cleanly.

Both log streams retain at most 32768 bytes. After that bound, no additional
writes are queued, including when termination fails. Retained prefixes are
copied so queued writes cannot retain an oversized source buffer. writeFile on
the owned file handle completes each queued prefix rather than assuming one
write call wrote every byte. Existing request timeout and no-model policy stay
unchanged. Overflow receipts are BLOCKED, never full-output or sandbox proof.

Tests cover overflow with successful/failed termination acknowledgement and
an asynchronous log-write failure with failed termination. They assert one
shutdown request, bounded log bytes, closed handles and no positive receipt.
Combined probe/lifetime/registration: 28 pass, one Windows-only boot-read skip
on Linux. These remain generated process/filesystem fixtures, not an installed
sandbox acceptance test. The preceding 8150958c CI completed successfully:
Windows Source 40938473294, component 475/476 with one baseline skip and native
PG17 47/47; Runtime Contracts 40938473297, all three jobs successful.

## Native observation retained through persistence failures

Two further regressions reproduced a started native PID observation outliving
its probe when log sync failed or opening the exit receipt failed after process
completion. The successful-completion path now joins its started observations
before fallible log and exit persistence. The process-error path already joined
them. No new observation, retries or authority is introduced, and no late read
can outlive a reported persistence failure.

Both new cases first failed with the shipped function and then passed after the
ordering repair. Extended local probe, runner, Windows-controller-failure,
native-runtime and checkpoint coverage: 152 total, 144 pass, zero failures,
eight platform skips. Generated observation and filesystem adapters demonstrate
lifetime ordering, not actual Windows sandbox or installed bootstrap acceptance.
The preceding bounded-output patch was published as 73eb19a948dc4e6c1b01707f28fde9b70beca9d3;
its Windows CI was still running at this local checkpoint.
