// Qualification-only consumer of the separately compiled production API.
// No implementation include, signing operation, key override or service action.
#include "browser-guardian-release-signature.hpp"

#ifdef _WIN32
#include <windows.h>
#include <cwchar>
#else
#include <dlfcn.h>
#include <cstring>
#endif
#include <cstdio>
#include <cstdlib>

namespace {
int verifyProductionLinkage() {
    const std::array<std::uint8_t, 64> zeroSignature{};
    if (metaengine::guardian::verifyGuardianReleaseSignatureV2("{}", zeroSignature)) return 10;
    // Same well-formed W77 fixture shape exercised by the cross-language suite.
    // The canonical input reaches production crypto; a zero signature must fail
    // against the existing compiled release root. No root-positive is invented.
    const std::string canonical =
        "{\"schema\":\"metaengine.browser.installed-release-manifest.v2\",\"source_sha\":\"" + std::string(40, 'a')
        + "\",\"package_version\":\"0.7.0-dev.12345.1\",\"exe_name\":\"METAENGINE Browser Test.exe\",\"exe_sha256\":\"" + std::string(64, 'b')
        + "\",\"signer_thumbprint\":\"" + std::string(40, 'c') + "\",\"installer_sha256\":\"" + std::string(64, 'd')
        + "\",\"slsa_bundle_sha256\":\"" + std::string(64, 'e') + "\",\"slsa_evidence_sha256\":\"" + std::string(64, 'f')
        + "\",\"package_code_sha256\":\"" + std::string(64, '0') + "\"}";
    if (metaengine::guardian::verifyGuardianReleaseSignatureV2(canonical, zeroSignature)) return 11;
#ifdef _WIN32
    if (GetModuleHandleW(L"guardian_external_probe.dll") != nullptr) return 12;
    char loaded[8]{};
    if (GetEnvironmentVariableA("GUARDIAN_SENTINEL_LOADED", loaded, static_cast<DWORD>(sizeof(loaded))) != 0) return 13;
#else
    if (std::getenv("GUARDIAN_SENTINEL_LOADED") != nullptr) return 13;
#endif
    std::puts("{\"schema\":\"metaengine.guardian.signature-production-link-probe.v1\",\"malformed_manifest_rejected\":true,\"canonical_zero_signature_rejected\":true,\"sentinel_not_loaded\":true,\"productionroot_positive_available\":false,\"service_loaded_code_attested\":false}");
    return 0;
}
}  // namespace

#ifdef _WIN32
int wmain(int argc, wchar_t** argv) {
    if (argc == 3 && std::wcscmp(argv[1], L"--sentinel-control") == 0) {
        // Explicit test-only positive control. Builder supplies its own freshly
        // built disposable DLL; this mode is never part of the production API.
        HMODULE module = LoadLibraryW(argv[2]);
        if (module == nullptr) return 20;
        wchar_t loaded[8]{};
        const bool flagged = GetEnvironmentVariableW(L"GUARDIAN_SENTINEL_LOADED", loaded, static_cast<DWORD>(sizeof(loaded) / sizeof(loaded[0]))) != 0;
        FreeLibrary(module);
        if (!flagged) return 21;
        std::puts("{\"schema\":\"metaengine.guardian.signature-sentinel-control.v1\",\"sentinel_loaded\":true}");
        return 0;
    }
    return argc == 1 ? verifyProductionLinkage() : 2;
}
#else
int main(int argc, char** argv) {
    if (argc == 3 && std::strcmp(argv[1], "--sentinel-control") == 0) {
        void* module = dlopen(argv[2], RTLD_NOW | RTLD_LOCAL);
        if (module == nullptr) return 20;
        const bool flagged = std::getenv("GUARDIAN_SENTINEL_LOADED") != nullptr;
        dlclose(module);
        if (!flagged) return 21;
        std::puts("{\"schema\":\"metaengine.guardian.signature-sentinel-control.v1\",\"sentinel_loaded\":true}");
        return 0;
    }
    return argc == 1 ? verifyProductionLinkage() : 2;
}
#endif
