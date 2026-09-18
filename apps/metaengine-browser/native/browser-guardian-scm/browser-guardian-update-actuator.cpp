#include "browser-guardian-update-actuator.hpp"

#include <bcrypt.h>
#include <sddl.h>
#include <shlobj.h>
#include <userenv.h>
#include <wtsapi32.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <cstring>
#include <cwchar>
#include <regex>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace metaengine::guardian {
namespace {

constexpr char kProbeSchema[] = "metaengine.browser-guardian.owner-challenge-request.v1";
constexpr char kUpdateSchema[] = "metaengine.browser-guardian.update-actuator-request.v1";
constexpr char kEffectSchema[] = "metaengine.browser-guardian.update-effect-record.v1";
constexpr char kProbeProfile[] = "METAENGINE_GUARDIAN_OWNER_CHALLENGE_V1";
constexpr char kUpdateProfile[] = "METAENGINE_GUARDIAN_UPDATE_ACTUATOR_V1";
constexpr wchar_t kCandidateDir[] = L"update-candidates-v1";
constexpr wchar_t kEffectsDir[] = L"update-effects-v1";
constexpr wchar_t kCandidateName[] = L"METAENGINEBrowserUpdateCandidate.exe";
constexpr wchar_t kManifestName[] = L"verified-self-update-manifest.json";
constexpr wchar_t kInstalledRelative[] = L"Programs\\METAENGINE Browser Test\\METAENGINE Browser Test.exe";
constexpr wchar_t kIntakeRelative[] = L"METAENGINE\\Guardian\\update-intake-v1";
constexpr wchar_t kSecureDacl[] = L"D:P(A;;FA;;;SY)(A;;FA;;;BA)";
constexpr std::size_t kMaxWireBytes = 16 * 1024;
constexpr std::size_t kMaxManifestBytes = 1024 * 1024;
constexpr std::uint64_t kMaxInstallerBytes = 1024ULL * 1024ULL * 1024ULL;
constexpr DWORD kObserveTimeoutMs = 120'000;

constexpr char kContractJson[] =
    "{\"schema\":\"metaengine.browser-guardian.update-actuator.v1\","
    "\"version\":\"1.0.0\","
    "\"named_pipe\":\"\\\\\\\\.\\\\pipe\\\\METAENGINEBrowserGuardianUpdateV1\","
    "\"caller_identity_source\":\"IMPERSONATED_PIPE_CLIENT_TOKEN\","
    "\"durable_owner_store_required\":true,"
    "\"enrolled_p256_challenge_required\":true,"
    "\"caller_supplied_owner_sid_allowed\":false,"
    "\"caller_supplied_session_id_allowed\":false,"
    "\"caller_supplied_path_allowed\":false,"
    "\"caller_supplied_url_allowed\":false,"
    "\"caller_supplied_shell_allowed\":false,"
    "\"fixed_silent_installer_arguments\":[\"/S\"],"
    "\"machine_secure_candidate_copy_required\":true,"
    "\"installer_sha256_readback_required\":true,"
    "\"manifest_sha256_readback_required\":true,"
    "\"installed_executable_sha256_readback_required\":true,"
    "\"native_write_ahead_effect_barrier\":true,"
    "\"effect_barrier_flush_file_buffers\":true,"
    "\"at_most_one_dispatch_per_effect_id\":true,"
    "\"unknown_dispatch_result\":\"AMBIGUOUS\","
    "\"automatic_retry_allowed\":false,"
    "\"authority_effect\":false}";

struct ScopedHandle {
    HANDLE value = nullptr;
    explicit ScopedHandle(HANDLE handle = nullptr) : value(handle) {}
    ~ScopedHandle() { reset(); }
    ScopedHandle(const ScopedHandle&) = delete;
    ScopedHandle& operator=(const ScopedHandle&) = delete;
    ScopedHandle(ScopedHandle&& other) noexcept : value(std::exchange(other.value, nullptr)) {}
    ScopedHandle& operator=(ScopedHandle&& other) noexcept {
        if (this != &other) {
            reset();
            value = std::exchange(other.value, nullptr);
        }
        return *this;
    }
    bool valid() const noexcept { return value != nullptr && value != INVALID_HANDLE_VALUE; }
    HANDLE get() const noexcept { return value; }
    HANDLE release() noexcept { return std::exchange(value, nullptr); }
    void reset(HANDLE next = nullptr) noexcept {
        if (valid()) CloseHandle(value);
        value = next;
    }
};

struct ScopedEnvironment {
    LPVOID value = nullptr;
    ~ScopedEnvironment() { if (value != nullptr) DestroyEnvironmentBlock(value); }
    LPVOID* out() noexcept { return &value; }
};

struct LocalMemory {
    HLOCAL value = nullptr;
    ~LocalMemory() { if (value != nullptr) LocalFree(value); }
};

struct CoTaskMemory {
    PWSTR value = nullptr;
    ~CoTaskMemory() { if (value != nullptr) CoTaskMemFree(value); }
};

struct ProbeRequest {
    std::string command_id;
    std::string request_nonce;
    std::string public_jwk_x;
    std::string public_jwk_y;
    std::string signature;
};

struct UpdateRequest {
    std::string operation;
    std::string effect_id;
    std::uint64_t effect_generation = 0;
    std::string command_id;
    std::string request_nonce;
    std::string release_version;
    std::string candidate_git_sha;
    std::string installer_sha256;
    std::string manifest_sha256;
    std::string installed_executable_sha256;
    std::string public_jwk_x;
    std::string public_jwk_y;
    std::string signature;
};

struct EffectReadback {
    bool exists = false;
    bool exact = false;
    bool corrupt = false;
    std::string state;
    DWORD pid = 0;
    std::uint64_t creation_time_100ns = 0;
};

bool asciiPrintable(std::string_view value) {
    return std::all_of(value.begin(), value.end(), [](unsigned char ch) { return ch >= 0x20 && ch <= 0x7e; });
}

bool lowerHex(std::string_view value, std::size_t size) {
    return value.size() == size && std::all_of(value.begin(), value.end(), [](unsigned char ch) {
        return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f');
    });
}

bool uuid(std::string_view value) {
    if (value.size() != 36) return false;
    for (std::size_t i = 0; i < value.size(); ++i) {
        const char ch = value[i];
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (ch != '-') return false;
        } else if (!std::isxdigit(static_cast<unsigned char>(ch))) {
            return false;
        }
    }
    return true;
}

bool safeNonce(std::string_view value) {
    if (value.size() < 32 || value.size() > 128) return false;
    return std::all_of(value.begin(), value.end(), [](unsigned char ch) {
        return std::isalnum(ch) != 0 || ch == '_' || ch == '-';
    });
}

bool base64UrlText(std::string_view value, std::size_t expected) {
    return value.size() == expected && std::all_of(value.begin(), value.end(), [](unsigned char ch) {
        return std::isalnum(ch) != 0 || ch == '_' || ch == '-';
    });
}

bool devVersion(std::string_view value) {
    static const std::regex pattern(R"(^[0-9]+\.[0-9]+\.[0-9]+-dev\.[0-9]+\.1$)");
    return std::regex_match(value.begin(), value.end(), pattern);
}

