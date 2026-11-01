// Windows-only lifecycle regression of the ACTUAL serviceMain and launcher.
// The SCM RPC and the service worker entry are instrumented; the launcher uses
// the current OS primary token/SID/session and the real CreateProcessAsUserW.
// The only child is this executable's harmless /S branch. No ticket, device
// signature, authenticated request, installer, installed SCM service or policy
// change is exercised. Compile this TU instead of a separate actuator.cpp.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <tlhelp32.h>
#include <sddl.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdlib>
#include <cwchar>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "../../native/browser-guardian-scm/browser-guardian-update-actuator.hpp"

namespace child_ownership_probe {
using namespace std::chrono_literals;

struct Handle final {
    HANDLE value = nullptr;
    explicit Handle(HANDLE handle = nullptr) : value(handle) {}
    ~Handle() { if (valid()) ::CloseHandle(value); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    bool valid() const noexcept { return value != nullptr && value != INVALID_HANDLE_VALUE; }
    HANDLE get() const noexcept { return value; }
};

std::mutex mutex;
std::condition_variable changed;
std::atomic<bool> emitted{false};
bool running = false, stopped = false, serviceFinished = false, workerFinished = false;
bool serviceEntered = false, launcherEntered = false;
bool watchdogFinished = false, stoppedWhileChildActive = false;
bool helperReady = false, helperReleased = false, cleanupProven = false;
bool helperExitReadback = false;
bool rescueTerminationUsed = false, strictRequired = false;
unsigned stoppedReports = 0;
HANDLE token = nullptr, readyEvent = nullptr, releaseEvent = nullptr;
HANDLE child = nullptr, serviceWorker = nullptr;
DWORD session = 0, childPid = 0, fixtureError = ERROR_SUCCESS;
DWORD helperExitCode = STILL_ACTIVE;
std::uint64_t childBirth = 0;
std::wstring selfPath, ownerSid;
std::string fixtureReason;
metaengine::guardian::GuardianUpdateActuatorResult launch;

std::string escaped(const std::string& value) {
    std::string result;
    for (const unsigned char c : value) {
        if (c == '"' || c == '\\') { result.push_back('\\'); result.push_back(static_cast<char>(c)); }
        else if (c >= 0x20) result.push_back(static_cast<char>(c));
    }
    return result;
}

void emit(bool diagnosticOk, const char* outcome, int satisfied) {
    if (emitted.exchange(true)) return;
    const std::lock_guard<std::mutex> lock(mutex);
    const bool noCreate = launch.reason == "CREATE_PROCESS_AS_USER_FAILED"
        || launch.reason == "USER_ENVIRONMENT_BLOCK_FAILED" || launch.reason == "USER_TOKEN_INVALID"
        || launch.reason == "SERVICE_STOP_BEFORE_INSTALLER_CREATE";
    // Post-create readback/cleanup failures do not prove that no process was
    // created. Preserve that uncertainty instead of equating it to DISPATCHED.
    const char* creation = launch.state == "DISPATCHED" ? "true" : noCreate ? "false" : "null";
    std::cout << "{\"schema\":\"metaengine.browser-guardian.scm-child-ownership-runtime-proof.v1\","
        << "\"ok\":" << (diagnosticOk ? "true" : "false")
        << ",\"diagnostic_only\":true,\"outcome\":\"" << outcome << "\","
        << "\"original_child_ownership_satisfied\":" << (satisfied < 0 ? "null" : satisfied ? "true" : "false")
        << ",\"require_owned_child_join\":" << (strictRequired ? "true" : "false")
        << ",\"actual_service_main_exercised\":" << (serviceEntered ? "true" : "false")
        << ",\"actual_launcher_exercised\":" << (launcherEntered ? "true" : "false")
        << ",\"actual_os_create_as_user_fixture\":" << creation
        << ",\"actual_os_create_as_user_succeeded\":" << creation
        << ",\"scm_rpc_instrumented\":true,\"production_worker_exercised\":false,"
        << "\"authenticated_request\":false,\"windows_kernel_exercised\":true,"
        << "\"scm_installation_exercised\":false,\"installer_dispatch_exercised\":false,"
        << "\"test_fixture_process_effect\":" << creation
        << ",\"fixture_observation_handle_retained\":" << (child != nullptr ? "true" : "false")
        << ",\"fixture_observation_counts_as_service_custody\":false"
        << ",\"helper_ready\":" << (helperReady ? "true" : "false")
        << ",\"stopped_while_child_active\":" << (stoppedWhileChildActive ? "true" : "false")
        << ",\"stopped_reports\":" << stoppedReports
        << ",\"helper_released\":" << (helperReleased ? "true" : "false")
        << ",\"child_cleanup_proven\":" << (cleanupProven ? "true" : "false")
        << ",\"helper_exit_code\":" << (helperExitReadback ? std::to_string(helperExitCode) : "null")
        << ",\"helper_rescue_termination_used\":" << (rescueTerminationUsed ? "true" : "false")
        << ",\"launch_state\":\"" << escaped(launch.state) << "\","
        << "\"launch_reason\":\"" << escaped(launch.reason) << "\","
        << "\"launch_win32_error\":" << launch.win32_error
        << ",\"blocked_reason\":\"" << escaped(fixtureReason) << "\","
        << "\"fixture_win32_error\":" << fixtureError
        << ",\"authority_effect\":false}\n" << std::flush;
}

void block(const char* reason, DWORD error = ERROR_SUCCESS) {
    const std::lock_guard<std::mutex> lock(mutex);
    if (fixtureReason.empty()) { fixtureReason = reason; fixtureError = error; }
    changed.notify_all();
}

std::uint64_t birthTime(const FILETIME& value) noexcept {
    ULARGE_INTEGER raw{};
    raw.LowPart = value.dwLowDateTime;
    raw.HighPart = value.dwHighDateTime;
    return raw.QuadPart;
}

std::wstring executablePath() {
    std::vector<wchar_t> buffer(32'768);
    const DWORD size = ::GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
    if (size == 0 || size >= buffer.size()) return {};
    return std::wstring(buffer.data(), size);
}

std::wstring eventName(DWORD parent, const wchar_t* suffix) {
    // Deterministic across parent and same-image /S child; parent PID prevents
    // concurrent invocations of the same test binary sharing an event slot.
    std::uint64_t hash = 14695981039346656037ULL;
    for (const wchar_t c : selfPath) { hash ^= static_cast<std::uint16_t>(c); hash *= 1099511628211ULL; }
    return L"Local\\METAENGINEGuardianChildOwnership-" + std::to_wstring(parent)
        + L"-" + std::to_wstring(hash) + L"-" + suffix;
}

DWORD parentPid() {
    Handle snapshot(::CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
    if (!snapshot.valid()) return 0;
    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);
    if (!::Process32FirstW(snapshot.get(), &entry)) return 0;
    do {
        if (entry.th32ProcessID == ::GetCurrentProcessId()) return entry.th32ParentProcessID;
    } while (::Process32NextW(snapshot.get(), &entry));
    return 0;
}

int runHelper() {
    selfPath = executablePath();
    const DWORD parent = parentPid();
    if (selfPath.empty() || parent == 0) return 2;
    Handle ready(::OpenEventW(EVENT_MODIFY_STATE, FALSE, eventName(parent, L"ready").c_str()));
    Handle release(::OpenEventW(SYNCHRONIZE, FALSE, eventName(parent, L"release").c_str()));
    if (!ready.valid() || !release.valid() || !::SetEvent(ready.get())) return 2;
    // The helper changes no data and eventually exits even if the probe dies.
    return ::WaitForSingleObject(release.get(), 30'000) == WAIT_OBJECT_0 ? 0 : 2;
}

bool exactHelperHandle(HANDLE handle) {
    if (handle == nullptr || handle == INVALID_HANDLE_VALUE || childPid == 0
        || childPid == ::GetCurrentProcessId() || ::GetProcessId(handle) != childPid) return false;
    FILETIME created{}, exited{}, kernel{}, user{};
    if (!::GetProcessTimes(handle, &created, &exited, &kernel, &user)
        || birthTime(created) != childBirth) return false;
    std::vector<wchar_t> buffer(32'768);
    DWORD size = static_cast<DWORD>(buffer.size());
    return ::QueryFullProcessImageNameW(handle, 0, buffer.data(), &size)
        && _wcsicmp(std::wstring(buffer.data(), size).c_str(), selfPath.c_str()) == 0;
}

bool releaseAndJoinHelper() {
    HANDLE observed = nullptr;
    {
        const std::lock_guard<std::mutex> lock(mutex);
        observed = child;
        if (releaseEvent != nullptr && ::SetEvent(releaseEvent)) helperReleased = true;
    }
    if (observed == nullptr) return false;
    if (::WaitForSingleObject(observed, 5'000) == WAIT_OBJECT_0) {
        DWORD exitCode = STILL_ACTIVE;
        const bool readback = ::GetExitCodeProcess(observed, &exitCode) != FALSE;
        const std::lock_guard<std::mutex> lock(mutex);
        cleanupProven = true;
        helperExitReadback = readback;
        helperExitCode = exitCode;
        return true;
    }
    // Rescue ONLY the exact same-image helper retained by this fixture. This is
    // not an installer cancellation policy or a kill-on-close production rule.
    if (!exactHelperHandle(observed)) return false;
    if (!::TerminateProcess(observed, ERROR_PROCESS_ABORTED)) return false;
    {
        const std::lock_guard<std::mutex> lock(mutex);
        rescueTerminationUsed = true;
    }
    if (::WaitForSingleObject(observed, 5'000) != WAIT_OBJECT_0) return false;
    DWORD exitCode = STILL_ACTIVE;
    const bool readback = ::GetExitCodeProcess(observed, &exitCode) != FALSE;
    const std::lock_guard<std::mutex> lock(mutex);
    cleanupProven = true;
    helperExitReadback = readback;
    helperExitCode = exitCode;
    return true;
}

BOOL WINAPI captureStatus(SERVICE_STATUS_HANDLE, LPSERVICE_STATUS status) {
    const std::lock_guard<std::mutex> lock(mutex);
    if (status->dwCurrentState == SERVICE_RUNNING) running = true;
    if (status->dwCurrentState == SERVICE_STOPPED) {
        stopped = true;
        ++stoppedReports;
        if (child != nullptr && ::WaitForSingleObject(child, 0) == WAIT_TIMEOUT) stoppedWhileChildActive = true;
    }
    changed.notify_all();
    return TRUE;
}

SERVICE_STATUS_HANDLE WINAPI registerStatus(LPCWSTR, LPHANDLER_FUNCTION_EX, LPVOID) {
    return reinterpret_cast<SERVICE_STATUS_HANDLE>(static_cast<ULONG_PTR>(1));
}

DWORD WINAPI controlledWorker(LPVOID);
HANDLE WINAPI createControlledWorker(LPSECURITY_ATTRIBUTES attributes, SIZE_T stackSize,
    LPTHREAD_START_ROUTINE, LPVOID, DWORD flags, LPDWORD id) {
    const HANDLE worker = ::CreateThread(attributes, stackSize, controlledWorker, nullptr, flags, id);
    {
        const std::lock_guard<std::mutex> lock(mutex);
        serviceWorker = worker; // Borrowed; actual serviceMain owns/joins/closes it.
    }
    return worker;
}
}

#define SetServiceStatus child_ownership_probe::captureStatus
#define RegisterServiceCtrlHandlerExW child_ownership_probe::registerStatus
#define CreateThread child_ownership_probe::createControlledWorker
#define wmain guardianServiceEntryForChildOwnershipProbe
#include "../../native/browser-guardian-scm/browser-guardian-scm-service.cpp"
#undef wmain
#undef CreateThread
#undef RegisterServiceCtrlHandlerExW
#undef SetServiceStatus
// All actuator OS calls below, including CreateProcessAsUserW, remain original.
#include "../../native/browser-guardian-scm/browser-guardian-update-actuator.cpp"

namespace child_ownership_probe {
DWORD WINAPI controlledWorker(LPVOID) {
    {
        std::unique_lock<std::mutex> lock(mutex);
        if (!changed.wait_for(lock, 5s, [] { return running; })) {
            fixtureReason = "SERVICE_RUNNING_NOT_OBSERVED";
            workerFinished = true;
            changed.notify_all();
            return 2;
        }
        launcherEntered = true;
    }
    auto result = metaengine::guardian::launchInstaller(selfPath, token, session, ownerSid, g_effect_owner.context());
    {
        const std::lock_guard<std::mutex> lock(mutex);
        launch = result;
    }
    if (result.state != "DISPATCHED") {
        block("ACTUAL_LAUNCHER_NOT_DISPATCHED", result.win32_error);
    } else {
        Handle observation(::OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE,
            FALSE, result.pid));
        {
            const std::lock_guard<std::mutex> lock(mutex);
            childPid = result.pid;
            childBirth = result.creation_time_100ns;
        }
        if (!observation.valid() || !exactHelperHandle(observation.get())) {
            block("EXACT_HELPER_OBSERVATION_UNAVAILABLE", ::GetLastError());
        } else {
            {
                const std::lock_guard<std::mutex> lock(mutex);
                child = observation.value;
                observation.value = nullptr; // Fixture observation, not service custody.
            }
            const DWORD readyWait = ::WaitForSingleObject(readyEvent, 8'000);
            if (readyWait != WAIT_OBJECT_0) block("SELF_HELPER_READY_NOT_OBSERVED", readyWait);
            else {
                const std::lock_guard<std::mutex> lock(mutex);
                helperReady = true;
            }
        }
    }
    {
        const std::lock_guard<std::mutex> lock(mutex);
        workerFinished = true;
        changed.notify_all();
    }
    return 0;
}

bool loadCurrentIdentity(Handle& primaryToken) {
    if (!::OpenProcessToken(::GetCurrentProcess(), TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY,
        &primaryToken.value)) { block("CURRENT_PRIMARY_TOKEN_UNAVAILABLE", ::GetLastError()); return false; }
    DWORD bytes = 0;
    ::GetTokenInformation(primaryToken.get(), TokenUser, nullptr, 0, &bytes);
    if (::GetLastError() != ERROR_INSUFFICIENT_BUFFER || bytes == 0) {
        block("CURRENT_TOKEN_USER_SIZE_UNAVAILABLE", ::GetLastError()); return false;
    }
    std::vector<unsigned char> storage(bytes);
    if (!::GetTokenInformation(primaryToken.get(), TokenUser, storage.data(), bytes, &bytes)) {
        block("CURRENT_TOKEN_USER_UNAVAILABLE", ::GetLastError()); return false;
    }
    const auto* user = reinterpret_cast<const TOKEN_USER*>(storage.data());
    LPWSTR sid = nullptr;
    if (!::ConvertSidToStringSidW(user->User.Sid, &sid) || sid == nullptr) {
        block("CURRENT_TOKEN_SID_UNAVAILABLE", ::GetLastError()); return false;
    }
    ownerSid = sid;
    ::LocalFree(sid);
    if (!::ProcessIdToSessionId(::GetCurrentProcessId(), &session)) {
        block("CURRENT_SESSION_UNAVAILABLE", ::GetLastError()); return false;
    }
    token = primaryToken.get();
    return true;
}

int runParent() {
    selfPath = executablePath();
    if (selfPath.empty()) { block("SELF_IMAGE_PATH_UNAVAILABLE", ::GetLastError()); emit(false, "BLOCKED", -1); return 2; }
    Handle primaryToken;
    if (!loadCurrentIdentity(primaryToken)) { emit(false, "BLOCKED", -1); return 2; }
    Handle ready(::CreateEventW(nullptr, TRUE, FALSE, eventName(::GetCurrentProcessId(), L"ready").c_str()));
    const DWORD readyError = ::GetLastError();
    if (!ready.valid() || readyError == ERROR_ALREADY_EXISTS) {
        block("READY_EVENT_NOT_EXCLUSIVE", readyError); emit(false, "BLOCKED", -1); return 2;
    }
    Handle release(::CreateEventW(nullptr, TRUE, FALSE, eventName(::GetCurrentProcessId(), L"release").c_str()));
    const DWORD releaseError = ::GetLastError();
    if (!release.valid() || releaseError == ERROR_ALREADY_EXISTS) {
        block("RELEASE_EVENT_NOT_EXCLUSIVE", releaseError); emit(false, "BLOCKED", -1); return 2;
    }
    readyEvent = ready.get();
    releaseEvent = release.get();
    std::thread watchdog([] {
        {
            std::unique_lock<std::mutex> lock(mutex);
            if (changed.wait_for(lock, 40s, [] { return watchdogFinished; })) return;
        }
        block("PROBE_WATCHDOG_TIMEOUT");
        releaseAndJoinHelper();
        emit(false, "BLOCKED", -1);
        std::_Exit(2);
    });
    std::thread service([] {
        {
            const std::lock_guard<std::mutex> lock(mutex);
            serviceEntered = true;
        }
        serviceMain(0, nullptr);
        const std::lock_guard<std::mutex> lock(mutex);
        serviceFinished = true;
        changed.notify_all();
    });
    {
        std::unique_lock<std::mutex> lock(mutex);
        if (!changed.wait_for(lock, 15s, [] { return workerFinished || serviceFinished; })) {
            fixtureReason = "CONTROLLED_WORKER_TIMEOUT";
        } else if (!workerFinished && fixtureReason.empty()) {
            fixtureReason = "SERVICE_EXITED_BEFORE_FIXTURE_WORKER";
        }
    }
    bool exercise = false;
    HANDLE worker = nullptr;
    HANDLE observedChild = nullptr;
    {
        const std::lock_guard<std::mutex> lock(mutex);
        exercise = fixtureReason.empty() && helperReady && child != nullptr && launch.state == "DISPATCHED";
        worker = serviceWorker;
        observedChild = child;
    }
    if (exercise && (worker == nullptr || ::WaitForSingleObject(worker, 5'000) != WAIT_OBJECT_0)) {
        block("CONTROLLED_WORKER_EXIT_NOT_OBSERVED"); exercise = false;
    }
    if (exercise && ::WaitForSingleObject(observedChild, 0) != WAIT_TIMEOUT) {
        block("HELPER_NOT_ACTIVE_AT_STOP"); exercise = false;
    }
    // Actual stop callback and actual serviceMain teardown run even when launch
    // was blocked. No caller flag or invented identity is substituted for auth.
    serviceControlHandler(SERVICE_CONTROL_STOP, 0, nullptr, nullptr);
    if (exercise) {
        std::unique_lock<std::mutex> lock(mutex);
        // A fixed owner must hold STOP_PENDING while the helper remains active.
        // Cross the service's five-second worker-join polling boundary.
        changed.wait_for(lock, 5'250ms, [] { return stopped; });
    }
    if (exercise && ::WaitForSingleObject(observedChild, 0) != WAIT_TIMEOUT) {
        block("HELPER_EXITED_BEFORE_RELEASE"); exercise = false;
    }
    const bool joined = releaseAndJoinHelper();
    if (exercise && !joined) block("EXACT_HELPER_CLEANUP_UNPROVEN", ::GetLastError());
    {
        std::unique_lock<std::mutex> lock(mutex);
        if (!changed.wait_for(lock, 10s, [] { return serviceFinished; })) {
            if (fixtureReason.empty()) fixtureReason = "SERVICE_MAIN_EXIT_TIMEOUT";
            lock.unlock();
            releaseAndJoinHelper();
            emit(false, "BLOCKED", -1);
            std::_Exit(2); // Watchdog/owned helper cleanup already ran above.
        }
    }
    service.join();
    bool lateChild = false;
    {
        const std::lock_guard<std::mutex> lock(mutex);
        lateChild = child != nullptr && !cleanupProven;
        if (!exercise && child == nullptr) {
            // A failed CreateProcessAsUserW has no process to join. Other
            // ambiguous launch failures do not claim cleanup or ownership.
            cleanupProven = launch.reason == "CREATE_PROCESS_AS_USER_FAILED"
                || launch.reason == "USER_ENVIRONMENT_BLOCK_FAILED" || launch.reason == "USER_TOKEN_INVALID";
        }
    }
    if (lateChild) releaseAndJoinHelper();
    {
        const std::lock_guard<std::mutex> lock(mutex);
        watchdogFinished = true;
        changed.notify_all();
    }
    watchdog.join();
    bool completed = false, satisfied = false;
    {
        const std::lock_guard<std::mutex> lock(mutex);
        if (exercise && fixtureReason.empty()
            && (!helperReleased || !helperExitReadback || helperExitCode != 0 || rescueTerminationUsed)) {
            fixtureReason = "HELPER_RELEASE_OR_NORMAL_EXIT_UNPROVEN";
        }
        completed = exercise && fixtureReason.empty() && cleanupProven && stopped && stoppedReports == 1;
        satisfied = completed && !stoppedWhileChildActive;
    }
    emit(completed, completed ? satisfied ? "OWNED_CHILD_JOIN_OBSERVED" : "CHILD_OWNERSHIP_ESCAPE_REPRODUCED" : "BLOCKED",
        completed ? satisfied ? 1 : 0 : -1);
    if (child != nullptr) { ::CloseHandle(child); child = nullptr; }
    if (!completed) return 2;
    return strictRequired && !satisfied ? 1 : 0;
}
}

int wmain(int argc, wchar_t** argv) {
    using namespace child_ownership_probe;
    if (argc == 2 && _wcsicmp(argv[1], L"/S") == 0) return runHelper();
    if (argc == 2 && std::wcscmp(argv[1], L"--require-owned-child-join") == 0) strictRequired = true;
    else if (argc != 1) { block("UNKNOWN_PROBE_ARGUMENT"); emit(false, "BLOCKED", -1); return 2; }
    return runParent();
}
