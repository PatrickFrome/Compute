#include "browser-guardian-original-install-user.hpp"

#include <sddl.h>

#include <array>
#include <cstddef>
#include <mutex>
#include <utility>
#include <vector>

namespace metaengine::guardian {
namespace {

struct Handle {
    HANDLE value = nullptr;
    explicit Handle(HANDLE handle = nullptr) : value(handle) {}
    ~Handle() { reset(); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    Handle(Handle&& other) noexcept : value(std::exchange(other.value, nullptr)) {}
    Handle& operator=(Handle&& other) noexcept {
        if (this != &other) reset(std::exchange(other.value, nullptr));
        return *this;
    }
    bool valid() const noexcept { return value != nullptr && value != INVALID_HANDLE_VALUE; }
    void reset(HANDLE handle = nullptr) noexcept { if (valid()) CloseHandle(value); value = handle; }
};

std::uint64_t timeValue(const FILETIME& time) {
    ULARGE_INTEGER value{};
    value.LowPart = time.dwLowDateTime; value.HighPart = time.dwHighDateTime;
    return value.QuadPart;
}

bool equalLuid(const LUID& a, const LUID& b) {
    return a.LowPart == b.LowPart && a.HighPart == b.HighPart;
}

std::uint64_t luidValue(const LUID& luid) {
    return (static_cast<std::uint64_t>(static_cast<DWORD>(luid.HighPart)) << 32) | luid.LowPart;
}

std::wstring processImage(HANDLE process) {
    std::array<wchar_t, 32768> bytes{};
    DWORD count = static_cast<DWORD>(bytes.size());
    if (!QueryFullProcessImageNameW(process, 0, bytes.data(), &count) || count == 0 || count >= bytes.size()) return {};
    return std::wstring(bytes.data(), count);
}

bool tokenBytes(HANDLE token, TOKEN_INFORMATION_CLASS kind, std::vector<BYTE>* bytes) {
    DWORD required = 0;
    GetTokenInformation(token, kind, nullptr, 0, &required);
    if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || required == 0 || required > 1024 * 1024) return false;
    bytes->resize(required);
    return GetTokenInformation(token, kind, bytes->data(), required, &required) != FALSE;
}

struct TokenFacts {
    std::wstring sid;
    DWORD session = 0;
    LUID logon{};
    LUID token_id{};
    LUID modified_id{};
};

bool tokenFacts(HANDLE token, bool primary, TokenFacts* facts, const char** reason) {
    TOKEN_STATISTICS stats{};
    DWORD written = 0;
    if (!GetTokenInformation(token, TokenStatistics, &stats, sizeof(stats), &written) || written != sizeof(stats) ||
        stats.TokenType != (primary ? TokenPrimary : TokenImpersonation) || luidValue(stats.AuthenticationId) == 0) {
        *reason = "ORIGINAL_TOKEN_TYPE_OR_LOGON_UNAVAILABLE"; return false;
    }
    if (!primary) {
        SECURITY_IMPERSONATION_LEVEL level = SecurityAnonymous;
        if (!GetTokenInformation(token, TokenImpersonationLevel, &level, sizeof(level), &written) ||
            written != sizeof(level) || level < SecurityIdentification || level > SecurityImpersonation) {
            *reason = "ORIGINAL_PIPE_TOKEN_LEVEL_UNAVAILABLE"; return false;
        }
    }
    TOKEN_ELEVATION elevation{};
    DWORD app_container = 1;
    if (!GetTokenInformation(token, TokenElevation, &elevation, sizeof(elevation), &written) || written != sizeof(elevation) ||
        !GetTokenInformation(token, TokenIsAppContainer, &app_container, sizeof(app_container), &written) ||
        written != sizeof(app_container)) {
        *reason = "ORIGINAL_TOKEN_POLICY_UNAVAILABLE"; return false;
    }
    if (elevation.TokenIsElevated != 0 || app_container != 0 || IsTokenRestricted(token)) {
        *reason = "ORIGINAL_UNELEVATED_USER_REQUIRED"; SetLastError(ERROR_ACCESS_DENIED); return false;
    }
    std::vector<BYTE> integrity;
    if (!tokenBytes(token, TokenIntegrityLevel, &integrity)) { *reason = "ORIGINAL_INTEGRITY_UNAVAILABLE"; return false; }
    const auto* label = reinterpret_cast<const TOKEN_MANDATORY_LABEL*>(integrity.data());
    if (!IsValidSid(label->Label.Sid) || *GetSidSubAuthorityCount(label->Label.Sid) == 0) {
        *reason = "ORIGINAL_INTEGRITY_UNAVAILABLE"; return false;
    }
    const auto count = *GetSidSubAuthorityCount(label->Label.Sid);
    const DWORD level = *GetSidSubAuthority(label->Label.Sid, count - 1);
    if (level < SECURITY_MANDATORY_MEDIUM_RID || level >= SECURITY_MANDATORY_HIGH_RID) {
        *reason = "ORIGINAL_MEDIUM_USER_REQUIRED"; SetLastError(ERROR_ACCESS_DENIED); return false;
    }
    std::vector<BYTE> groups;
    if (!tokenBytes(token, TokenGroups, &groups) || groups.size() < sizeof(TOKEN_GROUPS)) {
        *reason = "ORIGINAL_LOGON_SID_UNAVAILABLE"; return false;
    }
    const auto* token_groups = reinterpret_cast<const TOKEN_GROUPS*>(groups.data());
    const auto maximum_groups = (groups.size() - offsetof(TOKEN_GROUPS, Groups)) / sizeof(SID_AND_ATTRIBUTES);
    if (token_groups->GroupCount > maximum_groups) {
        *reason = "ORIGINAL_LOGON_SID_UNAVAILABLE"; SetLastError(ERROR_INVALID_DATA); return false;
    }
    bool logon_group = false;
    for (DWORD i = 0; i < token_groups->GroupCount; ++i) {
        const auto& group = token_groups->Groups[i];
        if ((group.Attributes & SE_GROUP_LOGON_ID) == SE_GROUP_LOGON_ID && IsValidSid(group.Sid)) {
            if (logon_group) { *reason = "ORIGINAL_LOGON_SID_UNAVAILABLE"; SetLastError(ERROR_INVALID_DATA); return false; }
            logon_group = true;
        }
    }
    if (!logon_group) { *reason = "ORIGINAL_INTERACTIVE_LOGON_REQUIRED"; SetLastError(ERROR_ACCESS_DENIED); return false; }
    std::vector<BYTE> user;
    if (!tokenBytes(token, TokenUser, &user)) { *reason = "ORIGINAL_TOKEN_USER_UNAVAILABLE"; return false; }
    const auto* row = reinterpret_cast<const TOKEN_USER*>(user.data());
    if (!IsValidSid(row->User.Sid) || IsWellKnownSid(row->User.Sid, WinLocalSystemSid) ||
        IsWellKnownSid(row->User.Sid, WinLocalServiceSid) || IsWellKnownSid(row->User.Sid, WinNetworkServiceSid)) {
        *reason = "ORIGINAL_INTERACTIVE_USER_REQUIRED"; SetLastError(ERROR_ACCESS_DENIED); return false;
    }
    LPWSTR raw = nullptr;
    if (!ConvertSidToStringSidW(row->User.Sid, &raw) || !raw) { *reason = "ORIGINAL_TOKEN_SID_UNAVAILABLE"; return false; }
    const std::unique_ptr<wchar_t, decltype(&LocalFree)> owned_sid(raw, &LocalFree);
    facts->sid = owned_sid.get();
    if (!GetTokenInformation(token, TokenSessionId, &facts->session, sizeof(facts->session), &written) ||
        written != sizeof(facts->session) || facts->session == 0) {
        *reason = "ORIGINAL_INTERACTIVE_SESSION_REQUIRED"; SetLastError(ERROR_ACCESS_DENIED); return false;
    }
    facts->logon = stats.AuthenticationId;
    facts->token_id = stats.TokenId;
    facts->modified_id = stats.ModifiedId;
    return true;
}

bool sameUser(const TokenFacts& a, const TokenFacts& b) {
    return a.sid == b.sid && a.session == b.session && equalLuid(a.logon, b.logon);
}

bool samePrimary(const TokenFacts& a, const TokenFacts& b) {
    return sameUser(a, b) && equalLuid(a.token_id, b.token_id) && equalLuid(a.modified_id, b.modified_id);
}

bool noThreadToken() {
    HANDLE raw = nullptr;
    if (OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, TRUE, &raw)) {
        CloseHandle(raw); SetLastError(ERROR_BAD_IMPERSONATION_LEVEL); return false;
    }
    return GetLastError() == ERROR_NO_TOKEN;
}

std::string asciiSid(const std::wstring& sid) {
    std::string out;
    for (wchar_t c : sid) {
        if ((c < L'0' || c > L'9') && c != L'S' && c != L'-') return {};
        out.push_back(static_cast<char>(c));
    }
    return out;
}

}  // namespace

