#pragma once

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <cstdint>
#include <memory>
#include <string>

namespace metaengine::guardian {

class GuardianInstallOriginLink;

// Original Windows identity observation only. Release qualification and native
// installation/launch admission are separate prerequisites. Neither a snapshot
// nor possession of this object authorizes elevation, installation or execution.
class GuardianOriginalInstallUser final {
public:
    static std::unique_ptr<GuardianOriginalInstallUser> captureCurrentBeforeElevation();
    ~GuardianOriginalInstallUser();

    GuardianOriginalInstallUser(const GuardianOriginalInstallUser&) = delete;
    GuardianOriginalInstallUser& operator=(const GuardianOriginalInstallUser&) = delete;
    GuardianOriginalInstallUser(GuardianOriginalInstallUser&&) = delete;
    GuardianOriginalInstallUser& operator=(GuardianOriginalInstallUser&&) = delete;

    bool recheck();
    void requestCancel() noexcept;
    void close() noexcept;
    std::string snapshotJson() const;

private:
    friend class GuardianInstallOriginLink;
#ifdef METAENGINE_GUARDIAN_INSTALL_ORIGIN_TEST
    friend struct GuardianOriginalInstallUserTest;
#endif
    GuardianOriginalInstallUser();

    // Only the original native link may invoke these after a completed bounded
    // message read on its OWN connected pipe. No PID/SID/JSON/path is accepted.
    // The server-end owner must never reconnect that instance while its captured
    // client scope lives; the link owns one connection and closes it terminally.
    static std::unique_ptr<GuardianOriginalInstallUser> captureOriginalPipeServer(HANDLE original_connected_client_pipe);
    static std::unique_ptr<GuardianOriginalInstallUser> captureOriginalPipeClient(HANDLE original_connected_server_pipe);

    bool matchesOriginalProcess(HANDLE original_process) const;
    // Borrowed only under the owning link's serialized lifetime. Concurrent
    // cancellation never closes these; close/join belongs to that same owner.
    HANDLE retainedProcess() const noexcept;
    HANDLE retainedToken() const noexcept;
    DWORD pid() const noexcept;
    std::uint64_t birth() const noexcept;
    std::wstring sid() const;
    DWORD session() const noexcept;
    LUID logon() const noexcept;

    struct State;
    std::unique_ptr<State> state_;
};

}  // namespace metaengine::guardian
