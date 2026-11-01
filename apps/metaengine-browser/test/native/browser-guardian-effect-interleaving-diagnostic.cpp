// Windows-only diagnostic of the ACTUAL internal launcher. Do not compile the
// actuator .cpp separately: it is included below. Link observer/store/reconciler/
// ticket-client and the production libraries. The helper is this executable's
// /S mode; it writes one PID-scoped marker in its disposable build directory.
// It is never an installer and never registers a service or changes OS policy.
// Default: real CreateProcessAsUserW with the current process's primary token.
// --inject-current-process-create explicitly substitutes real CreateProcessW;
// evidence then disclaims production identity launch. No credentials are made.
// Admission-before-stop is an owned in-flight action under the accepted contract.
// --require-owned-child-join asserts its original shutdown ownership requirement.
// --require-stop-before-physical-effect is an optional EXTRA assertion only; it
// is not the accepted contract and a post-stop call alone is not a blocker.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <bcrypt.h>
#include <sddl.h>
#include <shlobj.h>
#include <userenv.h>
#include <wtsapi32.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <cstring>
#include <cwchar>
#include <iostream>
#include <mutex>
#include <regex>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "../../native/browser-guardian-scm/browser-guardian-update-actuator.hpp"
#include "../../native/browser-guardian-scm/browser-guardian-enrollment-ticket-client.hpp"
#include "../../native/browser-guardian-scm/browser-guardian-owner-enrollment-reconciler.hpp"

namespace metaengine::guardian {
// Test fixture for revocation only; no caller/Owner/ticket proof is fabricated.
class GuardianScmEffectOwner final {
public:
    const GuardianEffectAdmission& context() const noexcept { return context_; }
    void requestStop() noexcept { context_.stop(); }
    void joinChildren() noexcept { children_.join(); }
private:
    GuardianChildCustody children_;
    GuardianEffectAdmission context_{children_};
};
}

