#include "browser-guardian-owner-enrollment-observer.hpp"

#include <sddl.h>

#include <string>
#include <vector>

namespace metaengine::guardian {
namespace {

constexpr wchar_t kPipeDaclSddl[] =
    L"D:P"
    L"(A;;FA;;;SY)"
    // Authenticated local clients receive only data/attribute/synchronize rights.
    // 0x4 (FILE_APPEND_DATA / FILE_CREATE_PIPE_INSTANCE) is deliberately absent.
    L"(A;;0x00100183;;;AU)";
constexpr DWORD kClientAccessMask =
    FILE_READ_DATA | FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | SYNCHRONIZE;

constexpr char kContractJson[] =
    "{\"schema\":\"metaengine.browser-guardian.owner-enrollment-native-observer.v1\","
    "\"version\":\"1.0.0\","
    "\"pipe_reject_remote_clients\":true,"
    "\"first_pipe_instance\":true,"
    "\"overlapped_io\":true,"
    "\"pipe_nowait_used\":false,"
    "\"explicit_dacl\":true,"
    "\"default_dacl_used\":false,"
    "\"generic_write_granted\":false,"
    "\"client_create_pipe_instance_allowed\":false,"
    "\"client_message_required_before_impersonation\":true,"
    "\"token_user_readback\":true,"
    "\"token_session_id_readback\":true,"
    "\"client_pid_readback\":true,"
    "\"revert_to_self_required\":true,"
    "\"revert_failure_requires_service_stop\":true,"
    "\"durable_enrollment_implemented\":false,"
    "\"device_challenge_verification_implemented\":false,"
    "\"wts_execution_allowed\":false,"
    "\"process_effect_allowed\":false,"
    "\"scm_effect_allowed\":false,"
    "\"automatic_retry_allowed\":false,"
    "\"second_scheduler_loop\":false,"
    "\"authority_effect\":false}";

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

OwnerEnrollmentObservation baseObservation() {
    OwnerEnrollmentObservation out;
    out.local_only = true;
    out.pipe_reject_remote_clients = true;
    out.explicit_dacl = true;
    out.default_dacl_used = false;
    out.first_pipe_instance = true;
    out.overlapped_io = true;
    out.pipe_nowait_used = false;
    out.generic_write_granted = false;
    out.client_create_pipe_instance_allowed = false;
    return out;
}

}  // namespace

OwnerEnrollmentPipe::~OwnerEnrollmentPipe() {
    if (pipe_ != nullptr && pipe_ != INVALID_HANDLE_VALUE) {
        DisconnectNamedPipe(pipe_);
        CloseHandle(pipe_);
    }
    pipe_ = nullptr;
    if (security_descriptor_ != nullptr) LocalFree(security_descriptor_);
    security_descriptor_ = nullptr;
}

bool OwnerEnrollmentPipe::create(const std::wstring& pipe_name) {
    if (valid() || pipe_name.rfind(L"\\\\.\\pipe\\", 0) != 0) return false;

    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            kPipeDaclSddl,
            SDDL_REVISION_1,
            &security_descriptor_,
            nullptr)) {
        security_descriptor_ = nullptr;
        return false;
    }

    SECURITY_ATTRIBUTES security{};
    security.nLength = sizeof(security);
    security.lpSecurityDescriptor = security_descriptor_;
    security.bInheritHandle = FALSE;

    pipe_ = CreateNamedPipeW(
        pipe_name.c_str(),
        PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE | FILE_FLAG_OVERLAPPED,
        PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
        1,
        4096,
        4096,
        0,
        &security);
    if (pipe_ == INVALID_HANDLE_VALUE) {
        pipe_ = nullptr;
        LocalFree(security_descriptor_);
        security_descriptor_ = nullptr;
        return false;
    }
    return true;
}

OwnerEnrollmentObservation OwnerEnrollmentPipe::observeClientIdentity(
    bool client_message_read_before_impersonation) {
    OwnerEnrollmentObservation out = baseObservation();
    out.client_message_read_before_impersonation = client_message_read_before_impersonation;
    if (!valid()) {
        out.reason = "PIPE_INVALID";
        out.win32_error = ERROR_INVALID_HANDLE;
        return out;
    }
    if (!client_message_read_before_impersonation) {
        out.reason = "CLIENT_MESSAGE_NOT_READ_BEFORE_IMPERSONATION";
        out.win32_error = ERROR_INVALID_STATE;
        return out;
    }

    ULONG clientPid = 0;
    if (!GetNamedPipeClientProcessId(pipe_, &clientPid) || clientPid == 0) {
        out.reason = "CLIENT_PID_READBACK_FAILED";
        out.win32_error = GetLastError();
        return out;
    }
    out.client_pid = static_cast<DWORD>(clientPid);

    if (!ImpersonateNamedPipeClient(pipe_)) {
        out.reason = "PIPE_CLIENT_IMPERSONATION_FAILED";
        out.win32_error = GetLastError();
        return out;
    }
    out.impersonation_succeeded = true;

    HANDLE token = nullptr;
    DWORD evidenceError = ERROR_SUCCESS;
    if (!OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, FALSE, &token)) {
        evidenceError = GetLastError();
    } else {
        out.user_sid = tokenSidString(token);
        out.token_user_readback = !out.user_sid.empty();

        DWORD sessionId = 0;
        DWORD written = 0;
        if (GetTokenInformation(token, TokenSessionId, &sessionId, sizeof(sessionId), &written)
            && written == sizeof(sessionId)) {
            out.session_id = sessionId;
            out.token_session_id_readback = true;
        } else if (evidenceError == ERROR_SUCCESS) {
            evidenceError = GetLastError();
        }
        CloseHandle(token);
    }

    if (!RevertToSelf()) {
        out.reason = "REVERT_TO_SELF_FAILED";
        out.win32_error = GetLastError();
        out.revert_to_self_succeeded = false;
        return out;
    }
    out.revert_to_self_succeeded = true;

    if (evidenceError != ERROR_SUCCESS || !out.token_user_readback || !out.token_session_id_readback) {
        out.reason = "CLIENT_TOKEN_READBACK_FAILED";
        out.win32_error = evidenceError == ERROR_SUCCESS ? ERROR_INVALID_DATA : evidenceError;
        return out;
    }

    out.reason = "TOKEN_IDENTITY_OBSERVED";
    out.win32_error = ERROR_SUCCESS;
    return out;
}

const char* browserGuardianOwnerEnrollmentObserverContractJson() noexcept {
    return kContractJson;
}

DWORD browserGuardianOwnerEnrollmentClientAccessMask() noexcept {
    return kClientAccessMask;
}

}  // namespace metaengine::guardian
