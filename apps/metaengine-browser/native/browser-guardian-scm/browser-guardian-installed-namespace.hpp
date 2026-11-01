#pragma once

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <cstdint>
#include <memory>
#include <string>

namespace metaengine::guardian {

class GuardianNativeRootSession;
class GuardianConnectedPeer;
struct ReleaseManifestV2;

// Filesystem mechanics, not an authenticity or launch capability. Production
// acquisition is private to the native session producer. Original handles and
// all ancestor identities remain owned here until destruction.
class GuardianInstalledNamespace final {
public:
    ~GuardianInstalledNamespace();
    GuardianInstalledNamespace(const GuardianInstalledNamespace&) = delete;
    GuardianInstalledNamespace& operator=(const GuardianInstalledNamespace&) = delete;

    bool recheck();
    const std::string& reason() const noexcept;
    DWORD error() const noexcept;
    const std::string& executableSha256() const noexcept;
    const std::string& namespaceSha256() const noexcept;
    std::size_t fileCount() const noexcept;
    bool releaseSignatureBound() const noexcept;
    const std::string& authenticityReason() const noexcept;

private:
    friend class GuardianNativeRootSession;
    friend class GuardianConnectedPeer;
#ifdef METAENGINE_GUARDIAN_NAMESPACE_TEST
    friend struct GuardianInstalledNamespaceTest;
#endif
    GuardianInstalledNamespace();
    static std::unique_ptr<GuardianInstalledNamespace> capture(const std::wstring& fixed_executable, HANDLE stop_event = nullptr);
    bool bindRetainedReleaseSignature();
    bool serializeRetainedPackage(const ReleaseManifestV2& manifest, std::string* bytes) const;
    bool readRetainedBytes(const std::wstring& relative, std::size_t limit, std::string* bytes) const;
    std::string retainedFileSha256(const std::wstring& relative) const;
    const ReleaseManifestV2* boundReleaseManifest() const noexcept;
    struct State;
    std::unique_ptr<State> state_;
};

}  // namespace metaengine::guardian
