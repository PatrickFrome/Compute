// Includes the actual service implementation. Only the SCM RPC/worker creation
// are instrumented: no service/client installation or installer dispatch occurs.
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#if defined(GUARDIAN_STATUS_PORTABLE)
// Portable extraction tests actual status functions, with RPC/event stand-ins.
// It is explicitly not Windows kernel or service execution qualification.
#define WINAPI
using DWORD = std::uint32_t;
using BOOL = int;
using HANDLE = void*;
using SERVICE_STATUS_HANDLE = void*;
using LPVOID = void*;
struct SERVICE_STATUS {
    DWORD dwServiceType{}, dwCurrentState{}, dwControlsAccepted{}, dwWin32ExitCode{};
    DWORD dwServiceSpecificExitCode{}, dwCheckPoint{}, dwWaitHint{};
};
using LPSERVICE_STATUS = SERVICE_STATUS*;
constexpr BOOL TRUE = 1;
constexpr BOOL FALSE = 0;
constexpr DWORD NO_ERROR = 0, ERROR_CALL_NOT_IMPLEMENTED = 120;
constexpr DWORD SERVICE_WIN32_OWN_PROCESS = 16;
constexpr DWORD SERVICE_STOPPED = 1, SERVICE_START_PENDING = 2, SERVICE_STOP_PENDING = 3, SERVICE_RUNNING = 4;
constexpr DWORD SERVICE_ACCEPT_STOP = 1, SERVICE_ACCEPT_SHUTDOWN = 4;
constexpr DWORD SERVICE_CONTROL_STOP = 1, SERVICE_CONTROL_INTERROGATE = 4, SERVICE_CONTROL_SHUTDOWN = 5;
inline BOOL SetEvent(HANDLE) { return TRUE; }
#include "browser-guardian-effect-admission.hpp"
#else
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#endif

namespace status_probe {
using namespace std::chrono_literals;
std::mutex mutex;
std::condition_variable changed;
std::vector<SERVICE_STATUS> trace;
std::string mode;
bool pendingEntered = false, releasePending = false;
bool terminalAttempted = false, terminalFinished = false;
bool eventCreationEntered = false, releaseEventCreation = false;
bool workerEntered = false, releaseWorker = false, serviceFinished = false;
bool stopClosing = false, releaseStopClose = false, callbackAttempted = false, callbackFinished = false;
bool workerClosed = false, stopClosed = false;
HANDLE stopHandle = nullptr, workerHandle = nullptr;

[[noreturn]] void fail(const char* message) {
    std::cerr << "guardian_scm_status_probe_failed:" << message << '\n';
    // A failing ownership test must not unwind through joinable blocked threads.
    std::_Exit(2);
}

BOOL WINAPI captureStatus(SERVICE_STATUS_HANDLE, LPSERVICE_STATUS status) {
    std::unique_lock<std::mutex> lock(mutex);
    if (mode == "status" && status->dwCurrentState == SERVICE_STOP_PENDING && !pendingEntered) {
        pendingEntered = true;
        changed.notify_all();
        if (!changed.wait_for(lock, 5s, [] { return releasePending; })) fail("pending_rpc_release_timeout");
    }
    if (status->dwCurrentState == SERVICE_STOPPED && mode != "status" && mode != "checkpoint"
        && (!workerClosed || !stopClosed)) {
        fail("terminal_status_before_handle_cleanup");
    }
    trace.push_back(*status);
    changed.notify_all();
    return mode == "checkpoint" && status->dwCurrentState == SERVICE_STOP_PENDING
        && status->dwWin32ExitCode == 5 ? FALSE : TRUE;
}

#if !defined(GUARDIAN_STATUS_PORTABLE)
SERVICE_STATUS_HANDLE WINAPI registerStatus(LPCWSTR, LPHANDLER_FUNCTION_EX, LPVOID) {
    return reinterpret_cast<SERVICE_STATUS_HANDLE>(static_cast<ULONG_PTR>(1));
}

HANDLE WINAPI createStopEvent(LPSECURITY_ATTRIBUTES attributes, BOOL manual, BOOL initial, LPCWSTR name) {
    if (mode == "start-pending") {
        std::unique_lock<std::mutex> lock(mutex);
        eventCreationEntered = true;
        changed.notify_all();
        if (!changed.wait_for(lock, 5s, [] { return releaseEventCreation; })) fail("event_creation_release_timeout");
    }
    const HANDLE event = ::CreateEventW(attributes, manual, initial, name);
    {
        const std::lock_guard<std::mutex> lock(mutex);
        stopHandle = event;
    }
    return event;
}

DWORD WINAPI controlledWorker(LPVOID) {
    std::unique_lock<std::mutex> lock(mutex);
    workerEntered = true;
    changed.notify_all();
    if (mode == "worker-join" || mode == "teardown") {
        if (!changed.wait_for(lock, 12s, [] { return releaseWorker; })) fail("worker_release_timeout");
    } else if (::WaitForSingleObject(stopHandle, 0) != WAIT_OBJECT_0) {
        fail("startup_stop_not_carried_to_event");
    }
    return 0;
}

HANDLE WINAPI createControlledWorker(LPSECURITY_ATTRIBUTES attributes, SIZE_T stackSize,
    LPTHREAD_START_ROUTINE, LPVOID, DWORD flags, LPDWORD id) {
    const HANDLE worker = ::CreateThread(attributes, stackSize, controlledWorker, nullptr, flags, id);
    {
        const std::lock_guard<std::mutex> lock(mutex);
        workerHandle = worker;
    }
    return worker;
}

BOOL WINAPI closeOwnedHandle(HANDLE handle) {
    std::unique_lock<std::mutex> lock(mutex);
    if (handle == stopHandle && mode == "teardown") {
        stopClosing = true;
        changed.notify_all();
        if (!changed.wait_for(lock, 5s, [] { return releaseStopClose; })) fail("stop_close_release_timeout");
    }
    const BOOL closed = ::CloseHandle(handle);
    if (closed && handle == stopHandle) stopClosed = true;
    if (closed && handle == workerHandle) workerClosed = true;
    return closed;
}
#endif
}