struct GuardianOriginalInstallUser::State {
    mutable std::mutex mutex;
    // Kept until State destruction, including after close(), so nonblocking
    // requestCancel never races a closed/recycled cancellation HANDLE.
    Handle cancelled{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
    Handle process;
    Handle primary_token;
    Handle pipe;
    Handle message_token;
    TokenFacts original;
    TokenFacts message;
    DWORD original_pid = 0;
    std::uint64_t original_birth = 0;
    std::wstring original_image;
    enum class PipeSide { None, ServerPeer, ClientPeer } side = PipeSide::None;
    bool captured = false;
    bool current = false;
    bool pipe_lost = false;
    bool closed = false;
    const char* reason = "ORIGINAL_INSTALL_USER_NOT_CAPTURED";
    DWORD error = ERROR_SUCCESS;

    bool fail(const char* text, DWORD code = ERROR_SUCCESS) {
        current = false; reason = text;
        error = code != ERROR_SUCCESS ? code : GetLastError();
        if (error == ERROR_SUCCESS) error = ERROR_INVALID_DATA;
        return false;
    }

    bool active() {
        return !closed && cancelled.valid() && WaitForSingleObject(cancelled.value, 0) == WAIT_TIMEOUT;
    }

    bool processExact(HANDLE candidate) const {
        if (!candidate || candidate == INVALID_HANDLE_VALUE || original_pid == 0 ||
            GetProcessId(candidate) != original_pid || WaitForSingleObject(candidate, 0) != WAIT_TIMEOUT) return false;
        FILETIME born{}, exited{}, kernel{}, user{};
        return GetProcessTimes(candidate, &born, &exited, &kernel, &user) && timeValue(born) == original_birth &&
            processImage(candidate) == original_image;
    }

    bool retainProcess(DWORD observed) {
        process.reset(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, observed));
        if (!process.valid() || GetProcessId(process.value) != observed || WaitForSingleObject(process.value, 0) != WAIT_TIMEOUT) {
            return fail("ORIGINAL_INSTALL_PROCESS_UNAVAILABLE");
        }
        FILETIME born{}, exited{}, kernel{}, user{};
        if (!GetProcessTimes(process.value, &born, &exited, &kernel, &user) ||
            (original_birth = timeValue(born)) <= 116444736000000000ULL ||
            (original_image = processImage(process.value)).empty()) return fail("ORIGINAL_PROCESS_BIRTH_IMAGE_UNAVAILABLE");
        original_pid = observed;
        HANDLE raw = nullptr;
        if (!OpenProcessToken(process.value, TOKEN_QUERY, &raw)) return fail("ORIGINAL_PRIMARY_TOKEN_UNAVAILABLE");
        primary_token.reset(raw);
        const char* why = "ORIGINAL_PRIMARY_TOKEN_UNAVAILABLE";
        if (!tokenFacts(primary_token.value, true, &original, &why)) return fail(why);
        DWORD process_session = 0;
        if (!ProcessIdToSessionId(original_pid, &process_session) || process_session != original.session) {
            return fail("ORIGINAL_PROCESS_TOKEN_SESSION_MISMATCH", ERROR_INVALID_DATA);
        }
        return true;
    }

