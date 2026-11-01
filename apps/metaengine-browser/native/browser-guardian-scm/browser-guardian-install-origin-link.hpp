#pragma once
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <memory>
#include <string>
#include <string_view>

namespace metaengine::guardian {

// Installation-origin observation only. Factories derive Windows identity from
// ORIGINAL handles, never from protocol SID/PID/JSON. No Main/service effect.
class GuardianInstallOriginLink final {
public:
    static std::unique_ptr<GuardianInstallOriginLink> captureCoordinatorBeforeElevation();
    static std::unique_ptr<GuardianInstallOriginLink> createBootstrapObserver();
    static std::unique_ptr<GuardianInstallOriginLink> observeBootstrapOrigin(std::wstring_view generated_link_id);
    ~GuardianInstallOriginLink();
    GuardianInstallOriginLink(const GuardianInstallOriginLink&) = delete;
    GuardianInstallOriginLink& operator=(const GuardianInstallOriginLink&) = delete;
    // Actual current producer stops before UAC when real release qualification
    // is unavailable. No runtime verifier/path/consent flag can bypass it.
    bool requestElevation();
    bool observeOriginalCoordinator(std::wstring_view generated_link_id);
    bool waitForOriginalCoordinatorClose();
    void requestCancel() noexcept;
    void close() noexcept;
    std::string snapshotJson() const;
private:
    GuardianInstallOriginLink();
#ifdef METAENGINE_GUARDIAN_INSTALL_ORIGIN_TEST
    friend struct GuardianInstallOriginLinkTest;
    std::wstring routingIdForTest() const;
    // Read-only observation of a completed native availability wait slice.
    bool waitForInitialAvailabilityForTest(DWORD timeout_ms) const noexcept;
    unsigned pendingOperationForTest() const noexcept;
    void wakePendingEventEarlyForTest() noexcept;
#endif
    // Same native transport used after original ShellExecuteEx hProcess exists.
    // Only the production creator or compile-guarded mechanics fixture owns it.
    bool connectOriginalBootstrap(HANDLE original_bootstrap_process);
    bool listenAsBootstrap(std::wstring_view generated_link_id);
    struct State;
    std::unique_ptr<State> state_;
};
}
