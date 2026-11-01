#pragma once

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <memory>
#include <string>

namespace metaengine::guardian {

// In-process native observation of the ORIGINAL connected client pipe. The
// object, not any JSON snapshot, owns its pipe/process/image/source lifetimes.
// There is no caller path, PID, expected hash, HANDLE, root or verification flag.
// This stage sends no protocol request and cannot authorize MAIN or app.quit.
class GuardianConnectedPeer final {
public:
    static std::unique_ptr<GuardianConnectedPeer> connect();
    // Publish ownership before queuing potentially slow work, so cancellation
    // never waits for the worker pool that is currently doing the observation.
    static std::unique_ptr<GuardianConnectedPeer> create();
    bool connectOriginal();
    void requestCancel() noexcept;
    ~GuardianConnectedPeer();
    GuardianConnectedPeer(const GuardianConnectedPeer&) = delete;
    GuardianConnectedPeer& operator=(const GuardianConnectedPeer&) = delete;
    GuardianConnectedPeer(GuardianConnectedPeer&&) = delete;
    GuardianConnectedPeer& operator=(GuardianConnectedPeer&&) = delete;

    bool recheck();
    std::string snapshotJson() const;
    void close() noexcept;

private:
    GuardianConnectedPeer();
    struct State;
    std::unique_ptr<State> state_;
#ifdef METAENGINE_GUARDIAN_PEER_TEST
    friend struct GuardianConnectedPeerTest;
    static std::unique_ptr<GuardianConnectedPeer> observeTestConnection(HANDLE original_connected_pipe);
    bool recheckOriginalKernelForTest();
#endif
};

}  // namespace metaengine::guardian
