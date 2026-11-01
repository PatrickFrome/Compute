#include "browser-guardian-install-origin-link.hpp"
#include <iostream>

int wmain(int argc, wchar_t** argv) {
    if (argc == 2 && std::wstring_view(argv[1]) == L"--contract-json") {
        std::cout << "{\"schema\":\"metaengine.browser-guardian.install-origin-coordinator.v1\",\"execution_level\":\"asInvoker\","
            "\"original_unelevated_user_required\":true,\"caller_identity_allowed\":false,\"release_qualification_required_before_uac\":true,"
            "\"uac_implemented\":false,\"source_only\":true,\"authority_effect\":false}\n";
        return 0;
    }
    if (argc != 1) return 2;
    // The zero-argument executable is a real producer: retain its own original
    // process/primary token BEFORE considering UAC. No parent/caller identity.
    auto scope = metaengine::guardian::GuardianInstallOriginLink::captureCoordinatorBeforeElevation();
    scope->requestElevation(); // Current real release prerequisite is unavailable.
    std::cout << scope->snapshotJson() << '\n';
    return 2;
}
