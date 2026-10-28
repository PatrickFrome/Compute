# Admission recovery stays bound to one current Supervisor lifetime

resumeClientAdmissionOnce dereferenced the mutable nativeSupervisor global
again after asynchronous reads and journal writes. Five executable main-function
regressions reproduced sends after replacement/teardown/generation loss, or a
prior effect being confirmed using a replacement Supervisor's readback.

The explicit user action now captures its Supervisor and closing barrier once,
reuses the existing native initialization lifetime guard, and revalidates after
awaited journal/read/effect boundaries. Calls target only the captured object.
A lifetime change before send leaves any durable intent pending. A change after
an effect yields reconciliation-required state, never a replay or confirmation
from another Supervisor. The normal one-effect independent-readback path passes.

Focused admission, durable journal, main lifetime and interrupted recovery:
88passed0failed0skipped. The pre-existing source contract was updated to require
the captured Supervisor and a current-lifetime check after durable send intent,
not weakened to accept either mutable or captured dispatch. Windows installed
qualification and final aggregate are separate and not claimed by this result.