bool takeLine(std::string_view* rest, std::string_view prefix, std::string* out) {
    if (rest == nullptr || out == nullptr) return false;
    const std::size_t pos = rest->find('\n');
    if (pos == std::string_view::npos) return false;
    const std::string_view current = rest->substr(0, pos);
    *rest = rest->substr(pos + 1);
    if (!current.starts_with(prefix)) return false;
    const std::string_view value = current.substr(prefix.size());
    if (!asciiPrintable(value)) return false;
    *out = std::string(value);
    return true;
}

bool parseU64(std::string_view text, std::uint64_t* out) {
    if (out == nullptr || text.empty() || text.size() > 20) return false;
    std::uint64_t value = 0;
    for (const char ch : text) {
        if (ch < '0' || ch > '9') return false;
        const unsigned digit = static_cast<unsigned>(ch - '0');
        if (value > (UINT64_MAX - digit) / 10ULL) return false;
        value = value * 10ULL + digit;
    }
    *out = value;
    return true;
}

bool parseProbe(std::string_view wire, ProbeRequest* out) {
    if (out == nullptr || wire.empty() || wire.size() > kMaxWireBytes) return false;
    std::string schema;
    ProbeRequest parsed;
    if (!takeLine(&wire, "wire_schema=", &schema)
        || !takeLine(&wire, "command_id=", &parsed.command_id)
        || !takeLine(&wire, "request_nonce=", &parsed.request_nonce)
        || !takeLine(&wire, "public_jwk_x=", &parsed.public_jwk_x)
        || !takeLine(&wire, "public_jwk_y=", &parsed.public_jwk_y)
        || !takeLine(&wire, "signature=", &parsed.signature)
        || !wire.empty()) return false;
    if (schema != kProbeSchema || !uuid(parsed.command_id) || !safeNonce(parsed.request_nonce)
        || !base64UrlText(parsed.public_jwk_x, 43) || !base64UrlText(parsed.public_jwk_y, 43)
        || !base64UrlText(parsed.signature, 86)) return false;
    *out = std::move(parsed);
    return true;
}

bool parseUpdate(std::string_view wire, UpdateRequest* out) {
    if (out == nullptr || wire.empty() || wire.size() > kMaxWireBytes) return false;
    std::string schema;
    std::string generation;
    UpdateRequest parsed;
    if (!takeLine(&wire, "wire_schema=", &schema)
        || !takeLine(&wire, "operation=", &parsed.operation)
        || !takeLine(&wire, "effect_id=", &parsed.effect_id)
        || !takeLine(&wire, "effect_generation=", &generation)
        || !takeLine(&wire, "command_id=", &parsed.command_id)
        || !takeLine(&wire, "request_nonce=", &parsed.request_nonce)
        || !takeLine(&wire, "release_version=", &parsed.release_version)
        || !takeLine(&wire, "candidate_git_sha=", &parsed.candidate_git_sha)
        || !takeLine(&wire, "installer_sha256=", &parsed.installer_sha256)
        || !takeLine(&wire, "manifest_sha256=", &parsed.manifest_sha256)
        || !takeLine(&wire, "installed_executable_sha256=", &parsed.installed_executable_sha256)
        || !takeLine(&wire, "public_jwk_x=", &parsed.public_jwk_x)
        || !takeLine(&wire, "public_jwk_y=", &parsed.public_jwk_y)
        || !takeLine(&wire, "signature=", &parsed.signature)
        || !wire.empty()) return false;
    if (schema != kUpdateSchema || (parsed.operation != "DISPATCH" && parsed.operation != "OBSERVE")
        || !uuid(parsed.effect_id) || !parseU64(generation, &parsed.effect_generation) || parsed.effect_generation == 0
        || !uuid(parsed.command_id) || !safeNonce(parsed.request_nonce) || !devVersion(parsed.release_version)
        || !lowerHex(parsed.candidate_git_sha, 40) || !lowerHex(parsed.installer_sha256, 64)
        || !lowerHex(parsed.manifest_sha256, 64) || !lowerHex(parsed.installed_executable_sha256, 64)
        || !base64UrlText(parsed.public_jwk_x, 43) || !base64UrlText(parsed.public_jwk_y, 43)
        || !base64UrlText(parsed.signature, 86)) return false;
    *out = std::move(parsed);
    return true;
}

int base64UrlValue(char ch) {
    if (ch >= 'A' && ch <= 'Z') return ch - 'A';
    if (ch >= 'a' && ch <= 'z') return 26 + ch - 'a';
    if (ch >= '0' && ch <= '9') return 52 + ch - '0';
    if (ch == '-') return 62;
    if (ch == '_') return 63;
    return -1;
}

bool decodeBase64Url(std::string_view text, std::vector<unsigned char>* out) {
    if (out == nullptr || text.empty()) return false;
    out->clear();
    std::uint32_t accumulator = 0;
    unsigned bits = 0;
    for (const char ch : text) {
        const int value = base64UrlValue(ch);
        if (value < 0) return false;
        accumulator = (accumulator << 6U) | static_cast<std::uint32_t>(value);
        bits += 6U;
        if (bits >= 8U) {
            bits -= 8U;
            out->push_back(static_cast<unsigned char>((accumulator >> bits) & 0xffU));
        }
    }
    if (bits != 0U && (accumulator & ((1U << bits) - 1U)) != 0U) return false;
    return true;
}

bool sha256Buffer(const unsigned char* bytes, std::size_t size, std::array<unsigned char, 32>* digest) {
    if (digest == nullptr || (bytes == nullptr && size != 0)) return false;
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0) return false;
    const NTSTATUS status = BCryptHash(
        algorithm,
        nullptr,
        0,
        const_cast<PUCHAR>(bytes),
        static_cast<ULONG>(size),
        digest->data(),
        static_cast<ULONG>(digest->size()));
    BCryptCloseAlgorithmProvider(algorithm, 0);
    return status == 0;
}

std::string hex(const unsigned char* bytes, std::size_t size) {
    static constexpr char digits[] = "0123456789abcdef";
    std::string out;
    out.resize(size * 2);
    for (std::size_t i = 0; i < size; ++i) {
        out[i * 2] = digits[(bytes[i] >> 4U) & 0x0fU];
        out[i * 2 + 1] = digits[bytes[i] & 0x0fU];
    }
    return out;
}

std::string sha256Text(std::string_view text) {
    std::array<unsigned char, 32> digest{};
    if (!sha256Buffer(reinterpret_cast<const unsigned char*>(text.data()), text.size(), &digest)) return {};
    return hex(digest.data(), digest.size());
}

