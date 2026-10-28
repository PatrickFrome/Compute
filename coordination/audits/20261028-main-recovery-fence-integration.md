# Recovery initialization failure must reach the native mutation gate

Source review after the class-level fence fix found a composition gap:
ensureInterruptedSetupRecovery did not cache a failed recovery object and only
called Supervisor.setInterruptedSetupRecoveryFence after successful init.
Thus a storage preparation or journal read failure rejected initialization but
did not put the current native Supervisor's mutation gate into HOLD.

Two tests execute the actual main startup function with inert dependencies.
Both reproduced the missing true fence before the patch. Main now catches
storage/construction/init failures, revalidates the captured lifecycle and
Supervisor/Fleet, and fences that exact Supervisor before propagating error.
A failed old initialization cannot modify a replacement Supervisor. A later
successful current-lifetime journal read can release the fence normally.

Focused main initialization, interrupted recovery and startup independence:
66 passed, 0 failed, 0 skipped on Linux. This is executable composition
coverage, not installed Windows client or physical own-PG qualification.
Windows rerun and publication remain pending.
