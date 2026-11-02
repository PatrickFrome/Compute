#include "browser-guardian-release-signature.hpp"

#include <openssl/evp.h>
#include <openssl/provider.h>
#include <optional>
#include <utility>

namespace metaengine::guardian {
namespace {
// Same PUBLIC key as build/emergency-maintenance-public-key.pem. Tests bind the
// exact SPKI bytes/fingerprint. Never read a runtime key from Browser metadata.
constexpr std::array<std::uint8_t, 32> kReleasePublicKey = {
    0x85,0x19,0x6d,0x0e,0x0a,0xb0,0xe0,0x09,0x26,0x60,0x69,0xae,0xd0,0x6b,0x0d,0xdc,
    0xa2,0xb3,0x5b,0xb0,0x9b,0x79,0xa6,0xa3,0x99,0x68,0x8f,0x48,0xcd,0xe1,0xa3,0x5e,
};
constexpr char kDomain[] = "METAENGINE_INSTALLED_RELEASE_MANIFEST_V2\0";
constexpr std::string_view kSchema = "metaengine.browser.installed-release-manifest.v2";
constexpr std::array<std::string_view, 10> kFields = {"schema","source_sha","package_version","exe_name","exe_sha256",
    "signer_thumbprint","installer_sha256","slsa_bundle_sha256","slsa_evidence_sha256","package_code_sha256"};

bool lowerHex(std::string_view value, std::size_t length) {
    if (value.size() != length) return false;
    for (const char c : value) if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
    return true;
}

// A bounded canonical-format recognizer, NOT a general JSON parser. Every W77
// field is an ASCII string with a fixed grammar. Escapes, duplicate/extra keys,
// whitespace, alternate key order and trailing bytes are deliberately refused.
std::optional<ReleaseManifestV2> parseCanonicalManifest(std::string_view bytes) {
    if (bytes.empty() || bytes.size() > 2048) return std::nullopt;
    std::array<std::string, 10> values;
    std::size_t offset = 0;
    for (std::size_t i = 0; i < kFields.size(); ++i) {
        const std::string prefix = (i == 0 ? "{\"" : ",\"") + std::string(kFields[i]) + "\":\"";
        if (bytes.substr(offset, prefix.size()) != prefix) return std::nullopt;
        offset += prefix.size();
        const auto end = bytes.find('"', offset);
        if (end == std::string_view::npos || end - offset > 128) return std::nullopt;
        const auto value = bytes.substr(offset, end - offset);
        for (const unsigned char c : value) if (c < 32 || c > 126 || c == '\\') return std::nullopt;
        values[i] = value;
        offset = end + 1;
    }
    if (bytes.substr(offset) != "}" || values[0] != kSchema || !lowerHex(values[1], 40)
        || (values[3] != "METAENGINE Browser Test.exe" && values[3] != "METAENGINE-Browser.exe")) return std::nullopt;
    const std::string_view version = values[2];
    constexpr std::string_view start = "0.7.0-dev.", finish = ".1";
    if (!version.starts_with(start) || !version.ends_with(finish) || version.size() <= start.size() + finish.size()
        || version.size() > 64 || version[start.size()] == '0') return std::nullopt;
    // Same historical refusal as the existing W77 serializer. Cross-language
    // tests iterate its canonical source list, so additions cannot go unnoticed.
    constexpr std::string_view kReservedPackageVersions[] = {
        "0.7.0-dev.2728883494179.1",
        "0.7.0-dev.2656093458019.1",
        "0.7.0-dev.2529132193489.1",
        "0.7.0-dev.2457446823794.1",
        "0.7.0-dev.37781000062.1",
        "0.7.0-dev.842024784850.1",
        "0.7.0-dev.2309832227245.1",
        "0.7.0-dev.2257027431866.1",
    };
    for (const auto reserved : kReservedPackageVersions)
        if (version == reserved) return std::nullopt;
    for (const char c : version.substr(start.size(), version.size() - start.size() - finish.size()))
        if (c < '0' || c > '9') return std::nullopt;
    for (std::size_t i = 4; i < values.size(); ++i) if (!lowerHex(values[i], i == 5 ? 40 : 64)) return std::nullopt;
    return ReleaseManifestV2{values[1], values[2], values[3], values[4], values[5], values[6], values[7], values[8], values[9]};
}

// Vetted OpenSSL PureEd25519, one-shot verification of the complete domain and
// message; NOT ECDSA/Curve25519 or prehashed Ed25519ph. A fresh private context
// explicitly loads the default provider, without loading caller config files.
// Windows production packaging must pin/static-link its reviewed library before
// this component is mounted. The cloud system library only qualifies this unit.
bool verifyEd25519(std::string_view message, const std::array<std::uint8_t,64>& signature,
    const std::array<std::uint8_t,32>& public_key) {
    using Context = std::unique_ptr<OSSL_LIB_CTX, decltype(&OSSL_LIB_CTX_free)>;
    using Provider = std::unique_ptr<OSSL_PROVIDER, decltype(&OSSL_PROVIDER_unload)>;
    using Key = std::unique_ptr<EVP_PKEY, decltype(&EVP_PKEY_free)>;
    using Digest = std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)>;
    Context context(OSSL_LIB_CTX_new(), OSSL_LIB_CTX_free);
    if (!context) return false;
    Provider provider(OSSL_PROVIDER_load(context.get(), "default"), OSSL_PROVIDER_unload);
    if (!provider) return false;
    Key key(EVP_PKEY_new_raw_public_key_ex(context.get(), "ED25519", "provider=default",
        public_key.data(), public_key.size()), EVP_PKEY_free);
    Digest digest(EVP_MD_CTX_new(), EVP_MD_CTX_free);
    return key && digest && EVP_DigestVerifyInit_ex(digest.get(), nullptr, nullptr, context.get(), "provider=default", key.get(), nullptr) == 1
        && EVP_DigestVerify(digest.get(), signature.data(), signature.size(),
            reinterpret_cast<const unsigned char*>(message.data()), message.size()) == 1;
}
}  // namespace

VerifiedReleaseSignatureV2::VerifiedReleaseSignatureV2(ReleaseManifestV2 manifest, std::string canonical)
    : manifest_(std::move(manifest)), canonical_(std::move(canonical)) {}

std::unique_ptr<const VerifiedReleaseSignatureV2> verifyGuardianReleaseSignatureV2(
    std::string_view canonical_manifest, const std::array<std::uint8_t,64>& signature) {
    try {
        auto manifest = parseCanonicalManifest(canonical_manifest);
        if (!manifest) return nullptr;
        std::string material(kDomain, sizeof(kDomain) - 1); // includes exactly one domain NUL
        material.append(canonical_manifest);
        if (!verifyEd25519(material, signature, kReleasePublicKey)) return nullptr;
        return std::unique_ptr<const VerifiedReleaseSignatureV2>(new VerifiedReleaseSignatureV2(
            std::move(*manifest), std::string(canonical_manifest)));
    } catch (...) { return nullptr; }
}
}  // namespace metaengine::guardian
