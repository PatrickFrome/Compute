# Interrupted setup recovery: fail-closed readback fixes

Base: e844ee38fa5dd285b175cbfd995dbd8fb3a42f31 (package candidate .1848773682936.1).

## Reproduced defects

1. Some `init()` failures (directory verifier, invalid archive schema, malformed committed JSON) left the same controller instance with `fenced: false`. A caller catching initialization failure could subsequently enter recovery rather than fail closed.
2. After applying supervisor retirement, final readback checked epoch and history but did not reject changed process incarnation, changed admission-generation floor, or a newly created rollover attempt. This could produce a committed receipt for a changed context.

## Changes

- Every initialization exception fences the controller before rethrowing the original error.
- Final readback pins the original process incarnation and generation floor and requires no rollover attempt.
- Six regression cases added to the existing interrupted-setup test file so existing selected-suite workflows execute them.
- No retry, admission bypass, scheduler, package-version change or installed-profile mutation.

## Evidence

All six new cases failed against the base implementation. With the patch, interrupted-setup tests: 27 passed, zero failed. Expanded interrupted-setup + runtime-recovery-generation/transaction/sentinel: 51 passed, zero failed, two Windows-only physical-process tests skipped on Linux. Skips are not Windows qualification.

## Qualification limits

No new installer built. Existing package bytes do not contain these fixes. Native Windows execution and exact-head CI are still required. The separate Windows test VM currently reaches OOBE but encounters OOBEKEYBOARD/OOBELOCAL; installed METAENGINE live testing has not started.