bool hashFile(const std::wstring& path, std::string* digest, std::uint64_t maxBytes) {
    if (digest == nullptr) return false;
    ScopedHandle file(CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    if (!file.valid()) return false;
    FILE_ATTRIBUTE_TAG_INFO tag{};
    if (!GetFileInformationByHandleEx(file.get(), FileAttributeTagInfo, &tag, sizeof(tag))
        || (tag.FileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0) return false;
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(file.get(), &size) || size.QuadPart <= 0
        || static_cast<std::uint64_t>(size.QuadPart) > maxBytes) return false;

    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    DWORD objectLength = 0;
    DWORD resultLength = 0;
    bool ok = false;
    if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0) goto cleanup;
    if (BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectLength), sizeof(objectLength), &resultLength, 0) != 0
        || objectLength == 0) goto cleanup;
    {
        std::vector<unsigned char> object(objectLength);
        std::array<unsigned char, 32> output{};
        if (BCryptCreateHash(algorithm, &hash, object.data(), static_cast<ULONG>(object.size()), nullptr, 0, 0) != 0) goto cleanup;
        std::array<unsigned char, 64 * 1024> buffer{};
        for (;;) {
            DWORD read = 0;
            if (!ReadFile(file.get(), buffer.data(), static_cast<DWORD>(buffer.size()), &read, nullptr)) goto cleanup;
            if (read == 0) break;
            if (BCryptHashData(hash, buffer.data(), read, 0) != 0) goto cleanup;
        }
        if (BCryptFinishHash(hash, output.data(), static_cast<ULONG>(output.size()), 0) != 0) goto cleanup;
        *digest = hex(output.data(), output.size());
        ok = true;
    }
cleanup:
    if (hash != nullptr) BCryptDestroyHash(hash);
    if (algorithm != nullptr) BCryptCloseAlgorithmProvider(algorithm, 0);
    return ok;
}

std::string canonicalJwk(std::string_view x, std::string_view y) {
    return std::string("{\"crv\":\"P-256\",\"ext\":true,\"key_ops\":[\"verify\"],\"kty\":\"EC\",\"x\":\"")
        + std::string(x) + "\",\"y\":\"" + std::string(y) + "\"}";
}

std::string probeMaterial(const ProbeRequest& request) {
    return std::string(kProbeProfile)
        + "\ncommand_id:" + request.command_id
        + "\nrequest_nonce:" + request.request_nonce;
}

std::string updateMaterial(const UpdateRequest& request) {
    return std::string(kUpdateProfile)
        + "\noperation:" + request.operation
        + "\neffect_id:" + request.effect_id
        + "\neffect_generation:" + std::to_string(request.effect_generation)
        + "\ncommand_id:" + request.command_id
        + "\nrequest_nonce:" + request.request_nonce
        + "\nrelease_version:" + request.release_version
        + "\ncandidate_git_sha:" + request.candidate_git_sha
        + "\ninstaller_sha256:" + request.installer_sha256
        + "\nmanifest_sha256:" + request.manifest_sha256
        + "\ninstalled_executable_sha256:" + request.installed_executable_sha256;
}

bool verifyP256Signature(
    std::string_view xText,
    std::string_view yText,
    std::string_view signatureText,
    std::string_view material) {
    std::vector<unsigned char> x;
    std::vector<unsigned char> y;
    std::vector<unsigned char> signature;
    if (!decodeBase64Url(xText, &x) || !decodeBase64Url(yText, &y) || !decodeBase64Url(signatureText, &signature)
        || x.size() != 32 || y.size() != 32 || signature.size() != 64) return false;
    std::array<unsigned char, 32> digest{};
    if (!sha256Buffer(reinterpret_cast<const unsigned char*>(material.data()), material.size(), &digest)) return false;

    struct PublicBlob {
        BCRYPT_ECCKEY_BLOB header;
        unsigned char xy[64];
    } blob{};
    blob.header.dwMagic = BCRYPT_ECDSA_PUBLIC_P256_MAGIC;
    blob.header.cbKey = 32;
    std::memcpy(blob.xy, x.data(), 32);
    std::memcpy(blob.xy + 32, y.data(), 32);

    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_KEY_HANDLE key = nullptr;
    if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_ECDSA_P256_ALGORITHM, nullptr, 0) != 0) return false;
    const NTSTATUS imported = BCryptImportKeyPair(
        algorithm,
        nullptr,
        BCRYPT_ECCPUBLIC_BLOB,
        &key,
        reinterpret_cast<PUCHAR>(&blob),
        static_cast<ULONG>(sizeof(blob)),
        0);
    bool verified = false;
    if (imported == 0) {
        verified = BCryptVerifySignature(
            key,
            nullptr,
            digest.data(),
            static_cast<ULONG>(digest.size()),
            signature.data(),
            static_cast<ULONG>(signature.size()),
            0) == 0;
    }
    if (key != nullptr) BCryptDestroyKey(key);
    BCryptCloseAlgorithmProvider(algorithm, 0);
    return verified;
}

std::string narrowAscii(const std::wstring& text) {
    std::string out;
    out.reserve(text.size());
    for (const wchar_t ch : text) {
        if (ch < 0x20 || ch > 0x7e) return {};
        out.push_back(static_cast<char>(ch));
    }
    return out;
}

bool ownerAndClientExact(
    const OwnerEnrollmentObservation& client,
    const OwnerEnrollmentStoreResult& owner) {
    return owner.root_trusted
        && owner.present
        && owner.exact
        && owner.provenance_exact
        && !owner.corrupt
        && client.local_only
        && client.pipe_reject_remote_clients
        && client.explicit_dacl
        && !client.default_dacl_used
        && client.first_pipe_instance
        && client.overlapped_io
        && !client.pipe_nowait_used
        && client.client_message_read_before_impersonation
        && client.impersonation_succeeded
        && client.revert_to_self_succeeded
        && client.token_user_readback
        && client.token_session_id_readback
        && client.client_pid > 0
        && client.session_id > 0
        && !client.user_sid.empty()
        && _wcsicmp(client.user_sid.c_str(), owner.record.expected_owner_sid.c_str()) == 0;
}

bool deviceProofExact(
    std::string_view x,
    std::string_view y,
    std::string_view signature,
    std::string_view material,
    const OwnerEnrollmentStoreResult& owner) {
    const std::string fingerprint = sha256Text(canonicalJwk(x, y));
    return !fingerprint.empty()
        && fingerprint == owner.record.device_key_fingerprint_sha256
        && verifyP256Signature(x, y, signature, material);
}

GuardianUpdateActuatorResult baseResult(const char* state, const char* reason, DWORD error = ERROR_SUCCESS) {
    GuardianUpdateActuatorResult out;
    out.state = state == nullptr ? "AMBIGUOUS" : state;
    out.reason = reason == nullptr ? "UNKNOWN" : reason;
    out.win32_error = error;
    out.automatic_retry_allowed = false;
    return out;
}

void attachOwnerProof(
    GuardianUpdateActuatorResult* out,
    const OwnerEnrollmentObservation& client,
    const OwnerEnrollmentStoreResult& owner) {
    if (out == nullptr) return;
    out->session_id = client.session_id;
    out->client_pid = client.client_pid;
    out->expected_owner_sid = narrowAscii(owner.record.expected_owner_sid);
    out->enrollment_evidence_sha256 = owner.record.enrollment_evidence_sha256;
    out->device_key_fingerprint_sha256 = owner.record.device_key_fingerprint_sha256;
    out->owner_binding_proven = true;
    out->device_binding_proven = true;
}

