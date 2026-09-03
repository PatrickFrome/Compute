#include "browser-guardian-session-broker-wts-executor.hpp"

#include <sddl.h>
#include <userenv.h>
#include <wtsapi32.h>

#include <algorithm>
#include <cwctype>
#include <string>
#include <vector>

namespace metaengine::guardian {
namespace {

constexpr wchar_t kLocalSystemSid[] = L"S-1-5-18";
constexpr wchar_t kExpectedBrokerBasename[] = L"METAENGINEBrowserSessionBroker.exe";
constexpr char kContractJson[] =
    "{\"schema\":\"metaengine.browser-guardian.session-broker-wts-executor.v1\","
    "\"version\":\"1.1.0\","
    "\"protocol_generation\":2,"
    "\"features\":{"
      "\"exact_wts_session_token_v1\":true,"
      "\"create_process_as_user_suspended_v1\":true,"
      "\"exact_process_incarnation_v1\":true,"
      "\"kill_on_close_job_before_resume_v1\":true,"
      "\"guardian_owned_broker_lease_v1\":true},"
    "\"process_effect_scope\":\"START_BROKER_EXACT_SESSION_ONLY\","
    "\"session_token_scope\":\"INTERNAL_EXACT_WTS_SESSION_ONLY\","
    "\"caller_must_be_localsystem\":true,"
    "\"requires_journal_gated_call\":true,"
    "\"expected_broker_basename\":\"METAENGINEBrowserSessionBroker.exe\","
    "\"single_dispatch_per_call\":true,"
    "\"restart_supported\":false,"
    "\"automatic_retry_allowed\":false,"
    "\"second_scheduler_loop\":false,"
    "\"broker_may_own_job_handle\":false,"
    "\"guardian_owns_last_job_handle\":true,"
    "\"token_export_allowed\":false,"
    "\"browser_authority\":false,"
    "\"task_authority\":false,"
    "\"scheduler_authority\":false,"
    "\"page_model_text_authority\":false,"
    "\"release_authority\":false,"
    "\"network_authority\":false,"
    "\"shell_command_authority\":false,"
    "\"authority_effect\":false}";

class ScopedHandle {
public:
    ScopedHandle() = default;
    explicit ScopedHandle(HANDLE value) : value_(value) {}
    ~ScopedHandle() { reset(); }

    ScopedHandle(const ScopedHandle&) = delete;
    ScopedHandle& operator=(const ScopedHandle&) = delete;

    HANDLE get() const noexcept { return value_; }
    explicit operator bool() const noexcept {
        return value_ != nullptr && value_ != INVALID_HANDLE_VALUE;
    }
    HANDLE release() noexcept {
        HANDLE out = value_;
        value_ = nullptr;
        return out;
    }
    void reset(HANDLE value = nullptr) noexcept {
        if (value_ != nullptr && value_ != INVALID_HANDLE_VALUE) CloseHandle(value_);
        value_ = value;
    }

private:
    HANDLE value_ = nullptr;
};

class ScopedEnvironment {
public:
    ScopedEnvironment() = default;
    ~ScopedEnvironment() { if (value_ != nullptr) DestroyEnvironmentBlock(value_); }
    ScopedEnvironment(const ScopedEnvironment&) = delete;
    ScopedEnvironment& operator=(const ScopedEnvironment&) = delete;
    LPVOID* out() noexcept { return &value_; }
    LPVOID get() const noexcept { return value_; }
private:
    LPVOID value_ = nullptr;
};

std::wstring lower(std::wstring value) {
    std::transform(value.begin(), value.end(), value.begin(), [](wchar_t ch) {
        return static_cast<wchar_t>(std::towlower(ch));
    });
    return value;
}

std::wstring fullPath(const std::wstring& input) {
    if (input.empty()) return {};
    const DWORD required = GetFullPathNameW(input.c_str(), 0, nullptr, nullptr);
    if (required == 0) return {};
    std::wstring buffer(required, L'\0');
    const DWORD written = GetFullPathNameW(input.c_str(), required, buffer.data(), nullptr);
    if (written == 0 || written >= required) return {};
    buffer.resize(written);
    return buffer;
}

bool regularFile(const std::wstring& path) {
    const DWORD attrs = GetFileAttributesW(path.c_str());
    return attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

std::wstring basename(const std::wstring& path) {
    const std::size_t pos = path.find_last_of(L"\\/");
    return pos == std::wstring::npos ? path : path.substr(pos + 1);
}

std::wstring parentDirectory(const std::wstring& path) {
    const std::size_t pos = path.find_last_of(L"\\/");
    return pos == std::wstring::npos ? std::wstring{} : path.substr(0, pos);
}

bool canonicalEffectId(const std::wstring& value) {
    if (value.size() != 36) return false;
    for (std::size_t i = 0; i < value.size(); ++i) {
        const wchar_t ch = value[i];
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (ch != L'-') return false;
            continue;
        }
        if (!((ch >= L'0' && ch <= L'9')
              || (ch >= L'a' && ch <= L'f')
              || (ch >= L'A' && ch <= L'F'))) {
            return false;
        }
    }
    return true;
}

std::wstring tokenSidString(HANDLE token) {
    DWORD required = 0;
    GetTokenInformation(token, TokenUser, nullptr, 0, &required);
    if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || required == 0) return {};
    std::vector<BYTE> buffer(required);
    if (!GetTokenInformation(token, TokenUser, buffer.data(), required, &required)) return {};
    const auto* tokenUser = reinterpret_cast<const TOKEN_USER*>(buffer.data());
    LPWSTR raw = nullptr;
    if (!ConvertSidToStringSidW(tokenUser->User.Sid, &raw) || raw == nullptr) return {};
    std::wstring out(raw);
    LocalFree(raw);
    return out;
}

bool tokenSessionMatches(HANDLE token, DWORD expectedSessionId) {
    DWORD sessionId = 0;
    DWORD written = 0;
    if (!GetTokenInformation(token, TokenSessionId, &sessionId, sizeof(sessionId), &written)) return false;
    return written == sizeof(sessionId) && sessionId == expectedSessionId;
}

bool currentProcessIsLocalSystem() {
    HANDLE rawToken = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &rawToken)) return false;
    ScopedHandle token(rawToken);
    const std::wstring sid = tokenSidString(token.get());
    return !sid.empty() && _wcsicmp(sid.c_str(), kLocalSystemSid) == 0;
}