#define SetServiceStatus status_probe::captureStatus
#if defined(GUARDIAN_STATUS_PORTABLE)
// Generated by the Node test from the unmodified production source ranges.
#include "guardian-status-extracted.hpp"
#else
#define RegisterServiceCtrlHandlerExW status_probe::registerStatus
#define CreateEventW status_probe::createStopEvent
#define CreateThread status_probe::createControlledWorker
#define CloseHandle status_probe::closeOwnedHandle
#define wmain guardianServiceEntryForStatusProbe
#include "../../native/browser-guardian-scm/browser-guardian-scm-service.cpp"
#undef wmain
#undef CloseHandle
#undef CreateThread
#undef CreateEventW
#undef RegisterServiceCtrlHandlerExW
#endif
#undef SetServiceStatus

namespace status_probe {
void runStatusOrdering() {
    if (g_worker_thread != nullptr) fail("status_probe_worker_preexists");
    g_status_handle = reinterpret_cast<SERVICE_STATUS_HANDLE>(static_cast<std::uintptr_t>(1));
    if (!reportStatus(SERVICE_START_PENDING, NO_ERROR, 5'000)
        || !reportStatus(SERVICE_RUNNING)) fail("status_initialization_failed");
    std::thread pending([] { serviceControlHandler(SERVICE_CONTROL_STOP, 0, nullptr, nullptr); });
    {
        std::unique_lock<std::mutex> lock(mutex);
        if (!changed.wait_for(lock, 5s, [] { return pendingEntered; })) fail("pending_rpc_enter_timeout");
    }
    if (!g_effect_owner.context().stopped()) fail("stop_latch_not_before_status");
    std::thread terminal([] {
        {
            const std::lock_guard<std::mutex> lock(mutex);
            terminalAttempted = true;
            changed.notify_all();
        }
        reportStatus(SERVICE_STOPPED);
        {
            const std::lock_guard<std::mutex> lock(mutex);
            terminalFinished = true;
            changed.notify_all();
        }
    });
    bool overtook = false;
    {
        std::unique_lock<std::mutex> lock(mutex);
        if (!changed.wait_for(lock, 5s, [] { return terminalAttempted; })) fail("terminal_attempt_timeout");
        overtook = changed.wait_for(lock, 200ms, [] { return terminalFinished; });
        releasePending = true;
        changed.notify_all();
        if (!changed.wait_for(lock, 5s, [] { return terminalFinished; })) fail("terminal_finish_timeout");
    }
    pending.join();
    terminal.join();
    if (overtook) fail("terminal_rpc_overtook_pending_rpc");
    reportStatus(SERVICE_STOPPED);
    serviceControlHandler(SERVICE_CONTROL_INTERROGATE, 0, nullptr, nullptr);
    serviceControlHandler(SERVICE_CONTROL_STOP, 0, nullptr, nullptr);
    serviceControlHandler(SERVICE_CONTROL_SHUTDOWN, 0, nullptr, nullptr);
    reportStatus(SERVICE_RUNNING);
    if (trace.size() != 4) fail("duplicate_or_post_terminal_status_rpc");
    const DWORD expected[] = {SERVICE_START_PENDING, SERVICE_RUNNING, SERVICE_STOP_PENDING, SERVICE_STOPPED};
    for (std::size_t i = 0; i < trace.size(); ++i) {
        if (trace[i].dwCurrentState != expected[i]) fail("status_transition_reordered");
        const DWORD controls = expected[i] == SERVICE_RUNNING ? SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN : 0;
        if (trace[i].dwControlsAccepted != controls) fail("controls_accepted_outside_running");
    }
}

void runCheckpoint() {
    if (g_worker_thread != nullptr) fail("checkpoint_probe_worker_preexists");
    g_status_handle = reinterpret_cast<SERVICE_STATUS_HANDLE>(static_cast<std::uintptr_t>(1));
    reportStatus(SERVICE_START_PENDING, NO_ERROR, 5'000);
    reportStatus(SERVICE_RUNNING);
    serviceControlHandler(SERVICE_CONTROL_STOP, 0, nullptr, nullptr);
    if (trace.size() != 3 || trace.back().dwCurrentState != SERVICE_STOP_PENDING) fail("checkpoint_stop_pending_missing");
    const DWORD checkpoint = trace.back().dwCheckPoint;
    for (int i = 0; i < 3; ++i) reportStatus(SERVICE_STOP_PENDING, NO_ERROR, 5'000);
    if (trace.size() != 3) fail("unchanged_pending_reported_progress");
    // Inject one failed RPC. An error update must not advance the checkpoint,
    // and suppressing the unchanged report must preserve its failed result.
    if (reportStatus(SERVICE_STOP_PENDING, 5, 5'000)) fail("pending_rpc_failure_hidden");
    if (trace.size() != 4 || trace.back().dwCheckPoint != checkpoint) fail("pending_error_incremented_checkpoint");
    if (reportStatus(SERVICE_STOP_PENDING, 5, 5'000)) fail("unchanged_failed_rpc_claimed_success");
    reportStatus(SERVICE_RUNNING);
    if (trace.size() != 4) fail("running_report_after_stop_latch");
    reportStatus(SERVICE_STOPPED);
    if (trace.size() != 5 || trace.back().dwCheckPoint != 0) fail("terminal_checkpoint_invalid");
}

#if !defined(GUARDIAN_STATUS_PORTABLE)
void runLifecycle() {
    if (mode == "before-start") serviceControlHandler(SERVICE_CONTROL_STOP, 0, nullptr, nullptr);
    std::thread service([] {
        serviceMain(0, nullptr);
        const std::lock_guard<std::mutex> lock(mutex);
        serviceFinished = true;
        changed.notify_all();
    });
    if (mode == "start-pending") {
        {
            std::unique_lock<std::mutex> lock(mutex);
            if (!changed.wait_for(lock, 5s, [] { return eventCreationEntered; })) fail("event_creation_enter_timeout");
        }
        serviceControlHandler(SERVICE_CONTROL_STOP, 0, nullptr, nullptr);
        if (!g_effect_owner.context().stopped()) fail("startup_stop_not_latched");
        {
            const std::lock_guard<std::mutex> lock(mutex);
            releaseEventCreation = true;
            changed.notify_all();
        }
    } else if (mode == "worker-join" || mode == "teardown") {
        {
            std::unique_lock<std::mutex> lock(mutex);
            if (!changed.wait_for(lock, 5s, [] { return workerEntered && !trace.empty()
                && trace.back().dwCurrentState == SERVICE_RUNNING; })) fail("running_worker_timeout");
        }
        serviceControlHandler(SERVICE_CONTROL_STOP, 0, nullptr, nullptr);
        if (mode == "worker-join") {
            std::unique_lock<std::mutex> lock(mutex);
            // Cross the service's former five-second teardown boundary.
            if (changed.wait_for(lock, 5'250ms, [] { return serviceFinished; })) fail("service_stopped_before_worker_exit");
            if (workerClosed || stopClosed) fail("handles_closed_before_worker_exit");
            std::size_t pendingCount = 0;
            for (const auto& status : trace) if (status.dwCurrentState == SERVICE_STOP_PENDING) ++pendingCount;
            if (pendingCount != 1) fail("join_wait_reported_fictitious_progress");
        }
        {
            const std::lock_guard<std::mutex> lock(mutex);
            releaseWorker = true;
            changed.notify_all();
        }
    }
    std::thread callback;
    if (mode == "teardown") {
        {
            std::unique_lock<std::mutex> lock(mutex);
            if (!changed.wait_for(lock, 5s, [] { return stopClosing; })) fail("stop_close_enter_timeout");
        }
        callback = std::thread([] {
            {
                const std::lock_guard<std::mutex> lock(mutex);
                callbackAttempted = true;
                changed.notify_all();
            }
            serviceControlHandler(SERVICE_CONTROL_SHUTDOWN, 0, nullptr, nullptr);
            {
                const std::lock_guard<std::mutex> lock(mutex);
                callbackFinished = true;
                changed.notify_all();
            }
        });
        bool overtook = false;
        {
            std::unique_lock<std::mutex> lock(mutex);
            if (!changed.wait_for(lock, 5s, [] { return callbackAttempted; })) fail("teardown_callback_attempt_timeout");
            overtook = changed.wait_for(lock, 200ms, [] { return callbackFinished; });
            releaseStopClose = true;
            changed.notify_all();
        }
        if (overtook) fail("callback_borrowed_handle_during_close");
    }
    {
        std::unique_lock<std::mutex> lock(mutex);
        if (!changed.wait_for(lock, 5s, [] { return serviceFinished; })) fail("service_stop_timeout");
    }
    service.join();
    if (callback.joinable()) callback.join();
    std::size_t stoppedCount = 0;
    bool stopping = false;
    for (const auto& status : trace) {
        if (status.dwCurrentState == SERVICE_STOP_PENDING) stopping = true;
        if (stopping && status.dwCurrentState == SERVICE_RUNNING) fail("running_report_after_stop_pending");
        if (status.dwCurrentState == SERVICE_STOPPED) ++stoppedCount;
        if (status.dwCurrentState != SERVICE_RUNNING && status.dwControlsAccepted != 0) fail("pending_controls_nonzero");
    }
    if (!stopping || stoppedCount != 1 || !workerClosed || !stopClosed) fail("lifecycle_terminal_proof_missing");
    if (g_stop_event != nullptr || g_worker_thread != nullptr) fail("closed_handle_still_published");
}
#endif
}

int main(int argc, char** argv) {
    using namespace status_probe;
    mode = argc == 2 ? argv[1] : "status";
    if (mode == "status") runStatusOrdering();
    else if (mode == "checkpoint") runCheckpoint();
#if !defined(GUARDIAN_STATUS_PORTABLE)
    else if (mode == "before-start" || mode == "start-pending" || mode == "worker-join" || mode == "teardown") runLifecycle();
#endif
    else fail("unknown_probe_case");
    std::cout << "{\"schema\":\"metaengine.browser-guardian.scm-status-runtime-proof.v1\",\"ok\":true,\"case\":\"" << mode
        << "\",\"scm_rpc_instrumented\":true,\"production_worker_exercised\":false,\"windows_kernel_exercised\":"
#if defined(GUARDIAN_STATUS_PORTABLE)
        << "false"
#else
        << "true"
#endif
        << ",\"scm_installation_exercised\":false,\"installer_dispatch_exercised\":false,\"authority_effect\":false}\n";
    return 0;
}