std::wstring fullPath(const std::wstring& input) {
    if (input.empty()) return {};
    const DWORD required = GetFullPathNameW(input.c_str(), 0, nullptr, nullptr);
    if (required == 0) return {};
    std::wstring buffer(required, L'\0');
    const DWORD written = GetFullPathNameW(input.c_str(), required, buffer.data(), nullptr);
    if (written == 0 || written >= required) return {};
    buffer.resize(written);
    return buffer;
}

bool directoryExact(const std::wstring& path) {
    const DWORD attrs = GetFileAttributesW(path.c_str());
    return attrs != INVALID_FILE_ATTRIBUTES
        && (attrs & FILE_ATTRIBUTE_DIRECTORY) != 0
        && (attrs & FILE_ATTRIBUTE_REPARSE_POINT) == 0;
}

bool createSecureDirectory(const std::wstring& path) {
    PSECURITY_DESCRIPTOR rawDescriptor = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            kSecureDacl,
            SDDL_REVISION_1,
            &rawDescriptor,
            nullptr)) return false;
    LocalMemory descriptor;
    descriptor.value = reinterpret_cast<HLOCAL>(rawDescriptor);
    SECURITY_ATTRIBUTES security{};
    security.nLength = sizeof(security);
    security.lpSecurityDescriptor = rawDescriptor;
    security.bInheritHandle = FALSE;
    if (!CreateDirectoryW(path.c_str(), &security)) {
        if (GetLastError() != ERROR_ALREADY_EXISTS) return false;
    }
    return directoryExact(path);
}

ScopedHandle exactOwnerToken(const OwnerEnrollmentObservation& client, const OwnerEnrollmentStoreResult& owner) {
    HANDLE raw = nullptr;
    if (!WTSQueryUserToken(client.session_id, &raw)) return ScopedHandle{};
    ScopedHandle token(raw);
    DWORD sessionId = 0;
    DWORD written = 0;
    if (!GetTokenInformation(token.get(), TokenSessionId, &sessionId, sizeof(sessionId), &written)
        || written != sizeof(sessionId) || sessionId != client.session_id) return ScopedHandle{};
    DWORD required = 0;
    GetTokenInformation(token.get(), TokenUser, nullptr, 0, &required);
    if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || required == 0) return ScopedHandle{};
    std::vector<unsigned char> storage(required);
    if (!GetTokenInformation(token.get(), TokenUser, storage.data(), required, &required)) return ScopedHandle{};
    const auto* tokenUser = reinterpret_cast<const TOKEN_USER*>(storage.data());
    LPWSTR rawSid = nullptr;
    if (!ConvertSidToStringSidW(tokenUser->User.Sid, &rawSid) || rawSid == nullptr) return ScopedHandle{};
    const bool same = _wcsicmp(rawSid, owner.record.expected_owner_sid.c_str()) == 0;
    LocalFree(rawSid);
    if (!same) return ScopedHandle{};
    return token;
}

std::wstring localAppDataFor(HANDLE token) {
    CoTaskMemory memory;
    if (SHGetKnownFolderPath(FOLDERID_LocalAppData, KF_FLAG_DEFAULT, token, &memory.value) != S_OK || memory.value == nullptr) return {};
    return fullPath(memory.value);
}

std::wstring join(const std::wstring& left, const std::wstring& right) {
    if (left.empty()) return {};
    if (left.back() == L'\\') return left + right;
    return left + L"\\" + right;
}

