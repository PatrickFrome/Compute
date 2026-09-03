#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <iostream>
#include <string_view>

namespace {

constexpr wchar_t kServiceName[] = L"METAENGINEBrowserGuardian";
constexpr wchar_t kServiceDisplayName[] = L"METAENGINE Browser Guardian";
constexpr char kContractJson[] =
    "{\"schema\":\"metaengine.browser-guardian.scm-host.v1\","
    "\"version\":\"1.0.0\","
    "\"service_name\":\"METAENGINEBrowserGuardian\","
    "\"service_display_name\":\"METAENGINE Browser Guardian\","
    "\"service_type\":\"SERVICE_WIN32_OWN_PROCESS\","
    "\"accepted_controls\":[\"STOP\",\"SHUTDOWN\"],"
    "\"browser_authority\":false,"
    "\"task_authority\":false,"
    "\"scheduler_authority\":false,"
    "\"page_model_text_authority\":false,"
    "\"release_authority\":false,"
    "\"process_effect_authority\":false,"
    "\"automatic_retry_allowed\":false,"
    "\"child_process_dispatch_implemented\":false,"
    "\"service_installation_implemented\":false,"
    "\"authority_effect\":false}";

SERVICE_STATUS_HANDLE g_status_handle = nullptr;
SERVICE_STATUS g_status{};
HANDLE g_stop_event = nullptr;
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

    // This first SCM slice deliberately owns no Browser/process effect. It proves a
    // failure domain above Electron and a real SCM lifecycle handshake only. A later
    // durable controller slice may bind the existing Guardian planner/journal/executor
    // behind this host without moving page/task/scheduler authority into the service.
    reportStatus(SERVICE_RUNNING, NO_ERROR, 0);

    const DWORD wait_result = WaitForSingleObject(g_stop_event, INFINITE);
    const DWORD wait_error = wait_result == WAIT_FAILED ? GetLastError() : NO_ERROR;

    CloseHandle(g_stop_event);
    g_stop_event = nullptr;

    reportStatus(SERVICE_STOPPED, wait_error, 0);
}

int printContract() {
    std::cout << kContractJson << '\n';
    return 0;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
    for (int i = 1; i < argc; ++i) {
        const std::wstring_view arg(argv[i] == nullptr ? L"" : argv[i]);
        if (arg == L"--contract-json") return printContract();
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