    bool pipeExact() {
        if (side == PipeSide::None) return true;
        if (pipe_lost) return fail("ORIGINAL_INSTALL_PIPE_CONNECTION_LOST", ERROR_BROKEN_PIPE);
        ULONG client = 0, server = 0;
        DWORD flags = 0;
        const bool local_server = side == PipeSide::ClientPeer;
        if (!pipe.valid() || GetFileType(pipe.value) != FILE_TYPE_PIPE ||
            !GetNamedPipeInfo(pipe.value, &flags, nullptr, nullptr, nullptr) ||
            (flags & PIPE_TYPE_MESSAGE) == 0 || ((flags & PIPE_SERVER_END) != 0) != local_server ||
            !PeekNamedPipe(pipe.value, nullptr, 0, nullptr, nullptr, nullptr) ||
            !GetNamedPipeClientProcessId(pipe.value, &client) || !GetNamedPipeServerProcessId(pipe.value, &server) ||
            (local_server ? server : client) != GetCurrentProcessId() ||
            (local_server ? client : server) != original_pid) {
            pipe_lost = true;
            return fail("ORIGINAL_INSTALL_PIPE_CONNECTION_LOST");
        }
        return true;
    }

    bool recheck() {
        current = false;
        if (!active()) return fail("ORIGINAL_INSTALL_USER_CANCELLED", ERROR_OPERATION_ABORTED);
        if (!captured || !process.valid() || !primary_token.valid() || !processExact(process.value)) {
            return fail("ORIGINAL_INSTALL_PROCESS_BINDING_LOST");
        }
        if (!noThreadToken()) return fail("ORIGINAL_CAPTURE_THREAD_IMPERSONATING");
        TokenFacts retained, fresh;
        const char* why = "ORIGINAL_PRIMARY_TOKEN_UNAVAILABLE";
        if (!tokenFacts(primary_token.value, true, &retained, &why) || !samePrimary(retained, original)) {
            return fail("ORIGINAL_RETAINED_TOKEN_CHANGED", ERROR_INVALID_DATA);
        }
        HANDLE raw = nullptr;
        if (!OpenProcessToken(process.value, TOKEN_QUERY, &raw)) return fail("ORIGINAL_CURRENT_PRIMARY_TOKEN_UNAVAILABLE");
        Handle token(raw);
        if (!tokenFacts(token.value, true, &fresh, &why) || !samePrimary(fresh, original)) {
            return fail("ORIGINAL_PROCESS_PRIMARY_TOKEN_CHANGED", ERROR_INVALID_DATA);
        }
        DWORD process_session = 0;
        if (!ProcessIdToSessionId(original_pid, &process_session) || process_session != original.session || !pipeExact()) {
            return fail("ORIGINAL_INSTALL_POSTCHECK_FAILED", ERROR_INVALID_DATA);
        }
        if (message_token.valid()) {
            TokenFacts held_message;
            if (!tokenFacts(message_token.value, false, &held_message, &why) ||
                !samePrimary(held_message, message) || !sameUser(held_message, original)) {
                return fail("ORIGINAL_PIPE_MESSAGE_TOKEN_CHANGED", ERROR_INVALID_DATA);
            }
        }
        if (!active() || !processExact(process.value)) return fail("ORIGINAL_INSTALL_POSTCHECK_FAILED", ERROR_OPERATION_ABORTED);
        current = true;
        reason = "ORIGINAL_USER_RETAINED_SOURCE_UNQUALIFIED";
        error = ERROR_SUCCESS;
        return true;
    }