bool copyExactCandidate(const std::wstring& source, const std::wstring& target, std::string_view expectedSha) {
    std::string existing;
    if (hashFile(target, &existing, kMaxInstallerBytes)) return existing == expectedSha;

    ScopedHandle input(CreateFileW(source.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    if (!input.valid()) return false;
    FILE_ATTRIBUTE_TAG_INFO sourceTag{};
    if (!GetFileInformationByHandleEx(input.get(), FileAttributeTagInfo, &sourceTag, sizeof(sourceTag))
        || (sourceTag.FileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0) return false;
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(input.get(), &size) || size.QuadPart <= 0
        || static_cast<std::uint64_t>(size.QuadPart) > kMaxInstallerBytes) return false;

    PSECURITY_DESCRIPTOR rawDescriptor = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(kSecureDacl, SDDL_REVISION_1, &rawDescriptor, nullptr)) return false;
    LocalMemory descriptor;
    descriptor.value = reinterpret_cast<HLOCAL>(rawDescriptor);
    SECURITY_ATTRIBUTES security{};
    security.nLength = sizeof(security);
    security.lpSecurityDescriptor = rawDescriptor;
    security.bInheritHandle = FALSE;
    ScopedHandle output(CreateFileW(target.c_str(), GENERIC_WRITE | GENERIC_READ, 0, &security, CREATE_NEW,
        FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, nullptr));
    if (!output.valid()) {
        if (GetLastError() == ERROR_FILE_EXISTS || GetLastError() == ERROR_ALREADY_EXISTS) {
            std::string raced;
            return hashFile(target, &raced, kMaxInstallerBytes) && raced == expectedSha;
        }
        return false;
    }

    std::array<unsigned char, 64 * 1024> buffer{};
    for (;;) {
        DWORD read = 0;
        if (!ReadFile(input.get(), buffer.data(), static_cast<DWORD>(buffer.size()), &read, nullptr)) {
            output.reset();
            DeleteFileW(target.c_str());
            return false;
        }
        if (read == 0) break;
        DWORD written = 0;
        if (!WriteFile(output.get(), buffer.data(), read, &written, nullptr) || written != read) {
            output.reset();
            DeleteFileW(target.c_str());
            return false;
        }
    }
    if (!FlushFileBuffers(output.get())) {
        output.reset();
        DeleteFileW(target.c_str());
        return false;
    }
    output.reset();
    std::string staged;
    if (!hashFile(target, &staged, kMaxInstallerBytes) || staged != expectedSha) {
        DeleteFileW(target.c_str());
        return false;
    }
    return true;
}

std::wstring effectRecordPath(const std::wstring& root, std::string_view effectId) {
    std::wstring name(effectId.begin(), effectId.end());
    return join(join(root, kEffectsDir), name + L".record");
}

std::string effectHeader(const UpdateRequest& request) {
    return std::string("wire_schema=") + kEffectSchema
        + "\neffect_id=" + request.effect_id
        + "\neffect_generation=" + std::to_string(request.effect_generation)
        + "\ncommand_id=" + request.command_id
        + "\nrequest_nonce_sha256=" + sha256Text(request.request_nonce)
        + "\nrelease_version=" + request.release_version
        + "\ncandidate_git_sha=" + request.candidate_git_sha
        + "\ninstaller_sha256=" + request.installer_sha256
        + "\nmanifest_sha256=" + request.manifest_sha256
        + "\ninstalled_executable_sha256=" + request.installed_executable_sha256
        + "\n";
}

bool readBoundedFile(const std::wstring& path, std::string* out, std::size_t maxBytes) {
    if (out == nullptr) return false;
    ScopedHandle file(CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    if (!file.valid()) return false;
    FILE_ATTRIBUTE_TAG_INFO tag{};
    if (!GetFileInformationByHandleEx(file.get(), FileAttributeTagInfo, &tag, sizeof(tag))
        || (tag.FileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) != 0) return false;
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(file.get(), &size) || size.QuadPart <= 0
        || static_cast<std::uint64_t>(size.QuadPart) > static_cast<std::uint64_t>(maxBytes)) return false;
    out->assign(static_cast<std::size_t>(size.QuadPart), '\0');
    DWORD offset = 0;
    while (offset < out->size()) {
        DWORD read = 0;
        const DWORD remaining = static_cast<DWORD>(out->size() - offset);
        if (!ReadFile(file.get(), out->data() + offset, remaining, &read, nullptr) || read == 0) return false;
        offset += read;
    }
    return true;
}

EffectReadback parseEffectReadback(const std::string& payload, const UpdateRequest& request) {
    EffectReadback out;
    out.exists = true;
    const std::string header = effectHeader(request);
    if (!payload.starts_with(header)) {
        out.corrupt = true;
        return out;
    }
    std::string_view events(payload.data() + header.size(), payload.size() - header.size());
    std::string event;
    if (!takeLine(&events, "event=", &event) || event != "ATTEMPTED") {
        out.corrupt = true;
        return out;
    }
    out.state = "ATTEMPTED";
    while (!events.empty()) {
        if (!takeLine(&events, "event=", &event)) {
            out.corrupt = true;
            return out;
        }
        if (event == "NO_EFFECT_PROVEN") {
            if (out.state != "ATTEMPTED") { out.corrupt = true; return out; }
            out.state = event;
        } else if (event.starts_with("DISPATCHED:")) {
            if (out.state != "ATTEMPTED") { out.corrupt = true; return out; }
            const std::string rest = event.substr(std::strlen("DISPATCHED:"));
            const std::size_t split = rest.find(':');
            std::uint64_t pid = 0;
            std::uint64_t created = 0;
            if (split == std::string::npos || !parseU64(rest.substr(0, split), &pid)
                || !parseU64(rest.substr(split + 1), &created) || pid == 0 || pid > MAXDWORD || created == 0) {
                out.corrupt = true;
                return out;
            }
            out.pid = static_cast<DWORD>(pid);
            out.creation_time_100ns = created;
            out.state = "DISPATCHED";
        } else if (event == "CONFIRMED") {
            if (out.state != "DISPATCHED") { out.corrupt = true; return out; }
            out.state = event;
        } else if (event == "AMBIGUOUS") {
            if (out.state != "ATTEMPTED" && out.state != "DISPATCHED") { out.corrupt = true; return out; }
            out.state = event;
        } else {
            out.corrupt = true;
            return out;
        }
    }
    out.exact = !out.corrupt;
    return out;
}

EffectReadback readEffect(const std::wstring& path, const UpdateRequest& request) {
    std::string payload;
    if (!readBoundedFile(path, &payload, 16 * 1024)) {
        EffectReadback out;
        const DWORD attrs = GetFileAttributesW(path.c_str());
        out.exists = attrs != INVALID_FILE_ATTRIBUTES;
        out.corrupt = out.exists;
        return out;
    }
    return parseEffectReadback(payload, request);
}

bool appendEffectEvent(const std::wstring& path, std::string_view event) {
    ScopedHandle file(CreateFileW(path.c_str(), FILE_APPEND_DATA | SYNCHRONIZE, 0, nullptr, OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, nullptr));
    if (!file.valid()) return false;
    const std::string line = std::string("event=") + std::string(event) + "\n";
    DWORD written = 0;
    return WriteFile(file.get(), line.data(), static_cast<DWORD>(line.size()), &written, nullptr)
        && written == line.size()
        && FlushFileBuffers(file.get());
}

bool createEffectBarrier(const std::wstring& path, const UpdateRequest& request, EffectReadback* existing) {
    PSECURITY_DESCRIPTOR rawDescriptor = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(kSecureDacl, SDDL_REVISION_1, &rawDescriptor, nullptr)) return false;
    LocalMemory descriptor;
    descriptor.value = reinterpret_cast<HLOCAL>(rawDescriptor);
    SECURITY_ATTRIBUTES security{};
    security.nLength = sizeof(security);
    security.lpSecurityDescriptor = rawDescriptor;
    security.bInheritHandle = FALSE;
    ScopedHandle file(CreateFileW(path.c_str(), GENERIC_WRITE | GENERIC_READ, 0, &security, CREATE_NEW,
        FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, nullptr));
    if (!file.valid()) {
        if (GetLastError() == ERROR_FILE_EXISTS || GetLastError() == ERROR_ALREADY_EXISTS) {
            if (existing != nullptr) *existing = readEffect(path, request);
        }
        return false;
    }
    const std::string payload = effectHeader(request) + "event=ATTEMPTED\n";
    DWORD written = 0;
    if (!WriteFile(file.get(), payload.data(), static_cast<DWORD>(payload.size()), &written, nullptr)
        || written != payload.size() || !FlushFileBuffers(file.get())) return false;
    if (existing != nullptr) {
        existing->exists = true;
        existing->exact = true;
        existing->state = "ATTEMPTED";
    }
    return true;
}

std::uint64_t fileTimeValue(const FILETIME& value) {
    ULARGE_INTEGER raw{};
    raw.LowPart = value.dwLowDateTime;
    raw.HighPart = value.dwHighDateTime;
    return raw.QuadPart;
}

std::string incarnation(DWORD pid, std::uint64_t created) {
    return "pid:" + std::to_string(pid) + ":created_100ns:" + std::to_string(created);
}