namespace guardian_effect_probe {
constexpr DWORD kWaitMs = 5'000;
constexpr char kMarker[] = "guardian-effect-probe-child-entry\n";
enum class Scenario { StopBeforeAdmission, StopInCreateGap, StopAfterSuspendedCreate, StopInResumeGap, Control, HeldChild, FailedSuspendedCleanup };
struct State {
    metaengine::guardian::GuardianScmEffectOwner* owner = nullptr;
    Scenario scenario = Scenario::Control;
    bool inject_create = false;
    unsigned create_calls = 0;
    unsigned resume_calls = 0;
    unsigned terminate_calls = 0;
    bool create_after_stop = false;
    bool resume_after_stop = false;
    bool create_succeeded = false;
    bool resume_succeeded = false;
    DWORD create_error = ERROR_SUCCESS;
    HANDLE child = nullptr;
    HANDLE original_process = nullptr;
    HANDLE held_ready = nullptr;
    HANDLE held_release = nullptr;
    DWORD child_pid = 0;
    std::uint64_t initial_creation_time_100ns = 0;
    bool cleanup_failure_injected = false;
    bool inject_custody_wait_failure = false;
    bool custody_wait_failure_injected = false;
    unsigned original_process_closes = 0;
    bool original_process_closed_while_child_live = false;
};
State* current = nullptr;
std::mutex ownership_mutex;

[[noreturn]] void fatal(const char* reason) {
    std::cerr << "guardian_effect_probe_fatal:" << reason << ":win32=" << GetLastError() << '\n';
    std::cerr.flush();
    {
        // The watchdog cannot race with releasing the stack-owned State or its
        // child watch handle. Ordinary wrappers/stop admissions take no lock.
        std::lock_guard<std::mutex> lock(ownership_mutex);
        if (current != nullptr && current->child != nullptr) {
            TerminateProcess(current->child, ERROR_PROCESS_ABORTED);
            WaitForSingleObject(current->child, kWaitMs);
        }
    }
    ExitProcess(90);
}

class Handle {
public:
    explicit Handle(HANDLE handle = nullptr) : handle_(handle) {}
    ~Handle() { if (handle_ != nullptr && handle_ != INVALID_HANDLE_VALUE) CloseHandle(handle_); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    HANDLE get() const { return handle_; }
private:
    HANDLE handle_;
};

std::wstring executablePath() {
    std::vector<wchar_t> path(32'768);
    const DWORD size = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    if (size == 0 || size >= path.size()) fatal("executable_path_failed");
    return std::wstring(path.data(), size);
}

std::wstring markerPath(DWORD pid) {
    return executablePath() + L".child-" + std::to_wstring(pid) + L".entered";
}

std::wstring heldEventName(const wchar_t* kind, DWORD pid) {
    return std::wstring(L"Local\\METAENGINEGuardianEffectProbe-") + kind + L"-" + std::to_wstring(pid);
}

HANDLE newHeldEvent(const wchar_t* kind, DWORD pid) {
    const std::wstring name = heldEventName(kind, pid);
    HANDLE handle = CreateEventW(nullptr, TRUE, FALSE, name.c_str());
    const DWORD error = GetLastError();
    if (handle == nullptr || error == ERROR_ALREADY_EXISTS) fatal("held_event_create_failed_or_preexists");
    return handle;
}

BOOL WINAPI observedCreateProcessAsUserW(
    HANDLE token, LPCWSTR application, LPWSTR command, LPSECURITY_ATTRIBUTES process_security,
    LPSECURITY_ATTRIBUTES thread_security, BOOL inherit, DWORD flags, LPVOID environment,
    LPCWSTR directory, LPSTARTUPINFOW startup, LPPROCESS_INFORMATION info) {
    if (current == nullptr || (flags & CREATE_SUSPENDED) == 0 || inherit) fatal("unexpected_create_contract");
    ++current->create_calls;
    if (current->scenario == Scenario::StopInCreateGap) current->owner->requestStop();
    current->create_after_stop = current->owner->context().stopped();
    // The optional API substitution is a named, opt-in fault fixture. All child
    // process handles, times, session, SID readbacks and thread resume stay real.
    const BOOL ok = current->inject_create
        ? CreateProcessW(application, command, process_security, thread_security, inherit,
            flags, environment, directory, startup, info)
        : CreateProcessAsUserW(token, application, command, process_security, thread_security, inherit,
            flags, environment, directory, startup, info);
    const DWORD error = ok ? ERROR_SUCCESS : GetLastError();
    current->create_error = error;
    current->create_succeeded = ok != FALSE;
    if (ok) {
        HANDLE watched_child = nullptr;
        if (!DuplicateHandle(GetCurrentProcess(), info->hProcess, GetCurrentProcess(), &watched_child,
                SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE, FALSE, 0)) {
            TerminateProcess(info->hProcess, ERROR_PROCESS_ABORTED);
            WaitForSingleObject(info->hProcess, kWaitMs);
            fatal("child_watch_handle_failed");
        }
        {
            std::lock_guard<std::mutex> lock(ownership_mutex);
            current->child = watched_child;
        }
        current->child_pid = info->dwProcessId;
        current->original_process = info->hProcess;
        FILETIME creation{}, exit{}, kernel{}, user{};
        if (!GetProcessTimes(info->hProcess, &creation, &exit, &kernel, &user)) fatal("initial_child_birth_failed");
        ULARGE_INTEGER birth{};
        birth.LowPart = creation.dwLowDateTime;
        birth.HighPart = creation.dwHighDateTime;
        current->initial_creation_time_100ns = birth.QuadPart;
        if (current->scenario == Scenario::HeldChild) {
            current->held_ready = newHeldEvent(L"ready", info->dwProcessId);
            current->held_release = newHeldEvent(L"release", info->dwProcessId);
        }
        if (GetFileAttributesW(markerPath(info->dwProcessId).c_str()) != INVALID_FILE_ATTRIBUTES
            || GetLastError() != ERROR_FILE_NOT_FOUND) fatal("child_marker_preexists_or_unreadable");
        if (current->scenario == Scenario::StopAfterSuspendedCreate
            || current->scenario == Scenario::FailedSuspendedCleanup) current->owner->requestStop();
    }
    SetLastError(error);
    return ok;
}

DWORD WINAPI observedResumeThread(HANDLE thread) {
    if (current == nullptr) fatal("resume_without_fixture");
    ++current->resume_calls;
    if (current->scenario == Scenario::StopInResumeGap) current->owner->requestStop();
    current->resume_after_stop = current->owner->context().stopped();
    const DWORD result = ResumeThread(thread);
    current->resume_succeeded = result != static_cast<DWORD>(-1);
    return result;
}

BOOL WINAPI observedTerminateProcess(HANDLE process, UINT exit_code) {
    if (current != nullptr) ++current->terminate_calls;
    if (current != nullptr && current->scenario == Scenario::FailedSuspendedCleanup
        && process == current->original_process) {
        // Named fault injection only. The real kernel child remains suspended;
        // the fixture owner must retain its original process handle until the
        // probe rescues its exact helper. This is not an observed OS denial.
        current->cleanup_failure_injected = true;
        SetLastError(ERROR_ACCESS_DENIED);
        return FALSE;
    }
    return TerminateProcess(process, exit_code);
}

DWORD WINAPI observedWaitForSingleObject(HANDLE handle, DWORD timeout) {
    if (current != nullptr && current->inject_custody_wait_failure
        && handle == current->original_process) {
        // One-shot fault enabled only after fixture-worker exit, before join.
        // The real original handle stays valid; this is not an OS failure.
        current->inject_custody_wait_failure = false;
        current->custody_wait_failure_injected = true;
        SetLastError(ERROR_INVALID_HANDLE);
        return WAIT_FAILED;
    }
    return WaitForSingleObject(handle, timeout);
}

BOOL WINAPI observedCloseHandle(HANDLE handle) {
    if (current != nullptr && handle == current->original_process) {
        ++current->original_process_closes;
        DWORD exit_code = 0;
        current->original_process_closed_while_child_live =
            GetExitCodeProcess(handle, &exit_code) && exit_code == STILL_ACTIVE;
    }
    return CloseHandle(handle);
}
}  // namespace guardian_effect_probe

// Scheduling/telemetry and explicitly named API-failure hooks. All Windows
// headers are included already; their declarations are not rewritten.
#define CreateProcessAsUserW guardian_effect_probe::observedCreateProcessAsUserW
#define ResumeThread guardian_effect_probe::observedResumeThread
#define TerminateProcess guardian_effect_probe::observedTerminateProcess
#define CloseHandle guardian_effect_probe::observedCloseHandle
#define WaitForSingleObject guardian_effect_probe::observedWaitForSingleObject
#include "../../native/browser-guardian-scm/browser-guardian-update-actuator.cpp"
#undef WaitForSingleObject
#undef CloseHandle
#undef TerminateProcess
#undef ResumeThread
#undef CreateProcessAsUserW

namespace guardian_effect_probe {

int childEntry() {
    const std::wstring marker = markerPath(GetCurrentProcessId());
    {
        Handle file(CreateFileW(marker.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, nullptr));
        if (file.get() == INVALID_HANDLE_VALUE) return 61;
        DWORD written = 0;
        const DWORD bytes = static_cast<DWORD>(sizeof(kMarker) - 1);
        if (!WriteFile(file.get(), kMarker, bytes, &written, nullptr)
            || written != bytes || !FlushFileBuffers(file.get())) return 62;
    }
    const std::wstring ready_name = heldEventName(L"ready", GetCurrentProcessId());
    Handle ready(OpenEventW(EVENT_MODIFY_STATE, FALSE, ready_name.c_str()));
    if (ready.get() == nullptr) return GetLastError() == ERROR_FILE_NOT_FOUND ? 0 : 63;
    const std::wstring release_name = heldEventName(L"release", GetCurrentProcessId());
    Handle release(OpenEventW(SYNCHRONIZE, FALSE, release_name.c_str()));
    if (release.get() == nullptr || !SetEvent(ready.get())) return 64;
    // A failed parent cannot leave this harmless helper waiting indefinitely.
    return WaitForSingleObject(release.get(), 20'000) == WAIT_OBJECT_0 ? 0 : 65;
}

bool childMarkerExact(DWORD pid) {
    Handle file(CreateFileW(markerPath(pid).c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr,
        OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
    if (file.get() == INVALID_HANDLE_VALUE) {
        if (GetLastError() != ERROR_FILE_NOT_FOUND) fatal("child_marker_read_failed");
        return false;
    }
    std::array<char, sizeof(kMarker)> bytes{};
    DWORD got = 0;
    if (!ReadFile(file.get(), bytes.data(), static_cast<DWORD>(bytes.size()), &got, nullptr)) {
        fatal("child_marker_content_failed");
    }
    return got == sizeof(kMarker) - 1 && std::memcmp(bytes.data(), kMarker, sizeof(kMarker) - 1) == 0;
}

struct CaseResult {
    const char* name;
    bool ok = false;
    std::string state;
    std::string reason;
    State telemetry;
    DWORD child_exit = 0;
    bool child_marker = false;
};

CaseResult runCase(const char* label, Scenario scenario, bool inject, HANDLE token, DWORD session,
    const std::wstring& sid, metaengine::guardian::GuardianScmEffectOwner* sharedOwner = nullptr) {
    metaengine::guardian::GuardianScmEffectOwner localOwner;
    auto& owner = sharedOwner == nullptr ? localOwner : *sharedOwner;
    State telemetry;
    telemetry.owner = &owner;
    telemetry.scenario = scenario;
    telemetry.inject_create = inject;
    {
        std::lock_guard<std::mutex> lock(ownership_mutex);
        current = &telemetry;
    }
    if (scenario == Scenario::StopBeforeAdmission) owner.requestStop();
    const auto launch = metaengine::guardian::launchInstaller(executablePath(), token, session, sid, owner.context());
    Handle child(telemetry.child);
    DWORD child_exit = 0;
    bool marker = false;
    if (child.get() != nullptr) {
        if (WaitForSingleObject(child.get(), kWaitMs) != WAIT_OBJECT_0
            || !GetExitCodeProcess(child.get(), &child_exit)) fatal("child_join_failed");
        marker = childMarkerExact(telemetry.child_pid);
    }
    // The independent watch handle already observed terminal completion.
    // It does not release or substitute for the owner's original handle.
    const bool retainedUntilJoin = !telemetry.create_succeeded || telemetry.original_process_closes == 0;
    owner.joinChildren();
    const bool ownershipSettled = retainedUntilJoin && (!telemetry.create_succeeded
        || (telemetry.original_process_closes == 1 && !telemetry.original_process_closed_while_child_live));
    {
        std::lock_guard<std::mutex> lock(ownership_mutex);
        current = nullptr;
    }
    const bool dispatched = scenario == Scenario::StopInResumeGap || scenario == Scenario::Control;
    const bool before_create = scenario == Scenario::StopBeforeAdmission;
    const bool expected = before_create
        ? launch.state == "NO_EFFECT_PROVEN" && launch.reason == "SERVICE_STOP_BEFORE_INSTALLER_CREATE"
            && telemetry.create_calls == 0 && telemetry.resume_calls == 0 && !marker
        : dispatched
            ? launch.state == "DISPATCHED" && launch.physical_dispatch_performed
                && telemetry.create_calls == 1 && telemetry.resume_calls == 1 && marker && child_exit == 0
            : launch.state == "NO_EFFECT_PROVEN" && launch.reason == "SERVICE_STOP_BEFORE_INSTALLER_RESUME"
                && telemetry.create_calls == 1 && telemetry.resume_calls == 0 && telemetry.terminate_calls == 1
                && !marker && child_exit == ERROR_PROCESS_ABORTED;
    const bool gap_observed = (scenario != Scenario::StopInCreateGap || telemetry.create_after_stop)
        && (scenario != Scenario::StopInResumeGap || telemetry.resume_after_stop);
    telemetry.owner = nullptr;
    telemetry.child = nullptr;
    return {label, expected && gap_observed && ownershipSettled, launch.state, launch.reason, telemetry, child_exit, marker};
}

struct HeldWorkerContext {
    metaengine::guardian::GuardianScmEffectOwner* owner;
    HANDLE token;
    DWORD session;
    const std::wstring* sid;
    HANDLE launch_returned;
    HANDLE worker_stop;
    metaengine::guardian::GuardianUpdateActuatorResult launch;
};

DWORD WINAPI heldWorkerFixture(void* raw) {
    auto* context = static_cast<HeldWorkerContext*>(raw);
    context->launch = metaengine::guardian::launchInstaller(
        executablePath(), context->token, context->session, *context->sid, context->owner->context());
    if (!SetEvent(context->launch_returned)) fatal("held_launcher_return_signal_failed");
    // Explicit worker fixture, NOT updateActuatorWorker or serviceMain. It
    // reproduces the latter's stop -> worker join boundary without pretending
    // that an authenticated Owner/ticket request reached this launcher.
    if (WaitForSingleObject(context->worker_stop, 15'000) != WAIT_OBJECT_0) fatal("held_worker_stop_timeout");
    return 0;
}

struct OwnerJoinContext {
    metaengine::guardian::GuardianScmEffectOwner* owner;
    HANDLE done;
};

DWORD WINAPI ownedJoinFixture(LPVOID raw) {
    auto* context = static_cast<OwnerJoinContext*>(raw);
    context->owner->joinChildren();
    if (!SetEvent(context->done)) fatal("owner_join_signal_failed");
    return 0;
}

struct OwnershipResult {
    bool qualified = false;
    bool escaped_lifetime = false;
    bool launcher_returned = false;
    bool fixture_worker_joined = false;
    bool fixture_owner_joined = false;
    bool original_retained_while_child_live = false;
    bool owner_join_held_while_child_live = false;
    bool child_live_after_stop_and_join = false;
    bool exact_kernel_birth = false;
    bool child_marker = false;
    unsigned original_process_closes = 0;
    bool original_process_closed_while_live = false;
    bool cleanup_failure_injected = false;
    bool custody_wait_failure_injected = false;
    bool exact_handle_rescue_performed = false;
    DWORD create_error = ERROR_SUCCESS;
    DWORD child_exit = 0;
    std::string launch_state;
    std::string launch_reason;
};

OwnershipResult heldChildOwnershipCase(
    bool inject, HANDLE token, DWORD session, const std::wstring& sid, bool cleanup_failure = false) {
    metaengine::guardian::GuardianScmEffectOwner owner;
    State telemetry;
    telemetry.owner = &owner;
    telemetry.scenario = cleanup_failure ? Scenario::FailedSuspendedCleanup : Scenario::HeldChild;
    telemetry.inject_create = inject;
    Handle returned(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    Handle worker_stop(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (returned.get() == nullptr || worker_stop.get() == nullptr) fatal("held_fixture_events_failed");
    HeldWorkerContext context{&owner, token, session, &sid, returned.get(), worker_stop.get(), {}};
    {
        std::lock_guard<std::mutex> lock(ownership_mutex);
        current = &telemetry;
    }
    Handle worker(CreateThread(nullptr, 0, heldWorkerFixture, &context, 0, nullptr));
    if (worker.get() == nullptr) fatal("held_fixture_worker_failed");
    if (WaitForSingleObject(returned.get(), kWaitMs) != WAIT_OBJECT_0) fatal("held_launcher_return_timeout");
    OwnershipResult proof;
    proof.launcher_returned = true;
    proof.create_error = telemetry.create_error;
    proof.launch_state = context.launch.state;
    proof.launch_reason = context.launch.reason;
    Handle child(telemetry.child);
    Handle ready(telemetry.held_ready);
    Handle release(telemetry.held_release);
    if (child.get() != nullptr) {
        if (!cleanup_failure && (ready.get() == nullptr || release.get() == nullptr
            || WaitForSingleObject(ready.get(), kWaitMs) != WAIT_OBJECT_0)) fatal("held_child_not_ready");
        proof.child_marker = childMarkerExact(telemetry.child_pid);
        FILETIME creation{}, exit{}, kernel{}, user{};
        proof.exact_kernel_birth = GetProcessTimes(child.get(), &creation, &exit, &kernel, &user)
            && metaengine::guardian::fileTimeValue(creation) == telemetry.initial_creation_time_100ns
            && telemetry.initial_creation_time_100ns != 0 && GetProcessId(child.get()) == telemetry.child_pid;
        if (!cleanup_failure) proof.exact_kernel_birth = proof.exact_kernel_birth
            && telemetry.initial_creation_time_100ns == context.launch.creation_time_100ns
            && telemetry.child_pid == context.launch.pid;
    }
    owner.requestStop();
    if (!SetEvent(worker_stop.get()) || WaitForSingleObject(worker.get(), kWaitMs) != WAIT_OBJECT_0) {
        fatal("held_fixture_worker_join_failed");
    }
    proof.fixture_worker_joined = true;
    if (child.get() != nullptr) {
        DWORD exit_code = 0;
        proof.child_live_after_stop_and_join = WaitForSingleObject(child.get(), 0) == WAIT_TIMEOUT
            && GetExitCodeProcess(child.get(), &exit_code) && exit_code == STILL_ACTIVE;
        // Borrow the actual original value for telemetry; the duplicate watch
        // handle is never credited as the fixture owner's custody.
        proof.original_retained_while_child_live = proof.child_live_after_stop_and_join
            && telemetry.original_process_closes == 0
            && GetProcessId(telemetry.original_process) == telemetry.child_pid
            && WaitForSingleObject(telemetry.original_process, 0) == WAIT_TIMEOUT;
    }
    Handle owner_joined(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (owner_joined.get() == nullptr) fatal("owner_join_event_failed");
    OwnerJoinContext join_context{&owner, owner_joined.get()};
    telemetry.inject_custody_wait_failure = cleanup_failure;
    Handle joiner(CreateThread(nullptr, 0, ownedJoinFixture, &join_context, 0, nullptr));
    if (joiner.get() == nullptr) fatal("owner_join_thread_failed");
    proof.owner_join_held_while_child_live = proof.child_live_after_stop_and_join
        && WaitForSingleObject(owner_joined.get(), 250) == WAIT_TIMEOUT
        && WaitForSingleObject(child.get(), 0) == WAIT_TIMEOUT;
    // Release/rescue from this independent fixture thread, not after waiting
    // for owner join. A launcher wait or premature owner return must fail.
    if (child.get() != nullptr) {
        if (cleanup_failure) {
            proof.exact_handle_rescue_performed = TerminateProcess(child.get(), ERROR_PROCESS_ABORTED) != FALSE;
            if (!proof.exact_handle_rescue_performed) fatal("failed_cleanup_probe_rescue_failed");
        } else if (!SetEvent(release.get())) fatal("held_child_release_failed");
        if (WaitForSingleObject(child.get(), kWaitMs) != WAIT_OBJECT_0
            || !GetExitCodeProcess(child.get(), &proof.child_exit)) fatal("held_child_release_join_failed");
    }
    if (WaitForSingleObject(owner_joined.get(), kWaitMs) != WAIT_OBJECT_0
        || WaitForSingleObject(joiner.get(), kWaitMs) != WAIT_OBJECT_0) fatal("owner_join_failed");
    proof.fixture_owner_joined = true;
    proof.original_process_closes = telemetry.original_process_closes;
    proof.original_process_closed_while_live = telemetry.original_process_closed_while_child_live;
    proof.cleanup_failure_injected = telemetry.cleanup_failure_injected;
    proof.custody_wait_failure_injected = telemetry.custody_wait_failure_injected;
    proof.qualified = proof.exact_kernel_birth && (cleanup_failure
        ? context.launch.state == "AMBIGUOUS" && context.launch.reason == "SERVICE_STOP_BEFORE_INSTALLER_RESUME"
            && proof.cleanup_failure_injected && proof.custody_wait_failure_injected
            && telemetry.terminate_calls == 1 && telemetry.resume_calls == 0 && !proof.child_marker
            && proof.exact_handle_rescue_performed && proof.child_exit == ERROR_PROCESS_ABORTED
        : context.launch.state == "DISPATCHED" && context.launch.physical_dispatch_performed
            && proof.child_marker && proof.child_exit == 0);
    proof.escaped_lifetime = proof.qualified && proof.child_live_after_stop_and_join
        && proof.original_process_closes == 1 && proof.original_process_closed_while_live;
    {
        std::lock_guard<std::mutex> lock(ownership_mutex);
        current = nullptr;
    }
    return proof;
}

void printOwnership(const OwnershipResult& proof) {
    std::cout << "{\"qualified\":" << (proof.qualified ? "true" : "false")
        << ",\"actual_scm_worker_exercised\":false,\"launcher_returned\":" << (proof.launcher_returned ? "true" : "false")
        << ",\"fixture_worker_joined\":" << (proof.fixture_worker_joined ? "true" : "false")
        << ",\"fixture_owner_joined\":" << (proof.fixture_owner_joined ? "true" : "false")
        << ",\"original_process_retained_while_child_live\":" << (proof.original_retained_while_child_live ? "true" : "false")
        << ",\"fixture_owner_join_held_while_child_live\":" << (proof.owner_join_held_while_child_live ? "true" : "false")
        << ",\"child_live_after_stop_and_fixture_worker_join\":" << (proof.child_live_after_stop_and_join ? "true" : "false")
        << ",\"exact_original_kernel_object_retained_by_probe\":" << (proof.exact_kernel_birth ? "true" : "false")
        << ",\"original_process_handle_closes\":" << proof.original_process_closes
        << ",\"original_process_handle_closed_while_child_live\":" << (proof.original_process_closed_while_live ? "true" : "false")
        << ",\"child_marker_exact\":" << (proof.child_marker ? "true" : "false")
        << ",\"child_exit\":" << proof.child_exit << ",\"create_error\":" << proof.create_error
        << ",\"launch_state\":\"" << proof.launch_state << "\",\"launch_reason\":\"" << proof.launch_reason << '"'
        << ",\"cleanup_failure_injected\":" << (proof.cleanup_failure_injected ? "true" : "false")
        << ",\"custody_wait_failure_injected\":" << (proof.custody_wait_failure_injected ? "true" : "false")
        << ",\"exact_handle_probe_rescue_performed\":" << (proof.exact_handle_rescue_performed ? "true" : "false")
        << ",\"escaped_owned_lifetime_reproduced\":" << (proof.escaped_lifetime ? "true" : "false") << '}';
}

DWORD WINAPI watchdog(void* done) {
    if (WaitForSingleObject(static_cast<HANDLE>(done), 60'000) != WAIT_OBJECT_0) fatal("suite_watchdog_timeout");
    return 0;
}
}  // namespace guardian_effect_probe

int wmain(int argc, wchar_t** argv) {
    using namespace guardian_effect_probe;
    if (argc == 2 && std::wstring_view(argv[1]) == L"/S") return childEntry();
    bool inject = false;
    bool require_strong = false;
    bool require_owned_join = false;
    for (int index = 1; index < argc; ++index) {
        const std::wstring_view argument(argv[index]);
        if (argument == L"--inject-current-process-create") inject = true;
        else if (argument == L"--require-stop-before-physical-effect") require_strong = true;
        else if (argument == L"--require-owned-child-join") require_owned_join = true;
        else return 64;
    }
    Handle done(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (done.get() == nullptr) fatal("watchdog_event_failed");
    Handle guard(CreateThread(nullptr, 0, watchdog, done.get(), 0, nullptr));
    if (guard.get() == nullptr) fatal("watchdog_create_failed");
    HANDLE raw_token = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY, &raw_token)) {
        fatal("current_primary_token_unavailable");
    }
    Handle token(raw_token);
    DWORD required = 0;
    GetTokenInformation(token.get(), TokenUser, nullptr, 0, &required);
    if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || required == 0) fatal("current_user_size_failed");
    std::vector<unsigned char> storage(required);
    if (!GetTokenInformation(token.get(), TokenUser, storage.data(), required, &required)) fatal("current_user_failed");
    const auto* user = reinterpret_cast<const TOKEN_USER*>(storage.data());
    LPWSTR raw_sid = nullptr;
    if (!ConvertSidToStringSidW(user->User.Sid, &raw_sid) || raw_sid == nullptr) fatal("current_sid_failed");
    const std::wstring sid(raw_sid);
    LocalFree(raw_sid);
    DWORD session = 0;
    if (!ProcessIdToSessionId(GetCurrentProcessId(), &session)) fatal("current_session_failed");
    std::vector<CaseResult> cases;
    cases.push_back(runCase("stop_before_create_admission", Scenario::StopBeforeAdmission, inject, token.get(), session, sid));
    cases.push_back(runCase("stop_after_suspended_create", Scenario::StopAfterSuspendedCreate, inject, token.get(), session, sid));
    cases.push_back(runCase("stop_in_create_cas_to_api_gap", Scenario::StopInCreateGap, inject, token.get(), session, sid));
    cases.push_back(runCase("stop_in_resume_cas_to_api_gap", Scenario::StopInResumeGap, inject, token.get(), session, sid));
    cases.push_back(runCase("normal_harmless_child_control", Scenario::Control, inject, token.get(), session, sid));
    metaengine::guardian::GuardianScmEffectOwner sequentialOwner;
    cases.push_back(runCase("sequential_dispatch_first", Scenario::Control, inject, token.get(), session, sid, &sequentialOwner));
    cases.push_back(runCase("sequential_dispatch_second", Scenario::Control, inject, token.get(), session, sid, &sequentialOwner));
    const OwnershipResult ownership = heldChildOwnershipCase(inject, token.get(), session, sid);
    const OwnershipResult failed_cleanup = heldChildOwnershipCase(inject, token.get(), session, sid, true);
    bool cases_ok = true;
    bool physical_after_stop = false;
    for (const auto& row : cases) {
        cases_ok = cases_ok && row.ok;
        physical_after_stop = physical_after_stop
            || (row.telemetry.create_after_stop && row.telemetry.create_succeeded)
            || (row.telemetry.resume_after_stop && row.telemetry.resume_succeeded);
    }
    // Worker exit may precede child exit, but original custody may not escape.
    // Measure the fixture owner's separate terminal join while the main test
    // thread releases/rescues only its exact helper. Neither this fixture owner
    // nor its watch handle qualifies an installed SCM shutdown path.
    const auto owned = [](const OwnershipResult& proof) {
        return proof.qualified && proof.launcher_returned && proof.fixture_worker_joined
            && proof.child_live_after_stop_and_join && proof.original_retained_while_child_live
            && proof.owner_join_held_while_child_live && proof.fixture_owner_joined
            && proof.original_process_closes == 1 && !proof.original_process_closed_while_live;
    };
    const bool ownership_outcome = owned(ownership) && owned(failed_cleanup);
    const bool ok = cases_ok && ownership_outcome && (!require_strong || !physical_after_stop);
    std::cout << "{\"schema\":\"metaengine.browser-guardian.effect-interleaving-diagnostic.v1\",\"ok\":"
        << (ok ? "true" : "false") << ",\"diagnostic_only\":true,\"stop_schedule_injected\":true,"
           "\"production_launcher_exercised\":true,\"current_process_token_fixture\":true,"
           "\"authenticated_request_session_exercised\":false,\"exact_owner_token_acquisition_exercised\":false,"
           "\"owner_enrollment_exercised\":false,"
           "\"scm_installation_exercised\":false,\"installer_execution_exercised\":false,"
           "\"create_process_as_user_substituted\":" << (inject ? "true" : "false")
        << ",\"admission_before_stop_is_owned_in_flight\":true,\"strong_assertion_is_original_contract\":false"
        << ",\"require_owned_child_join\":" << (require_owned_join ? "true" : "false")
        << ",\"fixture_owned_child_join_satisfied\":" << (ownership_outcome ? "true" : "false")
        << ",\"post_stop_physical_call_observed\":" << (cases_ok ? (physical_after_stop ? "true" : "false") : "null")
        << ",\"shutdown_contract_qualification_performed\":false"
        << ",\"owned_child_shutdown_satisfied\":" << (ownership.escaped_lifetime || failed_cleanup.escaped_lifetime ? "false" : "null")
        << ",\"cases\":[";
    bool first = true;
    for (const auto& row : cases) {
        if (!first) std::cout << ',';
        first = false;
        std::cout << "{\"name\":\"" << row.name << "\",\"ok\":" << (row.ok ? "true" : "false")
            << ",\"state\":\"" << row.state << "\",\"reason\":\"" << row.reason << "\",\"create_calls\":"
            << row.telemetry.create_calls << ",\"create_error\":" << row.telemetry.create_error
            << ",\"create_succeeded\":" << (row.telemetry.create_succeeded ? "true" : "false")
            << ",\"resume_calls\":" << row.telemetry.resume_calls << ",\"terminate_calls\":" << row.telemetry.terminate_calls
            << ",\"create_after_stop\":" << (row.telemetry.create_after_stop ? "true" : "false")
            << ",\"resume_after_stop\":" << (row.telemetry.resume_after_stop ? "true" : "false")
            << ",\"resume_succeeded\":" << (row.telemetry.resume_succeeded ? "true" : "false")
            << ",\"child_marker_exact\":" << (row.child_marker ? "true" : "false") << ",\"child_exit\":" << row.child_exit << '}';
    }
    std::cout << "],\"held_child_ownership\":";
    printOwnership(ownership);
    std::cout << ",\"failed_suspended_cleanup_ownership\":";
    printOwnership(failed_cleanup);
    std::cout << ",\"authority_effect\":false}\n";
    if (!SetEvent(done.get()) || WaitForSingleObject(guard.get(), kWaitMs) != WAIT_OBJECT_0) fatal("watchdog_join_failed");
    return ok ? 0 : 1;
}