    bool retainPipe(HANDLE original_pipe, PipeSide expected) {
        HANDLE duplicate = nullptr;
        if (!DuplicateHandle(GetCurrentProcess(), original_pipe, GetCurrentProcess(), &duplicate, 0, FALSE, DUPLICATE_SAME_ACCESS)) {
            return fail("ORIGINAL_INSTALL_PIPE_DUPLICATION_FAILED");
        }
        pipe.reset(duplicate); side = expected;
        ULONG peer = 0;
        if (!(side == PipeSide::ServerPeer ? GetNamedPipeServerProcessId(pipe.value, &peer) :
                GetNamedPipeClientProcessId(pipe.value, &peer)) || peer == 0) return fail("ORIGINAL_INSTALL_PIPE_PEER_UNAVAILABLE");
        if (!retainProcess(peer) || !pipeExact()) return false;
        return true;
    }

    bool retainMessageIdentity() {
        if (!ImpersonateNamedPipeClient(pipe.value)) return fail("ORIGINAL_PIPE_IMPERSONATION_FAILED");
        HANDLE raw = nullptr;
        const bool opened = OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, TRUE, &raw) != FALSE;
        const DWORD open_error = opened ? ERROR_SUCCESS : GetLastError();
        message_token.reset(raw);
        const char* why = "ORIGINAL_PIPE_TOKEN_UNAVAILABLE";
        bool read = false;
        DWORD read_error = open_error;
        try {
            read = opened && tokenFacts(message_token.value, false, &message, &why);
            read_error = read ? ERROR_SUCCESS : GetLastError();
        } catch (...) {
            // Allocation/query failures must still leave the original native
            // server thread reverted before any result or exception escapes.
            why = "ORIGINAL_PIPE_TOKEN_READ_EXCEPTION";
            read_error = ERROR_NOT_ENOUGH_MEMORY;
        }
        // Never return while the service thread deliberately remains impersonated.
        // A failed revert is surfaced distinctly so the native caller stops.
        if (!RevertToSelf()) return fail("ORIGINAL_PIPE_REVERT_TO_SELF_FAILED");
        if (!read) return fail(opened ? why : "ORIGINAL_PIPE_TOKEN_UNAVAILABLE", opened ? read_error : open_error);
        if (!sameUser(message, original)) return fail("ORIGINAL_PIPE_PRIMARY_TOKEN_MISMATCH", ERROR_INVALID_DATA);
        return true;
    }
};