bool terminateNeverResumed(HANDLE process) {
    if (process == nullptr || process == INVALID_HANDLE_VALUE) return true;
    DWORD exitCode = STILL_ACTIVE;
    if (GetExitCodeProcess(process, &exitCode) && exitCode != STILL_ACTIVE) return true;
    if (!TerminateProcess(process, ERROR_PROCESS_ABORTED)) return false;
    return WaitForSingleObject(process, 5'000) == WAIT_OBJECT_0;
}

GuardianUpdateActuatorResult launchInstaller(
    const std::wstring& executable,
    HANDLE userToken,
    DWORD sessionId,
    const std::wstring& expectedOwnerSid) {
    if (!userToken || userToken == INVALID_HANDLE_VALUE) return baseResult("NO_EFFECT_PROVEN", "USER_TOKEN_INVALID", ERROR_INVALID_HANDLE);
    ScopedEnvironment environment;
    if (!CreateEnvironmentBlock(environment.out(), userToken, FALSE)) {
        return baseResult("NO_EFFECT_PROVEN", "USER_ENVIRONMENT_BLOCK_FAILED", GetLastError());
    }
    std::wstring commandLine = L"\"" + executable + L"\" /S";
    std::vector<wchar_t> command(commandLine.begin(), commandLine.end());
    command.push_back(L'\0');
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.lpDesktop = const_cast<LPWSTR>(L"winsta0\\default");
    PROCESS_INFORMATION processInfo{};
    const std::wstring currentDirectory = executable.substr(0, executable.find_last_of(L"\\/"));
    const DWORD flags = CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NEW_PROCESS_GROUP;
    if (!CreateProcessAsUserW(
            userToken,
            executable.c_str(),
            command.data(),
            nullptr,
            nullptr,
            FALSE,
            flags,
            environment.value,
            currentDirectory.empty() ? nullptr : currentDirectory.c_str(),
            &startup,
            &processInfo)) {
        return baseResult("NO_EFFECT_PROVEN", "CREATE_PROCESS_AS_USER_FAILED", GetLastError());
    }
    ScopedHandle process(processInfo.hProcess);
    ScopedHandle thread(processInfo.hThread);

    FILETIME creation{}, exit{}, kernel{}, user{};
    if (!GetProcessTimes(process.get(), &creation, &exit, &kernel, &user)) {
        const DWORD error = GetLastError();
        return baseResult(terminateNeverResumed(process.get()) ? "NO_EFFECT_PROVEN" : "AMBIGUOUS",
            "INSTALLER_CREATION_TIME_READBACK_FAILED", error);
    }
    const std::uint64_t created = fileTimeValue(creation);
    DWORD observedSession = 0;
    if (created == 0 || !ProcessIdToSessionId(processInfo.dwProcessId, &observedSession) || observedSession != sessionId) {
        const DWORD error = GetLastError();
        return baseResult(terminateNeverResumed(process.get()) ? "NO_EFFECT_PROVEN" : "AMBIGUOUS",
            "INSTALLER_SESSION_READBACK_FAILED", error);
    }
    HANDLE rawChildToken = nullptr;
    if (!OpenProcessToken(process.get(), TOKEN_QUERY, &rawChildToken)) {
        const DWORD error = GetLastError();
        return baseResult(terminateNeverResumed(process.get()) ? "NO_EFFECT_PROVEN" : "AMBIGUOUS",
            "INSTALLER_TOKEN_OPEN_FAILED", error);
    }
    ScopedHandle childToken(rawChildToken);
    DWORD required = 0;
    GetTokenInformation(childToken.get(), TokenUser, nullptr, 0, &required);
    if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || required == 0) {
        return baseResult(terminateNeverResumed(process.get()) ? "NO_EFFECT_PROVEN" : "AMBIGUOUS",
            "INSTALLER_TOKEN_USER_READBACK_FAILED", GetLastError());
    }
    std::vector<unsigned char> storage(required);
    if (!GetTokenInformation(childToken.get(), TokenUser, storage.data(), required, &required)) {
        return baseResult(terminateNeverResumed(process.get()) ? "NO_EFFECT_PROVEN" : "AMBIGUOUS",
            "INSTALLER_TOKEN_USER_READBACK_FAILED", GetLastError());
    }
    const auto* tokenUser = reinterpret_cast<const TOKEN_USER*>(storage.data());
    LPWSTR rawSid = nullptr;
    if (!ConvertSidToStringSidW(tokenUser->User.Sid, &rawSid) || rawSid == nullptr) {
        return baseResult(terminateNeverResumed(process.get()) ? "NO_EFFECT_PROVEN" : "AMBIGUOUS",
            "INSTALLER_TOKEN_SID_READBACK_FAILED", GetLastError());
    }
    const bool ownerExact = _wcsicmp(rawSid, expectedOwnerSid.c_str()) == 0;
    LocalFree(rawSid);
    if (!ownerExact) {
        return baseResult(terminateNeverResumed(process.get()) ? "NO_EFFECT_PROVEN" : "AMBIGUOUS",
            "INSTALLER_OWNER_SID_MISMATCH", ERROR_INVALID_OWNER);
    }
    if (ResumeThread(thread.get()) == static_cast<DWORD>(-1)) {
        const DWORD error = GetLastError();
        return baseResult(terminateNeverResumed(process.get()) ? "NO_EFFECT_PROVEN" : "AMBIGUOUS",
            "INSTALLER_RESUME_FAILED", error);
    }

    GuardianUpdateActuatorResult out = baseResult("DISPATCHED", "EXACT_SILENT_INSTALLER_DISPATCHED");
    out.pid = processInfo.dwProcessId;
    out.session_id = observedSession;
    out.creation_time_100ns = created;
    out.process_incarnation_id = incarnation(out.pid, created);
    out.physical_dispatch_performed = true;
    return out;
}

bool exactProcessStillRunning(DWORD pid, std::uint64_t created, ScopedHandle* out) {
    if (out == nullptr || pid == 0 || created == 0) return false;
    ScopedHandle process(OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid));
    if (!process.valid()) return false;
    FILETIME creation{}, exit{}, kernel{}, user{};
    if (!GetProcessTimes(process.get(), &creation, &exit, &kernel, &user)
        || fileTimeValue(creation) != created) return false;
    DWORD exitCode = 0;
    if (!GetExitCodeProcess(process.get(), &exitCode) || exitCode != STILL_ACTIVE) return false;
    *out = std::move(process);
    return true;
}

std::string jsonEscape(std::string_view value) {
    std::string out;
    out.reserve(value.size() + 8);
    for (const unsigned char ch : value) {
        if (ch == '"' || ch == '\\') { out.push_back('\\'); out.push_back(static_cast<char>(ch)); }
        else if (ch >= 0x20) out.push_back(static_cast<char>(ch));
    }
    return out;
}

