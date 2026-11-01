#pragma once

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

namespace metaengine::guardian {

constexpr DWORD kGuardianIoJoinPollMs = 5'000;

// Only for an operation whose issuing API returned ERROR_IO_PENDING. The
// caller retains the pipe, OVERLAPPED, event and every I/O buffer in its owning
// frame until this function returns. CancelIoEx requests cancellation; it does
// NOT establish completion. A timeout/failed wait retains custody (HOLD), never
// permits scope exit or handle close. The SCM owner remains STOP_PENDING while
// its worker is here. No launch/effect/retry authority is created.
inline void cancelAndJoinGuardianPipeIo(HANDLE pipe, OVERLAPPED* operation) noexcept {
    CancelIoEx(pipe, operation);
    for (;;) {
        DWORD transferred = 0;
        if (GetOverlappedResult(pipe, operation, &transferred, FALSE)) return;
        const DWORD error = GetLastError();
        // A terminal kernel status independently distinguishes completed error
        // from an invalid-handle/API failure while the original I/O is pending.
        if (error != ERROR_IO_INCOMPLETE && HasOverlappedIoCompleted(operation)) return;
        const DWORD wait = WaitForSingleObject(operation->hEvent, kGuardianIoJoinPollMs);
        // TIMEOUT is a bounded wait with retained ownership, not cleanup proof.
        // Avoid spinning on an invalid or prematurely signalled event.
        if (wait != WAIT_OBJECT_0 && wait != WAIT_TIMEOUT) Sleep(kGuardianIoJoinPollMs);
        else if (wait == WAIT_OBJECT_0 && !HasOverlappedIoCompleted(operation)) Sleep(kGuardianIoJoinPollMs);
    }
}

}  // namespace metaengine::guardian