GuardianOriginalInstallUser::GuardianOriginalInstallUser() : state_(std::make_unique<State>()) {}
GuardianOriginalInstallUser::~GuardianOriginalInstallUser() { close(); }

std::unique_ptr<GuardianOriginalInstallUser> GuardianOriginalInstallUser::captureCurrentBeforeElevation() {
    auto out = std::unique_ptr<GuardianOriginalInstallUser>(new GuardianOriginalInstallUser());
    try {
    if (!out->state_->active()) { out->state_->fail("ORIGINAL_CAPTURE_CANCEL_EVENT_UNAVAILABLE"); return out; }
    if (!noThreadToken()) { out->state_->fail("ORIGINAL_CAPTURE_THREAD_IMPERSONATING"); return out; }
    if (!out->state_->retainProcess(GetCurrentProcessId())) return out;
    out->state_->captured = true;
    out->state_->recheck();
    } catch (...) { out->state_->fail("ORIGINAL_INSTALL_CAPTURE_EXCEPTION", ERROR_NOT_ENOUGH_MEMORY); }
    return out;
}

std::unique_ptr<GuardianOriginalInstallUser> GuardianOriginalInstallUser::captureOriginalPipeServer(HANDLE original_pipe) {
    auto out = std::unique_ptr<GuardianOriginalInstallUser>(new GuardianOriginalInstallUser());
    try {
    if (!out->state_->active()) { out->state_->fail("ORIGINAL_CAPTURE_CANCEL_EVENT_UNAVAILABLE"); return out; }
    if (!noThreadToken()) { out->state_->fail("ORIGINAL_CAPTURE_THREAD_IMPERSONATING"); return out; }
    if (!out->state_->retainPipe(original_pipe, State::PipeSide::ServerPeer)) return out;
    out->state_->captured = true;
    out->state_->recheck();
    } catch (...) { out->state_->fail("ORIGINAL_INSTALL_CAPTURE_EXCEPTION", ERROR_NOT_ENOUGH_MEMORY); }
    return out;
}

std::unique_ptr<GuardianOriginalInstallUser> GuardianOriginalInstallUser::captureOriginalPipeClient(HANDLE original_pipe) {
    auto out = std::unique_ptr<GuardianOriginalInstallUser>(new GuardianOriginalInstallUser());
    try {
    if (!out->state_->active()) { out->state_->fail("ORIGINAL_CAPTURE_CANCEL_EVENT_UNAVAILABLE"); return out; }
    if (!noThreadToken()) { out->state_->fail("ORIGINAL_CAPTURE_THREAD_IMPERSONATING"); return out; }
    if (!out->state_->retainPipe(original_pipe, State::PipeSide::ClientPeer) || !out->state_->retainMessageIdentity()) return out;
    out->state_->captured = true;
    out->state_->recheck();
    } catch (...) { out->state_->fail("ORIGINAL_INSTALL_CAPTURE_EXCEPTION", ERROR_NOT_ENOUGH_MEMORY); }
    return out;
}