GuardianUpdateActuatorResult observeEffect(
    const UpdateRequest& request,
    const std::wstring& effectPath,
    const std::wstring& installedExe) {
    EffectReadback row = readEffect(effectPath, request);
    if (!row.exists || !row.exact || row.corrupt) return baseResult("AMBIGUOUS", "NATIVE_EFFECT_RECORD_UNREADABLE");
    if (row.state == "NO_EFFECT_PROVEN") {
        GuardianUpdateActuatorResult out = baseResult("NO_EFFECT_PROVEN", "NATIVE_EFFECT_ABSENCE_PROVEN");
        out.effect_absent_proven = true;
        return out;
    }
    if (row.state == "ATTEMPTED" || row.state == "AMBIGUOUS") {
        return baseResult("AMBIGUOUS", "NATIVE_EFFECT_OUTCOME_UNRESOLVED");
    }
    if (row.state != "DISPATCHED" && row.state != "CONFIRMED") {
        return baseResult("AMBIGUOUS", "NATIVE_EFFECT_STATE_INVALID");
    }

    std::string installedSha;
    if (hashFile(installedExe, &installedSha, kMaxInstallerBytes) && installedSha == request.installed_executable_sha256) {
        if (row.state == "DISPATCHED" && !appendEffectEvent(effectPath, "CONFIRMED")) {
            return baseResult("AMBIGUOUS", "NATIVE_EFFECT_CONFIRMATION_PERSIST_FAILED", GetLastError());
        }
        GuardianUpdateActuatorResult out = baseResult("READY", "EXACT_INSTALLED_EXECUTABLE_DIGEST_PROVEN");
        out.pid = row.pid;
        out.creation_time_100ns = row.creation_time_100ns;
        out.process_incarnation_id = incarnation(row.pid, row.creation_time_100ns);
        out.installed_executable_sha256 = installedSha;
        out.exact_ready_binding = true;
        return out;
    }

    if (row.state == "CONFIRMED") return baseResult("AMBIGUOUS", "CONFIRMED_INSTALL_READBACK_DRIFT");
    ScopedHandle process;
    if (exactProcessStillRunning(row.pid, row.creation_time_100ns, &process)) {
        const DWORD wait = WaitForSingleObject(process.get(), kObserveTimeoutMs);
        if (wait == WAIT_FAILED) {
            if (!appendEffectEvent(effectPath, "AMBIGUOUS")) return baseResult("AMBIGUOUS", "INSTALLER_WAIT_AND_JOURNAL_FAILED", GetLastError());
            return baseResult("AMBIGUOUS", "INSTALLER_WAIT_FAILED", GetLastError());
        }
        if (wait == WAIT_TIMEOUT) {
            if (!appendEffectEvent(effectPath, "AMBIGUOUS")) return baseResult("AMBIGUOUS", "INSTALLER_TIMEOUT_AND_JOURNAL_FAILED", GetLastError());
            return baseResult("AMBIGUOUS", "INSTALLER_BOUNDED_WAIT_TIMEOUT", WAIT_TIMEOUT);
        }
    }

    installedSha.clear();
    if (hashFile(installedExe, &installedSha, kMaxInstallerBytes) && installedSha == request.installed_executable_sha256) {
        if (!appendEffectEvent(effectPath, "CONFIRMED")) return baseResult("AMBIGUOUS", "NATIVE_EFFECT_CONFIRMATION_PERSIST_FAILED", GetLastError());
        GuardianUpdateActuatorResult out = baseResult("READY", "EXACT_INSTALLED_EXECUTABLE_DIGEST_PROVEN");
        out.pid = row.pid;
        out.creation_time_100ns = row.creation_time_100ns;
        out.process_incarnation_id = incarnation(row.pid, row.creation_time_100ns);
        out.installed_executable_sha256 = installedSha;
        out.exact_ready_binding = true;
        return out;
    }
    if (!appendEffectEvent(effectPath, "AMBIGUOUS")) return baseResult("AMBIGUOUS", "INSTALL_RESULT_UNKNOWN_AND_JOURNAL_FAILED", GetLastError());
    return baseResult("AMBIGUOUS", "INSTALLED_EXECUTABLE_EXACT_READBACK_UNPROVEN");
}

}  // namespace

GuardianUpdateActuatorResult handleGuardianUpdateActuatorRequest(
    const std::string& wireRequest,
    const OwnerEnrollmentObservation& client,
    const OwnerEnrollmentStoreResult& owner) {
    if (!ownerAndClientExact(client, owner)) return baseResult("NO_EFFECT_PROVEN", "OWNER_SESSION_BINDING_UNPROVEN", ERROR_ACCESS_DENIED);

    ProbeRequest probe;
    if (parseProbe(wireRequest, &probe)) {
        if (!deviceProofExact(probe.public_jwk_x, probe.public_jwk_y, probe.signature, probeMaterial(probe), owner)) {
            return baseResult("NO_EFFECT_PROVEN", "ENROLLED_DEVICE_CHALLENGE_INVALID", ERROR_ACCESS_DENIED);
        }
        GuardianUpdateActuatorResult out = baseResult("OWNER_BOUND", "DURABLE_OWNER_AND_DEVICE_CHALLENGE_EXACT");
        attachOwnerProof(&out, client, owner);
        out.effect_absent_proven = true;
        return out;
    }

    UpdateRequest request;
    if (!parseUpdate(wireRequest, &request)) return baseResult("NO_EFFECT_PROVEN", "UPDATE_ACTUATOR_REQUEST_INVALID", ERROR_INVALID_DATA);
    if (!deviceProofExact(request.public_jwk_x, request.public_jwk_y, request.signature, updateMaterial(request), owner)) {
        return baseResult("NO_EFFECT_PROVEN", "ENROLLED_DEVICE_CHALLENGE_INVALID", ERROR_ACCESS_DENIED);
    }

    ScopedHandle userToken = exactOwnerToken(client, owner);
    if (!userToken.valid()) return baseResult("NO_EFFECT_PROVEN", "EXACT_OWNER_USER_TOKEN_UNAVAILABLE", GetLastError());
    const std::wstring localAppData = localAppDataFor(userToken.get());
    if (localAppData.empty()) return baseResult("NO_EFFECT_PROVEN", "OWNER_LOCALAPPDATA_UNAVAILABLE", GetLastError());
    const std::wstring machineRoot = browserGuardianOwnerEnrollmentStoreDefaultRoot();
    if (machineRoot.empty() || !directoryExact(machineRoot)) return baseResult("NO_EFFECT_PROVEN", "GUARDIAN_MACHINE_ROOT_UNAVAILABLE", ERROR_PATH_NOT_FOUND);
    if (!createSecureDirectory(join(machineRoot, kCandidateDir)) || !createSecureDirectory(join(machineRoot, kEffectsDir))) {
        return baseResult("NO_EFFECT_PROVEN", "GUARDIAN_UPDATE_STATE_ROOT_UNAVAILABLE", GetLastError());
    }

    const std::wstring digestDir(request.installer_sha256.begin(), request.installer_sha256.end());
    const std::wstring intakeDir = join(join(join(localAppData, kIntakeRelative), digestDir), L"");
    const std::wstring intakeInstaller = join(intakeDir, kCandidateName);
    const std::wstring intakeManifest = join(intakeDir, kManifestName);
    const std::wstring candidateDir = join(join(machineRoot, kCandidateDir), digestDir);
    if (!createSecureDirectory(candidateDir)) return baseResult("NO_EFFECT_PROVEN", "CANDIDATE_MACHINE_SLOT_UNAVAILABLE", GetLastError());
    const std::wstring stagedInstaller = join(candidateDir, kCandidateName);
    const std::wstring effectPath = effectRecordPath(machineRoot, request.effect_id);
    const std::wstring installedExe = join(localAppData, kInstalledRelative);

    if (request.operation == "OBSERVE") {
        GuardianUpdateActuatorResult out = observeEffect(request, effectPath, installedExe);
        attachOwnerProof(&out, client, owner);
        return out;
    }

    std::string manifestSha;
    if (!hashFile(intakeManifest, &manifestSha, kMaxManifestBytes) || manifestSha != request.manifest_sha256) {
        GuardianUpdateActuatorResult out = baseResult("NO_EFFECT_PROVEN", "INTAKE_MANIFEST_DIGEST_MISMATCH");
        out.effect_absent_proven = true;
        attachOwnerProof(&out, client, owner);
        return out;
    }
    if (!copyExactCandidate(intakeInstaller, stagedInstaller, request.installer_sha256)) {
        GuardianUpdateActuatorResult out = baseResult("NO_EFFECT_PROVEN", "MACHINE_CANDIDATE_STAGING_UNPROVEN");
        out.effect_absent_proven = true;
        attachOwnerProof(&out, client, owner);
        return out;
    }

    EffectReadback barrier;
    if (!createEffectBarrier(effectPath, request, &barrier)) {
        if (barrier.exists && barrier.exact && barrier.state == "DISPATCHED") {
            GuardianUpdateActuatorResult out = baseResult("DISPATCHED", "EXACT_PRIOR_NATIVE_DISPATCH_READBACK");
            out.pid = barrier.pid;
            out.creation_time_100ns = barrier.creation_time_100ns;
            out.process_incarnation_id = incarnation(barrier.pid, barrier.creation_time_100ns);
            attachOwnerProof(&out, client, owner);
            return out;
        }
        if (barrier.exists && barrier.exact && barrier.state == "CONFIRMED") {
            GuardianUpdateActuatorResult out = observeEffect(request, effectPath, installedExe);
            attachOwnerProof(&out, client, owner);
            return out;
        }
        if (barrier.exists && barrier.exact && barrier.state == "NO_EFFECT_PROVEN") {
            GuardianUpdateActuatorResult out = baseResult("NO_EFFECT_PROVEN", "EXACT_PRIOR_NATIVE_NO_EFFECT_READBACK");
            out.effect_absent_proven = true;
            attachOwnerProof(&out, client, owner);
            return out;
        }
        GuardianUpdateActuatorResult out = baseResult("AMBIGUOUS", "NATIVE_EFFECT_BARRIER_ALREADY_CROSSED_OR_UNREADABLE");
        attachOwnerProof(&out, client, owner);
        return out;
    }

    GuardianUpdateActuatorResult launch = launchInstaller(
        stagedInstaller,
        userToken.get(),
        client.session_id,
        owner.record.expected_owner_sid);
    attachOwnerProof(&launch, client, owner);
    if (launch.state == "NO_EFFECT_PROVEN") {
        launch.effect_absent_proven = true;
        if (!appendEffectEvent(effectPath, "NO_EFFECT_PROVEN")) {
            launch.state = "AMBIGUOUS";
            launch.reason = "NO_EFFECT_PROOF_JOURNAL_PERSIST_FAILED";
            launch.effect_absent_proven = false;
        }
        return launch;
    }
    if (launch.state != "DISPATCHED") {
        appendEffectEvent(effectPath, "AMBIGUOUS");
        return launch;
    }
    const std::string dispatched = "DISPATCHED:" + std::to_string(launch.pid) + ":" + std::to_string(launch.creation_time_100ns);
    if (!appendEffectEvent(effectPath, dispatched)) {
        GuardianUpdateActuatorResult out = baseResult("AMBIGUOUS", "DISPATCH_SUCCEEDED_NATIVE_JOURNAL_READBACK_FAILED", GetLastError());
        out.pid = launch.pid;
        out.creation_time_100ns = launch.creation_time_100ns;
        out.process_incarnation_id = launch.process_incarnation_id;
        out.physical_dispatch_performed = true;
        attachOwnerProof(&out, client, owner);
        return out;
    }
    return launch;
}

