#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <array>
#include <iostream>
#include <string>
#include <string_view>

#include "browser-guardian-owner-enrollment-observer.hpp"
#include "browser-guardian-owner-enrollment-store.hpp"
#include "browser-guardian-update-actuator.hpp"

namespace {

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

bool reportStatus(DWORD state, DWORD win32_exit_code = NO_ERROR, DWORD wait_hint_ms = 0) {
    if (g_status_handle == nullptr) return false;

    g_status.dwServiceType = SERVICE_WIN32_OWN_PROCESS;
    g_status.dwCurrentState = state;
    g_status.dwWin32ExitCode = win32_exit_code;
    g_status.dwServiceSpecificExitCode = 0;
    g_status.dwWaitHint = wait_hint_ms;
    g_status.dwControlsAccepted = (state == SERVICE_START_PENDING)
        ? 0
        : (SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN);

    if (state == SERVICE_RUNNING || state == SERVICE_STOPPED) {
        g_status.dwCheckPoint = 0;
    } else {
        g_status.dwCheckPoint = g_checkpoint++;
    }

    return SetServiceStatus(g_status_handle, &g_status) != FALSE;
}

DWORD WINAPI serviceControlHandler(
    DWORD control,
    DWORD /*event_type*/,
    LPVOID /*event_data*/,
    LPVOID /*context*/) {
    switch (control) {
        case SERVICE_CONTROL_STOP:
        case SERVICE_CONTROL_SHUTDOWN:
            if (g_status.dwCurrentState == SERVICE_RUNNING) {
                reportStatus(SERVICE_STOP_PENDING, NO_ERROR, 5'000);
                if (g_stop_event != nullptr) SetEvent(g_stop_event);
            }
            return NO_ERROR;
        case SERVICE_CONTROL_INTERROGATE:
            reportStatus(g_status.dwCurrentState, g_status.dwWin32ExitCode, g_status.dwWaitHint);
            return NO_ERROR;
        default:
            return ERROR_CALL_NOT_IMPLEMENTED;
    }
}

bool waitOverlapped(HANDLE pipe, OVERLAPPED* operation) {
    HANDLE handles[] = {g_stop_event, operation->hEvent};
    const DWORD wait = WaitForMultipleObjects(2, handles, FALSE, INFINITE);
    if (wait == WAIT_OBJECT_0) {
        CancelIoEx(pipe, operation);
        return false;
    }
    if (wait != WAIT_OBJECT_0 + 1) return false;
    DWORD transferred = 0;
    return GetOverlappedResult(pipe, operation, &transferred, FALSE) != FALSE;
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
        if (wait == WAIT_OBJECT_0) {
            CancelIoEx(pipe, &operation);
        } else if (wait == WAIT_OBJECT_0 + 1) {
            ok = GetOverlappedResult(pipe, &operation, &read, FALSE) != FALSE;
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
        if (wait == WAIT_OBJECT_0) {
            CancelIoEx(pipe, &operation);
        } else if (wait == WAIT_OBJECT_0 + 1) {
            ok = GetOverlappedResult(pipe, &operation, &written, FALSE) != FALSE;
        }
    }
    CloseHandle(event);
    return ok && written == bytes;
}

DWORD WINAPI updateActuatorWorker(LPVOID /*context*/) {
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
            result = handleGuardianUpdateActuatorRequest(request, client, owner);
        }
        const std::string response = serializeGuardianUpdateActuatorResult(result);
        writeResponse(pipe.handle(), response);
    }
    return 0;
}

void WINAPI serviceMain(DWORD /*argc*/, LPWSTR* /*argv*/) {
    g_status = {};
    g_checkpoint = 1;
    g_status_handle = RegisterServiceCtrlHandlerExW(kServiceName, serviceControlHandler, nullptr);
    if (g_status_handle == nullptr) return;

    reportStatus(SERVICE_START_PENDING, NO_ERROR, 5'000);

    g_stop_event = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (g_stop_event == nullptr) {
        reportStatus(SERVICE_STOPPED, GetLastError(), 0);
        return;
    }
    g_worker_thread = CreateThread(nullptr, 0, updateActuatorWorker, nullptr, 0, nullptr);
    if (g_worker_thread == nullptr) {
        const DWORD error = GetLastError();
        CloseHandle(g_stop_event);
        g_stop_event = nullptr;
        reportStatus(SERVICE_STOPPED, error, 0);
        return;
    }

    reportStatus(SERVICE_RUNNING, NO_ERROR, 0);

    const DWORD wait_result = WaitForSingleObject(g_stop_event, INFINITE);
    const DWORD wait_error = wait_result == WAIT_FAILED ? GetLastError() : NO_ERROR;
    SetEvent(g_stop_event);
    WaitForSingleObject(g_worker_thread, 5'000);
    CloseHandle(g_worker_thread);
    g_worker_thread = nullptr;
    CloseHandle(g_stop_event);
    g_stop_event = nullptr;

    reportStatus(SERVICE_STOPPED, wait_error, 0);
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