bool GuardianOriginalInstallUser::recheck() {
    std::lock_guard<std::mutex> guard(state_->mutex);
    try { return state_->recheck(); }
    catch (...) { return state_->fail("ORIGINAL_INSTALL_RECHECK_EXCEPTION", ERROR_NOT_ENOUGH_MEMORY); }
}

void GuardianOriginalInstallUser::requestCancel() noexcept {
    if (state_ && state_->cancelled.valid()) SetEvent(state_->cancelled.value);
}

void GuardianOriginalInstallUser::close() noexcept {
    if (!state_) return;
    requestCancel();
    std::lock_guard<std::mutex> guard(state_->mutex);
    if (state_->closed) return;
    state_->closed = true; state_->captured = false; state_->current = false;
    state_->message_token.reset(); state_->pipe.reset();
    state_->primary_token.reset(); state_->process.reset();
    state_->original = {}; state_->message = {};
    state_->original_pid = 0; state_->original_birth = 0; state_->original_image.clear();
    state_->reason = "ORIGINAL_INSTALL_USER_CLOSED"; state_->error = ERROR_OPERATION_ABORTED;
}

std::string GuardianOriginalInstallUser::snapshotJson() const {
    std::lock_guard<std::mutex> guard(state_->mutex);
    // Identity facts are hidden when the most recent observation failed. Stored
    // original handles remain owned until close; no failed capture is promoted.
    const bool held = state_->current && !state_->closed && state_->cancelled.valid() &&
        WaitForSingleObject(state_->cancelled.value, 0) == WAIT_TIMEOUT;
    const bool cancelled = !state_->closed && state_->cancelled.valid() && WaitForSingleObject(state_->cancelled.value, 0) != WAIT_TIMEOUT;
    const auto reason = cancelled ? "ORIGINAL_INSTALL_USER_CANCELLED" : state_->reason;
    const auto error = cancelled ? ERROR_OPERATION_ABORTED : state_->error;
    return std::string("{\"schema\":\"metaengine.browser-guardian.original-install-user-observation.v1\",\"state\":\"") +
        (held ? "SOURCE_ONLY" : "HOLD") + "\",\"reason\":\"" + reason +
        "\",\"identity_binding\":\"" + (held ? "RETAINED" : "UNPROVEN") +
        "\",\"original_pid\":" + std::to_string(held ? state_->original_pid : 0) +
        ",\"original_creation_time_100ns\":\"" + (held ? std::to_string(state_->original_birth) : std::string{}) +
        "\",\"original_sid\":\"" + (held ? asciiSid(state_->original.sid) : std::string{}) +
        "\",\"original_session\":" + std::to_string(held ? state_->original.session : 0) +
        ",\"original_logon_id\":\"" + (held ? std::to_string(luidValue(state_->original.logon)) : std::string{}) +
        "\",\"source_release_binding\":\"UNQUALIFIED\",\"launch_admission\":\"UNAVAILABLE\",\"win32_error\":" +
        std::to_string(error) + ",\"authority_effect\":false}";
}

bool GuardianOriginalInstallUser::matchesOriginalProcess(HANDLE process) const {
    std::lock_guard<std::mutex> guard(state_->mutex);
    try { return state_->current && state_->active() && state_->processExact(process); }
    catch (...) { return false; }
}

HANDLE GuardianOriginalInstallUser::retainedProcess() const noexcept { return state_->process.value; }
HANDLE GuardianOriginalInstallUser::retainedToken() const noexcept { return state_->primary_token.value; }
DWORD GuardianOriginalInstallUser::pid() const noexcept { return state_->original_pid; }
std::uint64_t GuardianOriginalInstallUser::birth() const noexcept { return state_->original_birth; }
std::wstring GuardianOriginalInstallUser::sid() const { return state_->original.sid; }
DWORD GuardianOriginalInstallUser::session() const noexcept { return state_->original.session; }
LUID GuardianOriginalInstallUser::logon() const noexcept { return state_->original.logon; }

}  // namespace metaengine::guardian
