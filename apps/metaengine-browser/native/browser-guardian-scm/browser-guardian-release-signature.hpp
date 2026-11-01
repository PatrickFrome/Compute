#pragma once

#include <array>
#include <cstdint>
#include <memory>
#include <string>
#include <string_view>

namespace metaengine::guardian {

// Signature authentication ONLY. Not file custody, Authenticode, loaded-code
// proof, Owner enrollment, launch permission or durable publication evidence.
struct ReleaseManifestV2 {
    std::string source_sha, package_version, exe_name, exe_sha256;
    std::string signer_thumbprint, installer_sha256, slsa_bundle_sha256;
    std::string slsa_evidence_sha256, package_code_sha256;
};

class VerifiedReleaseSignatureV2 final {
public:
    const ReleaseManifestV2& manifest() const noexcept { return manifest_; }
    const std::string& canonicalManifest() const noexcept { return canonical_; }
private:
    VerifiedReleaseSignatureV2(ReleaseManifestV2 manifest, std::string canonical);
    ReleaseManifestV2 manifest_;
    std::string canonical_;
    friend std::unique_ptr<const VerifiedReleaseSignatureV2> verifyGuardianReleaseSignatureV2(
        std::string_view, const std::array<std::uint8_t, 64>&);
};

// Exact canonical W77 manifest bytes, NOT an arbitrary JSON object or a claimed
// verified result. Root and signature domain are compiled in; no key override.
// Unavailable crypto, malformed input and invalid signatures all return null.
// Caller must independently establish current release/rollback policy and every
// manifest-to-file/process binding. A valid historical signature is not freshness.
std::unique_ptr<const VerifiedReleaseSignatureV2> verifyGuardianReleaseSignatureV2(
    std::string_view canonical_manifest, const std::array<std::uint8_t, 64>& signature);

}  // namespace metaengine::guardian
