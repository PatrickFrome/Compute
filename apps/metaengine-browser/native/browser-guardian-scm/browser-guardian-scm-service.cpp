#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <array>
#include <iostream>
#include <mutex>
#include <string>
#include <string_view>

#include "browser-guardian-owner-enrollment-observer.hpp"
#include "browser-guardian-owner-enrollment-store.hpp"
#include "browser-guardian-update-actuator.hpp"
#include "browser-guardian-pipe-io-lifetime.hpp"

namespace metaengine::guardian {
// Sole production constructor for the revocation context. Never exported via
// JSON, the pipe protocol, environment/configuration or an optional callback.
class GuardianScmEffectOwner final {
public:
    const GuardianEffectAdmission& context() const noexcept { return context_; }
    void requestStop() noexcept { context_.stop(); }
#ifdef _WIN32
    void joinChildren() noexcept { children_.join(); }
#endif
private:
#ifdef _WIN32
    GuardianChildCustody children_;
    GuardianEffectAdmission context_{children_};
#else
    // Portable status extraction has no Windows child processes.
    GuardianEffectAdmission context_;
#endif
};
}

namespace {
metaengine::guardian::GuardianScmEffectOwner g_effect_owner;

constexpr wchar_t kServiceName[] = L"METAENGINEBrowserGuardian";
constexpr wchar_t kServiceDisplayName[] = L"METAENGINE Browser Guardian";
constexpr DWORD kMaxRequestBytes = 16 * 1024;
constexpr char kContractJson[] =
    "{\"schema\":\"metaengine.browser-guardian.scm-host.v1\","
    "\"version\":\"1.1.0\","
    "\"protocol_generation\":2,"
    "\"features\":{"
      "\"scm_service_dispatcher_v1\":true,"
      "\"scm_status_handshake_v1\":true,"
      "\"bounded_stop_shutdown_controls_v1\":true,"
      "\"read_only_contract_probe_v1\":true,"
      "\"bounded_update_actuator_v1\":true},"
    "\"service_name\":\"METAENGINEBrowserGuardian\","
    "\"service_display_name\":\"METAENGINE Browser Guardian\","
    "\"service_type\":\"SERVICE_WIN32_OWN_PROCESS\","
    "\"accepted_controls\":[\"STOP\",\"SHUTDOWN\"],"
    "\"update_pipe\":\"\\\\\\\\.\\\\pipe\\\\METAENGINEBrowserGuardianUpdateV1\","
    "\"browser_authority\":false,"
    "\"task_authority\":false,"
    "\"scheduler_authority\":false,"
    "\"second_scheduler_loop\":false,"
    "\"page_model_text_authority\":false,"
    "\"release_authority\":false,"
    "\"process_effect_policy_authority\":false,"
    "\"bounded_process_effect_adapter\":true,"
    "\"automatic_retry_allowed\":false,"
    "\"child_process_dispatch_implemented\":true,"
    "\"native_write_ahead_effect_barrier\":true,"
    "\"service_installation_implemented\":false,"
    "\"authority_effect\":false}";

SERVICE_STATUS_HANDLE g_status_handle = nullptr;
SERVICE_STATUS g_status{};
HANDLE g_stop_event = nullptr;
HANDLE g_worker_thread = nullptr;
DWORD g_checkpoint = 1;
std::mutex g_status_mutex;
bool g_stopped_reported = false;
bool g_last_status_report_succeeded = false;

// Hold the lock through the RPC, not merely while copying SERVICE_STATUS: a
// final STOPPED report must never overtake an in-flight pending-state report.
bool reportStatusLocked(DWORD state, DWORD win32_exit_code, DWORD wait_hint_ms) {
    if (g_status_handle == nullptr) return false;
    if (g_stopped_reported) return state == SERVICE_STOPPED && g_last_status_report_succeeded;
    if (g_status.dwCurrentState == SERVICE_STOP_PENDING
        && state != SERVICE_STOP_PENDING && state != SERVICE_STOPPED) return false;
    if ((state == SERVICE_START_PENDING || state == SERVICE_RUNNING)
        && g_effect_owner.context().stopped()) {
        state = SERVICE_STOP_PENDING;
        wait_hint_ms = 5'000;
    }
    const DWORD previousState = g_status.dwCurrentState;
    if (previousState == state && g_status.dwWin32ExitCode == win32_exit_code
        && g_status.dwWaitHint == wait_hint_ms) return g_last_status_report_succeeded;

    g_status.dwServiceType = SERVICE_WIN32_OWN_PROCESS;
    g_status.dwCurrentState = state;
    g_status.dwWin32ExitCode = win32_exit_code;
    g_status.dwServiceSpecificExitCode = 0;
    g_status.dwWaitHint = wait_hint_ms;
    g_status.dwControlsAccepted = (state == SERVICE_RUNNING)
        ? (SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN)
        : 0;

    if (state == SERVICE_RUNNING || state == SERVICE_STOPPED) {
        g_status.dwCheckPoint = 0;
    } else if (previousState != state) {
        g_status.dwCheckPoint = g_checkpoint++;
    }

    // The first STOPPED RPC closes its context. Even a failed return is not
    // permission to retry that terminal RPC or publish another state afterward.
    if (state == SERVICE_STOPPED) g_stopped_reported = true;
    g_last_status_report_succeeded = SetServiceStatus(g_status_handle, &g_status) != FALSE;
    return g_last_status_report_succeeded;
}

bool reportStatus(DWORD state, DWORD win32_exit_code = NO_ERROR, DWORD wait_hint_ms = 0) {
    const std::lock_guard<std::mutex> lock(g_status_mutex);
    return reportStatusLocked(state, win32_exit_code, wait_hint_ms);
}

DWORD WINAPI serviceControlHandler(
    DWORD control,
    DWORD /*event_type*/,
    LPVOID /*event_data*/,
    LPVOID /*context*/) {
    switch (control) {
        case SERVICE_CONTROL_STOP:
        case SERVICE_CONTROL_SHUTDOWN: {
            g_effect_owner.requestStop(); // Linearize refusal BEFORE status/event publication.
            const std::lock_guard<std::mutex> lock(g_status_mutex);
            if (!g_stopped_reported) {
                reportStatusLocked(SERVICE_STOP_PENDING, NO_ERROR, 5'000);
                if (g_stop_event != nullptr) SetEvent(g_stop_event);
            }
            return NO_ERROR;
        }
        case SERVICE_CONTROL_INTERROGATE:
            // There is no state transition to report. In particular, never
            // reuse a context that a concurrent final STOPPED RPC has closed.
            return NO_ERROR;
        default:
            return ERROR_CALL_NOT_IMPLEMENTED;
    }
}

bool waitOverlapped(HANDLE pipe, OVERLAPPED* operation) {
    HANDLE handles[] = {g_stop_event, operation->hEvent};
    const DWORD wait = WaitForMultipleObjects(2, handles, FALSE, INFINITE);
    if (wait != WAIT_OBJECT_0 + 1) {
        metaengine::guardian::cancelAndJoinGuardianPipeIo(pipe, operation);
        return false;
    }
    DWORD transferred = 0;
    const bool completed = GetOverlappedResult(pipe, operation, &transferred, FALSE) != FALSE;
    if (!completed && !HasOverlappedIoCompleted(operation))
        metaengine::guardian::cancelAndJoinGuardianPipeIo(pipe, operation);
    return completed;
}

bool connectPipe(metaengine::guardian::OwnerEnrollmentPipe* pipe) {
    if (pipe == nullptr || !pipe->valid()) return false;
    HANDLE event = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (event == nullptr) return false;
    OVERLAPPED operation{};
    operation.hEvent = event;
    bool connected = false;
    if (ConnectNamedPipe(pipe->handle(), &operation) != FALSE) {
        connected = true;
    } else {
        const DWORD error = GetLastError();
        if (error == ERROR_PIPE_CONNECTED) connected = true;
        else if (error == ERROR_IO_PENDING) connected = waitOverlapped(pipe->handle(), &operation);
    }
    CloseHandle(event);
    return connected;
}

bool readRequest(HANDLE pipe, std::string* output) {
    if (output == nullptr) return false;
    std::array<char, kMaxRequestBytes + 1> buffer{};
    HANDLE event = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (event == nullptr) return false;
    OVERLAPPED operation{};
    operation.hEvent = event;
    DWORD read = 0;
    bool ok = false;
    if (ReadFile(pipe, buffer.data(), kMaxRequestBytes, &read, &operation) != FALSE) {
        ok = true;
    } else if (GetLastError() == ERROR_IO_PENDING) {
        HANDLE handles[] = {g_stop_event, event};
        const DWORD wait = WaitForMultipleObjects(2, handles, FALSE, INFINITE);
        if (wait == WAIT_OBJECT_0 + 1) {
            ok = GetOverlappedResult(pipe, &operation, &read, FALSE) != FALSE;
            if (!ok && !HasOverlappedIoCompleted(&operation))
                metaengine::guardian::cancelAndJoinGuardianPipeIo(pipe, &operation);
        } else {
            metaengine::guardian::cancelAndJoinGuardianPipeIo(pipe, &operation);
        }
    }
    CloseHandle(event);
    if (!ok || read == 0 || read > kMaxRequestBytes) return false;
    output->assign(buffer.data(), buffer.data() + read);
    return !output->empty() && output->back() == '\n';
}

bool writeResponse(HANDLE pipe, const std::string& response) {
    if (response.empty() || response.size() > kMaxRequestBytes) return false;
    HANDLE event = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (event == nullptr) return false;
    OVERLAPPED operation{};
    operation.hEvent = event;
    DWORD written = 0;
    bool ok = false;
    const DWORD bytes = static_cast<DWORD>(response.size());
    if (WriteFile(pipe, response.data(), bytes, &written, &operation) != FALSE) {
        ok = true;
    } else if (GetLastError() == ERROR_IO_PENDING) {
        HANDLE handles[] = {g_stop_event, event};
        const DWORD wait = WaitForMultipleObjects(2, handles, FALSE, INFINITE);
        if (wait == WAIT_OBJECT_0 + 1) {
            ok = GetOverlappedResult(pipe, &operation, &written, FALSE) != FALSE;
            if (!ok && !HasOverlappedIoCompleted(&operation))
                metaengine::guardian::cancelAndJoinGuardianPipeIo(pipe, &operation);
        } else {
            metaengine::guardian::cancelAndJoinGuardianPipeIo(pipe, &operation);
        }
    }
    CloseHandle(event);
    return ok && written == bytes;
}

DWORD WINAPI updateActuatorWorker(LPVOID /*context*/) try {
    using namespace metaengine::guardian;
    while (WaitForSingleObject(g_stop_event, 0) == WAIT_TIMEOUT) {
        OwnerEnrollmentPipe pipe;
        if (!pipe.create(kBrowserGuardianUpdatePipeName)) {
            if (WaitForSingleObject(g_stop_event, 1'000) != WAIT_TIMEOUT) break;
            continue;
        }
        if (!connectPipe(&pipe)) {
            if (WaitForSingleObject(g_stop_event, 0) != WAIT_TIMEOUT) break;
            continue;
        }

        std::string request;
        GuardianUpdateActuatorResult result;
        if (!readRequest(pipe.handle(), &request)) {
            result.state = "NO_EFFECT_PROVEN";
            result.reason = "PIPE_REQUEST_READ_FAILED";
            result.win32_error = GetLastError();
            result.effect_absent_proven = true;
        } else {
            const OwnerEnrollmentObservation client = pipe.observeClientIdentity(true);
            const OwnerEnrollmentStore store(browserGuardianOwnerEnrollmentStoreDefaultRoot());
            const OwnerEnrollmentStoreResult owner = store.read();
            result = handleGuardianUpdateActuatorRequest(request, client, owner, &g_effect_owner.context());
        }
        const std::string response = serializeGuardianUpdateActuatorResult(result);
        writeResponse(pipe.handle(), response);
    }
    return 0;
} catch (...) {
    // Post-CREATE allocations, journal/result construction or response work
    // cannot unwind original child custody out of the SCM owner. Fail closed
    // without claiming an effect outcome. The stop handle outlives this worker.
    g_effect_owner.requestStop();
    SetEvent(g_stop_event);
    return ERROR_UNHANDLED_EXCEPTION;
}

void WINAPI serviceMain(DWORD /*argc*/, LPWSTR* /*argv*/) {
    {
        const std::lock_guard<std::mutex> lock(g_status_mutex);
        g_status = {};
        g_checkpoint = 1;
        g_stopped_reported = false;
        g_last_status_report_succeeded = false;
        g_status_handle = nullptr;
    }
    const SERVICE_STATUS_HANDLE statusHandle =
        RegisterServiceCtrlHandlerExW(kServiceName, serviceControlHandler, nullptr);
    if (statusHandle == nullptr) return;
    {
        const std::lock_guard<std::mutex> lock(g_status_mutex);
        g_status_handle = statusHandle;
    }

    reportStatus(SERVICE_START_PENDING, NO_ERROR, 5'000);

    const HANDLE stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (stopEvent == nullptr) {
        const DWORD error = GetLastError();
        g_effect_owner.requestStop();
        reportStatus(SERVICE_STOPPED, error, 0);
        return;
    }
    {
        const std::lock_guard<std::mutex> lock(g_status_mutex);
        g_stop_event = stopEvent;
        // A STOP can arrive during START_PENDING, before the event exists.
        // The irreversible admission latch carries that request across publish.
        if (g_effect_owner.context().stopped()) SetEvent(g_stop_event);
    }
    g_worker_thread = CreateThread(nullptr, 0, updateActuatorWorker, nullptr, 0, nullptr);
    if (g_worker_thread == nullptr) {
        const DWORD error = GetLastError();
        g_effect_owner.requestStop();
        {
            const std::lock_guard<std::mutex> lock(g_status_mutex);
            CloseHandle(g_stop_event);
            g_stop_event = nullptr;
        }
        reportStatus(SERVICE_STOPPED, error, 0);
        return;
    }

    reportStatus(SERVICE_RUNNING, NO_ERROR, 0);

    const DWORD wait_result = WaitForSingleObject(g_stop_event, INFINITE);
    const DWORD wait_error = wait_result == WAIT_FAILED ? GetLastError() : NO_ERROR;
    g_effect_owner.requestStop();
    SetEvent(g_stop_event);
    reportStatus(SERVICE_STOP_PENDING, wait_error, 5'000);
    // A timeout is not worker exit. In particular a cancelled overlapped
    // operation still owns its stack buffers/event until physical completion.
    for (;;) {
        const DWORD workerWait = WaitForSingleObject(g_worker_thread, 5'000);
        if (workerWait == WAIT_OBJECT_0) break;
        // Merely waiting is not shutdown progress. Retain the pending state and
        // original checkpoint; do not make a hung worker appear to progress.
        if (workerWait != WAIT_TIMEOUT) Sleep(5'000);
    }
    // A signalled stop event proves neither successful worker execution nor
    // its exit code. Preserve a caught worker failure for SCM's existing
    // non-crash recovery policy, without treating failed readback as success.
    DWORD final_error = wait_error;
    DWORD worker_exit = NO_ERROR;
    if (!GetExitCodeThread(g_worker_thread, &worker_exit)) {
        const DWORD error = GetLastError();
        if (final_error == NO_ERROR) final_error = error == NO_ERROR ? ERROR_GEN_FAILURE : error;
    } else if (final_error == NO_ERROR) {
        final_error = worker_exit;
    }
    // Worker exit is not child exit. CREATE output slots were registered
    // before the API, including admitted work racing STOP. Drain originals
    // only after the sole writer/borrower exited, without the status mutex.
    // Timeouts/API failures remain STOP_PENDING with the original checkpoint.
    // Current fresh-only installers do not request Guardian stop. Future
    // in-place service replacement requires terminal completion or a reviewed
    // authenticated handoff; this join does not qualify replacement support.
    g_effect_owner.joinChildren();
    {
        // A callback cannot borrow the stop handle while teardown closes it.
        const std::lock_guard<std::mutex> lock(g_status_mutex);
        CloseHandle(g_worker_thread);
        g_worker_thread = nullptr;
        CloseHandle(g_stop_event);
        g_stop_event = nullptr;
    }

    reportStatus(SERVICE_STOPPED, final_error, 0);
}

int printContract() {
    std::cout << kContractJson << '\n';
    return 0;
}

int printActuatorContract() {
    std::cout << metaengine::guardian::browserGuardianUpdateActuatorContractJson() << '\n';
    return 0;
}

int runActuatorSelfTest() {
    const bool ok = metaengine::guardian::browserGuardianUpdateActuatorSelfTest();
    std::cout << "{\"schema\":\"metaengine.browser-guardian.update-actuator-self-test.v1\",\"ok\":"
              << (ok ? "true" : "false")
              << ",\"authority_effect\":false}\n";
    return ok ? 0 : 1;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
    for (int i = 1; i < argc; ++i) {
        const std::wstring_view arg(argv[i] == nullptr ? L"" : argv[i]);
        if (arg == L"--contract-json") return printContract();
        if (arg == L"--update-actuator-contract-json") return printActuatorContract();
        if (arg == L"--update-actuator-self-test") return runActuatorSelfTest();
    }

    SERVICE_TABLE_ENTRYW dispatch_table[] = {
        {const_cast<LPWSTR>(kServiceName), serviceMain},
        {nullptr, nullptr},
    };

    if (StartServiceCtrlDispatcherW(dispatch_table) == FALSE) {
        const DWORD error = GetLastError();
        if (error == ERROR_FAILED_SERVICE_CONTROLLER_CONNECT) {
            std::wcerr << kServiceDisplayName
                       << L" must be started by Windows Service Control Manager; use --contract-json for a read-only probe.\n";
        }
        return static_cast<int>(error == 0 ? ERROR_GEN_FAILURE : error);
    }
    return 0;
}
