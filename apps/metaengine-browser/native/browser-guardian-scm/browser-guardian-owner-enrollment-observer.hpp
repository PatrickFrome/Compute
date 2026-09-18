#pragma once

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <string>

namespace metaengine::guardian {

struct OwnerEnrollmentObservation {
    bool local_only = false;
    bool pipe_reject_remote_clients = false;
    bool explicit_dacl = false;
    bool default_dacl_used = true;
    bool first_pipe_instance = false;
    bool overlapped_io = false;
    bool pipe_nowait_used = false;
    bool generic_write_granted = false;
    bool client_create_pipe_instance_allowed = false;
    bool client_message_read_before_impersonation = false;
    bool impersonation_succeeded = false;
    bool revert_to_self_succeeded = false;
    bool token_user_readback = false;
    bool token_session_id_readback = false;
    DWORD client_pid = 0;
    DWORD session_id = 0;
    std::wstring user_sid;
    DWORD win32_error = ERROR_SUCCESS;
    std::string reason;
};

class OwnerEnrollmentPipe final {
public:
    OwnerEnrollmentPipe() = default;
    ~OwnerEnrollmentPipe();

    OwnerEnrollmentPipe(const OwnerEnrollmentPipe&) = delete;
    OwnerEnrollmentPipe& operator=(const OwnerEnrollmentPipe&) = delete;
    OwnerEnrollmentPipe(OwnerEnrollmentPipe&&) = delete;
    OwnerEnrollmentPipe& operator=(OwnerEnrollmentPipe&&) = delete;

    bool create(const std::wstring& pipe_name);
    HANDLE handle() const noexcept { return pipe_; }
    bool valid() const noexcept { return pipe_ != nullptr && pipe_ != INVALID_HANDLE_VALUE; }

    // The caller must complete one bounded message read from this connected pipe
    // before calling observeClientIdentity(). ImpersonateNamedPipeClient binds to
    // the security context of the last message read, so the ordering is part of
    // the authority fence rather than an implementation detail.
    OwnerEnrollmentObservation observeClientIdentity(bool client_message_read_before_impersonation);

private:
    HANDLE pipe_ = nullptr;
    PSECURITY_DESCRIPTOR security_descriptor_ = nullptr;
};

// Read-only native boundary description. No enrollment persistence, WTS token
// acquisition, process creation, service start, retry loop or scheduler lives here.
const char* browserGuardianOwnerEnrollmentObserverContractJson() noexcept;

// Exact client access mask expected by the eventual user-session client. It omits
// FILE_APPEND_DATA / FILE_CREATE_PIPE_INSTANCE by construction.
DWORD browserGuardianOwnerEnrollmentClientAccessMask() noexcept;

}  // namespace metaengine::guardian