std::string serializeGuardianUpdateActuatorResult(const GuardianUpdateActuatorResult& result) {
    return std::string("{\"schema\":\"metaengine.browser-guardian.update-actuator-result.v1\",")
        + "\"state\":\"" + jsonEscape(result.state) + "\","
        + "\"reason\":\"" + jsonEscape(result.reason) + "\","
        + "\"win32_error\":" + std::to_string(result.win32_error) + ","
        + "\"pid\":" + std::to_string(result.pid) + ","
        + "\"session_id\":" + std::to_string(result.session_id) + ","
        + "\"client_pid\":" + std::to_string(result.client_pid) + ","
        + "\"creation_time_100ns\":" + std::to_string(result.creation_time_100ns) + ","
        + "\"process_incarnation_id\":\"" + jsonEscape(result.process_incarnation_id) + "\","
        + "\"expected_owner_sid\":\"" + jsonEscape(result.expected_owner_sid) + "\","
        + "\"enrollment_evidence_sha256\":\"" + jsonEscape(result.enrollment_evidence_sha256) + "\","
        + "\"device_key_fingerprint_sha256\":\"" + jsonEscape(result.device_key_fingerprint_sha256) + "\","
        + "\"installed_executable_sha256\":\"" + jsonEscape(result.installed_executable_sha256) + "\","
        + "\"owner_binding_proven\":" + (result.owner_binding_proven ? "true" : "false") + ","
        + "\"device_binding_proven\":" + (result.device_binding_proven ? "true" : "false") + ","
        + "\"effect_absent_proven\":" + (result.effect_absent_proven ? "true" : "false") + ","
        + "\"exact_ready_binding\":" + (result.exact_ready_binding ? "true" : "false") + ","
        + "\"physical_dispatch_performed\":" + (result.physical_dispatch_performed ? "true" : "false") + ","
        + "\"automatic_retry_allowed\":false,"
        + "\"caller_supplied_path_used\":false,"
        + "\"caller_supplied_url_used\":false,"
        + "\"caller_supplied_shell_used\":false,"
        + "\"authority_effect\":false}\n";
}

const char* browserGuardianUpdateActuatorContractJson() noexcept {
    return kContractJson;
}

bool browserGuardianUpdateActuatorSelfTest() noexcept {
    try {
        ProbeRequest probe;
        const std::string probeWire =
            "wire_schema=metaengine.browser-guardian.owner-challenge-request.v1\n"
            "command_id=00000000-0000-4000-8000-000000000001\n"
            "request_nonce=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef\n"
            "public_jwk_x=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n"
            "public_jwk_y=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\n"
            "signature=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n";
        if (!parseProbe(probeWire, &probe)) return false;
        if (probeMaterial(probe).find("command_id:00000000-0000-4000-8000-000000000001") == std::string::npos) return false;

        UpdateRequest update;
        const std::string updateWire =
            "wire_schema=metaengine.browser-guardian.update-actuator-request.v1\n"
            "operation=DISPATCH\n"
            "effect_id=00000000-0000-4000-8000-000000000002\n"
            "effect_generation=1\n"
            "command_id=00000000-0000-4000-8000-000000000001\n"
            "request_nonce=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef\n"
            "release_version=0.7.0-dev.1.1\n"
            "candidate_git_sha=0123456789abcdef0123456789abcdef01234567\n"
            "installer_sha256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n"
            "manifest_sha256=1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n"
            "installed_executable_sha256=2123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n"
            "public_jwk_x=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n"
            "public_jwk_y=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\n"
            "signature=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n";
        if (!parseUpdate(updateWire, &update)) return false;
        if (update.operation != "DISPATCH" || update.effect_generation != 1) return false;
        EffectReadback row = parseEffectReadback(effectHeader(update) + "event=ATTEMPTED\nevent=DISPATCHED:123:456\n", update);
        return row.exact && row.state == "DISPATCHED" && row.pid == 123 && row.creation_time_100ns == 456;
    } catch (...) {
        return false;
    }
}

}  // namespace metaengine::guardian