std::uint64_t fileTimeValue(const FILETIME& value) {
    ULARGE_INTEGER raw{};
    raw.LowPart = value.dwLowDateTime;
    raw.HighPart = value.dwHighDateTime;
    return raw.QuadPart;
}

std::wstring incarnationId(DWORD pid, std::uint64_t creationTime) {
    return L"pid:" + std::to_wstring(pid) + L":created_100ns:" + std::to_wstring(creationTime);
}

std::vector<wchar_t> brokerCommandLine(
    const std::wstring& executable,
    const std::wstring& effectId,
    std::uint64_t generation,
    DWORD sessionId) {
    std::wstring command = L"\"" + executable + L"\""
        + L" --guardian-broker-effect-id " + effectId
        + L" --guardian-broker-effect-generation " + std::to_wstring(generation)
        + L" --guardian-session-id " + std::to_wstring(sessionId);
    std::vector<wchar_t> out(command.begin(), command.end());
    out.push_back(L'\0');
    return out;
}

BrokerLaunchResult makeResult(
    BrokerDispatchState state,
    const char* reason,
    DWORD error = ERROR_SUCCESS) {
    BrokerLaunchResult out;
    out.state = state;
    out.reason = reason == nullptr ? "unknown" : reason;
    out.win32_error = error;
    return out;
}

bool terminateNeverResumed(HANDLE process) {
    if (process == nullptr || process == INVALID_HANDLE_VALUE) return true;
    DWORD exitCode = STILL_ACTIVE;
    if (GetExitCodeProcess(process, &exitCode) && exitCode != STILL_ACTIVE) return true;
    if (!TerminateProcess(process, ERROR_PROCESS_ABORTED)) return false;
    return WaitForSingleObject(process, 5'000) == WAIT_OBJECT_0;
}

BrokerLaunchResult preResumeFailure(
    const char* reason,
    DWORD error,
    HANDLE process,
    bool childCreated) {
    BrokerLaunchResult out = makeResult(BrokerDispatchState::NoEffectProven, reason, error);
    out.created_suspended = childCreated;
    out.child_never_resumed = childCreated;
    out.exact_created_process_terminated = childCreated && terminateNeverResumed(process);
    if (childCreated && !out.exact_created_process_terminated) {
        out.state = BrokerDispatchState::Ambiguous;
        out.reason = std::string(reason == nullptr ? "pre_resume_failure" : reason)
            + ":termination_unproven";
    }
    return out;
}

}  // namespace

BrokerLease::~BrokerLease() { reset(); }

BrokerLease::BrokerLease(BrokerLease&& other) noexcept
    : process_(other.process_), job_(other.job_), pid_(other.pid_) {
    other.process_ = nullptr;
    other.job_ = nullptr;
    other.pid_ = 0;
}

