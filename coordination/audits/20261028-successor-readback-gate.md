# Successor acknowledgement gate fence

Base: 1e5d8aa0cdad59f111dc0540566d7e8b71f637de, isolated local branch.

Runtime recovery acknowledgement checked its gate before asynchronous native
predecessor readback, but did not check again before persisting CONFIRMED.
Cancellation or a gate epoch change during readback therefore still produced a
success receipt. Two deterministic regression tests reproduced this behavior.

The acknowledgement now pins its initial gate epoch and revalidates the gate
and cancellation state after physical predecessor readback, before committing.
A failed fence leaves REQUESTED intact and does not replay the relaunch.

Combined recovery/admission tests: 73 tests, 71 passed, 0 failed, 2 Windows
physical kernel tests skipped on Linux. No installed Windows qualification is
claimed. Publication and package assembly remain pending.