BrokerLease& BrokerLease::operator=(BrokerLease&& other) noexcept {
    if (this != &other) {
        reset();
        process_ = other.process_;
        job_ = other.job_;
        pid_ = other.pid_;
        other.process_ = nullptr;
        other.job_ = nullptr;
        other.pid_ = 0;
    }
    return *this;
}

bool BrokerLease::valid() const noexcept {
    return process_ != nullptr && process_ != INVALID_HANDLE_VALUE
        && job_ != nullptr && job_ != INVALID_HANDLE_VALUE
        && pid_ > 0;
}

DWORD BrokerLease::pid() const noexcept { return pid_; }
HANDLE BrokerLease::process_handle() const noexcept { return process_; }
HANDLE BrokerLease::job_handle() const noexcept { return job_; }

void BrokerLease::reset() noexcept {
    if (process_ != nullptr && process_ != INVALID_HANDLE_VALUE) CloseHandle(process_);
    process_ = nullptr;
    if (job_ != nullptr && job_ != INVALID_HANDLE_VALUE) CloseHandle(job_);
    job_ = nullptr;
    pid_ = 0;
}

const char* browserGuardianSessionBrokerWtsExecutorContractJson() noexcept {
    return kContractJson;
}

BrokerLaunchResult launchExactSessionBroker(
    const BrokerLaunchRequest& request,
    BrokerLease* lease_out) {
    if (lease_out == nullptr || lease_out->valid()) {
        return makeResult(BrokerDispatchState::NoEffectProven, "LEASE_OUTPUT_INVALID");
    }
    if (!currentProcessIsLocalSystem()) {
        return makeResult(BrokerDispatchState::NoEffectProven, "CALLER_NOT_LOCALSYSTEM", ERROR_ACCESS_DENIED);
    }
    if (request.session_id == 0
        || request.effect_generation == 0
        || !canonicalEffectId(request.effect_id)) {
        return makeResult(BrokerDispatchState::NoEffectProven, "REQUEST_IDENTITY_INVALID", ERROR_INVALID_PARAMETER);
    }

    const std::wstring executable = fullPath(request.broker_executable);
    if (executable.empty()
        || !regularFile(executable)
        || _wcsicmp(basename(executable).c_str(), kExpectedBrokerBasename) != 0) {
        return makeResult(BrokerDispatchState::NoEffectProven, "BROKER_EXECUTABLE_INVALID", ERROR_FILE_NOT_FOUND);
    }
    if (request.expected_owner_sid.empty()) {
        return makeResult(BrokerDispatchState::NoEffectProven, "EXPECTED_OWNER_SID_INVALID", ERROR_INVALID_SID);
    }

    HANDLE rawUserToken = nullptr;
    if (!WTSQueryUserToken(request.session_id, &rawUserToken)) {
        return makeResult(BrokerDispatchState::NoEffectProven, "WTS_QUERY_USER_TOKEN_FAILED", GetLastError());
    }
    ScopedHandle userToken(rawUserToken);

    const std::wstring tokenSid = tokenSidString(userToken.get());
    if (tokenSid.empty()
        || _wcsicmp(tokenSid.c_str(), request.expected_owner_sid.c_str()) != 0) {
        return makeResult(BrokerDispatchState::NoEffectProven, "OWNER_SID_TOKEN_MISMATCH", ERROR_INVALID_OWNER);
    }
    if (!tokenSessionMatches(userToken.get(), request.session_id)) {
        return makeResult(BrokerDispatchState::NoEffectProven, "TOKEN_SESSION_MISMATCH", ERROR_INVALID_PARAMETER);
    }

    ScopedEnvironment environment;
    if (!CreateEnvironmentBlock(environment.out(), userToken.get(), FALSE)) {
        return makeResult(BrokerDispatchState::NoEffectProven, "USER_ENVIRONMENT_BLOCK_FAILED", GetLastError());
    }

    ScopedHandle job(CreateJobObjectW(nullptr, nullptr));
    if (!job) return makeResult(BrokerDispatchState::NoEffectProven, "JOB_CREATE_FAILED", GetLastError());

    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(
            job.get(),
            JobObjectExtendedLimitInformation,
            &limits,
            sizeof(limits))) {
        return makeResult(BrokerDispatchState::NoEffectProven, "JOB_KILL_ON_CLOSE_CONFIG_FAILED", GetLastError());
    }

    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.lpDesktop = const_cast<LPWSTR>(L"winsta0\\default");
    PROCESS_INFORMATION processInfo{};
    std::vector<wchar_t> command = brokerCommandLine(
        executable,
        request.effect_id,
        request.effect_generation,
        request.session_id);
    const std::wstring currentDirectory = parentDirectory(executable);

    const DWORD creationFlags = CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NEW_PROCESS_GROUP;
    if (!CreateProcessAsUserW(
            userToken.get(),
            executable.c_str(),
            command.data(),
            nullptr,
            nullptr,
            FALSE,
            creationFlags,
            environment.get(),
            currentDirectory.empty() ? nullptr : currentDirectory.c_str(),
            &startup,
            &processInfo)) {
        return makeResult(BrokerDispatchState::NoEffectProven, "CREATE_PROCESS_AS_USER_FAILED", GetLastError());
    }

    ScopedHandle process(processInfo.hProcess);
    ScopedHandle thread(processInfo.hThread);
    const DWORD pid = processInfo.dwProcessId;

    FILETIME creation{}, exit{}, kernel{}, user{};
    if (!GetProcessTimes(process.get(), &creation, &exit, &kernel, &user)) {
        return preResumeFailure(
            "PROCESS_CREATION_TIME_READBACK_FAILED",
            GetLastError(),
            process.get(),
            true);
    }
    const std::uint64_t creationTime = fileTimeValue(creation);
    if (creationTime == 0) {
        return preResumeFailure(
            "PROCESS_CREATION_TIME_INVALID",
            ERROR_INVALID_DATA,
            process.get(),
            true);
    }

    DWORD observedSessionId = 0;
    if (!ProcessIdToSessionId(pid, &observedSessionId)
        || observedSessionId != request.session_id) {
        return preResumeFailure(
            "PROCESS_SESSION_READBACK_MISMATCH",
            GetLastError(),
            process.get(),
            true);
    }

    HANDLE rawChildToken = nullptr;
    if (!OpenProcessToken(process.get(), TOKEN_QUERY, &rawChildToken)) {
        return preResumeFailure(
            "CHILD_TOKEN_OPEN_FAILED",
            GetLastError(),
            process.get(),
            true);
    }
    ScopedHandle childToken(rawChildToken);
    const std::wstring childSid = tokenSidString(childToken.get());
    if (childSid.empty()
        || _wcsicmp(childSid.c_str(), request.expected_owner_sid.c_str()) != 0) {
        return preResumeFailure(
            "CHILD_OWNER_SID_MISMATCH",
            ERROR_INVALID_OWNER,
            process.get(),
            true);
    }
    if (!tokenSessionMatches(childToken.get(), request.session_id)) {
        return preResumeFailure(
            "CHILD_TOKEN_SESSION_MISMATCH",
            ERROR_INVALID_PARAMETER,
            process.get(),
            true);
    }

    if (!AssignProcessToJobObject(job.get(), process.get())) {
        return preResumeFailure(
            "JOB_ASSIGN_FAILED",
            GetLastError(),
            process.get(),
            true);
    }
    BOOL inJob = FALSE;
    if (!IsProcessInJob(process.get(), job.get(), &inJob) || inJob == FALSE) {
        return preResumeFailure(
            "JOB_BINDING_READBACK_FAILED",
            GetLastError(),
            process.get(),
            true);
    }

    JOBOBJECT_EXTENDED_LIMIT_INFORMATION jobReadback{};
    if (!QueryInformationJobObject(
            job.get(),
            JobObjectExtendedLimitInformation,
            &jobReadback,
            sizeof(jobReadback),
            nullptr)
        || (jobReadback.BasicLimitInformation.LimitFlags & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE) == 0) {
        return preResumeFailure(
            "JOB_KILL_ON_CLOSE_READBACK_FAILED",
            GetLastError(),
            process.get(),
            true);
    }

    if (ResumeThread(thread.get()) == static_cast<DWORD>(-1)) {
        return preResumeFailure(
            "BROKER_RESUME_FAILED",
            GetLastError(),
            process.get(),
            true);
    }
    thread.reset();

    lease_out->process_ = process.release();
    lease_out->job_ = job.release();
    lease_out->pid_ = pid;

    BrokerLaunchResult out = makeResult(BrokerDispatchState::Dispatched, "EXACT_BROKER_DISPATCHED");
    out.pid = pid;
    out.creation_time_100ns = creationTime;
    out.process_incarnation_id = incarnationId(pid, creationTime);
    out.session_id = observedSessionId;
    out.user_sid = childSid;
    out.created_suspended = true;
    out.exact_session_binding = true;
    out.exact_process_binding = true;
    out.kill_on_close_job_binding = true;
    out.resumed = true;
    return out;
}

}  // namespace metaengine::guardian
