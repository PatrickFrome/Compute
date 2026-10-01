// A one-shot privileged installer, never a Browser/renderer command executor.
// Reuse the exact SCM configurator implementation and its independent readback.
#define wmain guardianConfiguratorEntrypoint
#include "browser-guardian-scm-configure.cpp"
#undef wmain
#include <bcrypt.h>
#include <sddl.h>
#include <memory>
#include "guardian-bootstrap-binding.hpp" // generated from exact production bytes

namespace {
struct ResourceBytes { const BYTE* data = nullptr; DWORD size = 0; };
ResourceBytes embedded(WORD id) {
    HMODULE module = GetModuleHandleW(nullptr);
    HRSRC resource = FindResourceW(module, MAKEINTRESOURCEW(id), RT_RCDATA);
    if (resource == nullptr) return {};
    HGLOBAL loaded = LoadResource(module, resource);
    return {static_cast<const BYTE*>(LockResource(loaded)), SizeofResource(module, resource)};
}

std::string digest(const BYTE* data, DWORD size) {
    if (data == nullptr || size == 0) return {};
    BCRYPT_ALG_HANDLE alg = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0) return {};
    BYTE bytes[32]{};
    bool ok = BCryptCreateHash(alg, &hash, nullptr, 0, nullptr, 0, 0) >= 0;
    if (ok) ok = BCryptHashData(hash, const_cast<PUCHAR>(data), size, 0) >= 0
        && BCryptFinishHash(hash, bytes, sizeof(bytes), 0) >= 0;
    if (hash != nullptr) BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(alg, 0);
    if (!ok) return {};
    constexpr char hex[] = "0123456789abcdef";
    std::string out;
    for (BYTE value : bytes) { out.push_back(hex[value >> 4]); out.push_back(hex[value & 15]); }
    return out;
}

bool strictMachineAcl(const std::wstring& path) {
    PSID owner = nullptr; PACL dacl = nullptr;
    LocalSecurityDescriptor sd;
    if (GetNamedSecurityInfoW(const_cast<LPWSTR>(path.c_str()), SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION, &owner, nullptr,
            &dacl, nullptr, &sd.value) != ERROR_SUCCESS
        || !ownerIsMachineTrusted(owner) || dacl == nullptr || !IsValidAcl(dacl)) return false;
    ACL_SIZE_INFORMATION info{};
    if (!GetAclInformation(dacl, &info, sizeof(info), AclSizeInformation)) return false;
    for (DWORD i = 0; i < info.AceCount; ++i) {
        LPVOID raw = nullptr;
        if (!GetAce(dacl, i, &raw) || raw == nullptr) return false;
        const auto* header = static_cast<const ACE_HEADER*>(raw);
        if (header->AceType == ACCESS_DENIED_ACE_TYPE) continue;
        // Unknown/object/callback allow ACEs cannot silently bypass this installer.
        if (header->AceType != ACCESS_ALLOWED_ACE_TYPE) return false;
        const auto* ace = static_cast<const ACCESS_ALLOWED_ACE*>(raw);
        PSID sid = const_cast<PSID>(reinterpret_cast<const void*>(&ace->SidStart));
        if (!ownerIsMachineTrusted(sid) && (ace->Mask & kLowPrivilegeForbiddenWriteMask) != 0) return false;
    }
    return true;
}

using Fence = std::unique_ptr<WinHandle>;
Fence directoryFence(const std::wstring& path) {
    auto h = std::make_unique<WinHandle>(CreateFileW(path.c_str(), FILE_READ_ATTRIBUTES | READ_CONTROL,
        FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    FILE_ATTRIBUTE_TAG_INFO attrs{};
    if (h->value == INVALID_HANDLE_VALUE
        || !GetFileInformationByHandleEx(h->value, FileAttributeTagInfo, &attrs, sizeof(attrs))
        || (attrs.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
        || lower(finalPath(path, true)) != lower(fullPath(path)) || !strictMachineAcl(path)) return {};
    return h;
}

bool secureDirectory(const std::wstring& path, std::vector<Fence>* fences) {
    LocalSecurityDescriptor sd;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            L"O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FRFX;;;BU)",
            SDDL_REVISION_1, &sd.value, nullptr)) return false;
    SECURITY_ATTRIBUTES sa{sizeof(sa), sd.value, FALSE};
    if (!CreateDirectoryW(path.c_str(), &sa) && GetLastError() != ERROR_ALREADY_EXISTS) return false;
    auto fence = directoryFence(path);
    if (!fence) return false; // never repair/take over an existing untrusted directory
    fences->push_back(std::move(fence));
    return true;
}

bool exactFile(const std::wstring& path, ResourceBytes bytes) {
    WinHandle h(CreateFileW(path.c_str(), GENERIC_READ | READ_CONTROL, FILE_SHARE_READ, nullptr,
        OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    FILE_ATTRIBUTE_TAG_INFO attrs{}; LARGE_INTEGER size{};
    if (h.value == INVALID_HANDLE_VALUE || !GetFileSizeEx(h.value, &size)
        || size.QuadPart != bytes.size || !strictMachineAcl(path)
        || !GetFileInformationByHandleEx(h.value, FileAttributeTagInfo, &attrs, sizeof(attrs))
        || (attrs.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0
        || lower(finalPath(path, false)) != lower(fullPath(path))) return false;
    std::vector<BYTE> actual(bytes.size);
    DWORD read = 0;
    return ReadFile(h.value, actual.data(), bytes.size, &read, nullptr) && read == bytes.size
        && digest(actual.data(), bytes.size) == digest(bytes.data, bytes.size);
}

bool createExact(const std::wstring& path, ResourceBytes bytes) {
    WinHandle h(CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW,
        FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, nullptr));
    if (h.value == INVALID_HANDLE_VALUE) return false; // no overwrite or replacement
    DWORD written = 0;
    return WriteFile(h.value, bytes.data, bytes.size, &written, nullptr)
        && written == bytes.size && FlushFileBuffers(h.value);
}

std::wstring knownFolder(REFKNOWNFOLDERID id) {
    PWSTR raw = nullptr;
    if (FAILED(SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, nullptr, &raw)) || raw == nullptr) return {};
    std::wstring path(raw); CoTaskMemFree(raw); return path;
}

bool exactService(SC_HANDLE service, const std::wstring& path, bool running) {
    const auto config = queryConfig(service);
    if (config.empty()) return false;
    const auto* row = reinterpret_cast<const QUERY_SERVICE_CONFIGW*>(config.data());
    SERVICE_STATUS_PROCESS status{}; DWORD needed = 0;
    return row->dwServiceType == SERVICE_WIN32_OWN_PROCESS && row->dwStartType == SERVICE_AUTO_START
        && localSystemAccount(row->lpServiceStartName) && imagePathMatches(row->lpBinaryPathName, path)
        && QueryServiceStatusEx(service, SC_STATUS_PROCESS_INFO, reinterpret_cast<BYTE*>(&status), sizeof(status), &needed)
        && (!running || (status.dwCurrentState == SERVICE_RUNNING && status.dwProcessId > 0));
}

int bootstrapResult(const char* state, const char* reason, bool effect) {
    std::cout << "{\"schema\":\"metaengine.browser-guardian.machine-bootstrap-result.v1\","
        << "\"state\":\"" << state << "\",\"reason\":\"" << reason << "\","
        << "\"source_head\":\"" << kBootstrapSourceHead << "\","
        << "\"service_sha256\":\"" << kBootstrapServiceSha256 << "\","
        << "\"manifest_sha256\":\"" << kBootstrapManifestSha256 << "\","
        << "\"slot_id\":\"" << kBootstrapSlotId << "\","
        << "\"owner_enrolled\":false,\"installer_dispatch_exercised\":false,"
        << "\"automatic_retry_allowed\":false,\"authority_effect\":" << (effect ? "true" : "false") << "}\n";
    return std::string_view(state) == "READY" ? 0 : 2;
}

int installEmbedded() {
    const ResourceBytes serviceBytes = embedded(201), configBytes = embedded(202), manifestBytes = embedded(203);
    if (digest(serviceBytes.data, serviceBytes.size) != kBootstrapServiceSha256
        || digest(configBytes.data, configBytes.size) != kBootstrapConfiguratorSha256
        || digest(manifestBytes.data, manifestBytes.size) != kBootstrapManifestSha256)
        return bootstrapResult("NO_EFFECT_PROVEN", "EMBEDDED_ASSET_DIGEST_MISMATCH", false);
    std::vector<BYTE> admins;
    BOOL elevated = FALSE;
    if (!buildWellKnownSid(WinBuiltinAdministratorsSid, &admins)
        || !CheckTokenMembership(nullptr, admins.data(), &elevated) || !elevated)
        return bootstrapResult("NO_EFFECT_PROVEN", "ELEVATED_INSTALLER_REQUIRED", false);

    const std::wstring pf = programFilesRoot(), pd = knownFolder(FOLDERID_ProgramData);
    if (pf.empty() || pd.empty()) return bootstrapResult("NO_EFFECT_PROVEN", "MACHINE_ROOT_UNAVAILABLE", false);
    const std::wstring root = pf + L"\\METAENGINE\\Guardian";
    const std::wstring slot = root + L"\\slots\\" + std::wstring(kBootstrapSlotIdW);
    const std::wstring binary = slot + L"\\METAENGINEBrowserGuardian.exe";
    const std::wstring configurator = slot + L"\\METAENGINEBrowserGuardianConfigure.exe";
    const std::wstring manifest = slot + L"\\guardian-native-manifest.json";
    const std::wstring intent = root + L"\\bootstrap.intent";
    const std::wstring result = slot + L"\\bootstrap.ready";
    const std::string binding = std::string(kBootstrapSourceHead) + "\n" + kBootstrapManifestSha256 + "\n";
    const ResourceBytes marker{reinterpret_cast<const BYTE*>(binding.data()), static_cast<DWORD>(binding.size())};
    ServiceHandle scm(OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT | SC_MANAGER_CREATE_SERVICE));
    if (scm.value == nullptr) return bootstrapResult("NO_EFFECT_PROVEN", "SCM_ACCESS_UNAVAILABLE", false);
    ServiceHandle existing(OpenServiceW(scm.value, kServiceName, SERVICE_QUERY_CONFIG | SERVICE_QUERY_STATUS));
    if (existing.value != nullptr) {
        if (exactService(existing.value, binary, true) && exactFile(binary, serviceBytes)
            && exactFile(configurator, configBytes) && exactFile(manifest, manifestBytes)
            && exactFile(intent, marker) && exactFile(result, marker))
            return bootstrapResult("READY", "EXISTING_EXACT_BOOTSTRAP_READBACK", false);
        return bootstrapResult("HOLD", "EXISTING_SERVICE_REQUIRES_EXPLICIT_REPLACEMENT_PROTOCOL", false);
    }
    if (GetLastError() != ERROR_SERVICE_DOES_NOT_EXIST)
        return bootstrapResult("NO_EFFECT_PROVEN", "SERVICE_PRESENCE_UNRESOLVED", false);

    std::vector<Fence> fences;
    for (const std::wstring& path : {pf + L"\\METAENGINE", root, root + L"\\slots", slot,
            pd + L"\\METAENGINE", pd + L"\\METAENGINE\\Guardian"}) {
        if (!secureDirectory(path, &fences)) return bootstrapResult("HOLD", "MACHINE_DIRECTORY_TRUST_UNPROVEN", true);
    }
    // Exclusive flushed intent permanently fences a partially completed attempt.
    // A repeated invocation observes exact terminal state above or holds below.
    if (!createExact(intent, marker)) return bootstrapResult("HOLD", "PRIOR_BOOTSTRAP_OR_INTENT_FAILURE", true);
    if (!createExact(binary, serviceBytes) || !createExact(configurator, configBytes) || !createExact(manifest, manifestBytes)
        || !exactFile(binary, serviceBytes) || !exactFile(configurator, configBytes) || !exactFile(manifest, manifestBytes))
        return bootstrapResult("HOLD", "EXACT_MACHINE_COPY_UNPROVEN", true);
    if (applyConfiguration(binary) != 0) return bootstrapResult("HOLD", "SCM_CONFIG_READBACK_UNPROVEN", true);
    ServiceHandle installed(OpenServiceW(scm.value, kServiceName, SERVICE_QUERY_CONFIG | SERVICE_QUERY_STATUS | SERVICE_START));
    if (installed.value == nullptr || !exactService(installed.value, binary, false))
        return bootstrapResult("HOLD", "INSTALLED_SERVICE_BINDING_UNPROVEN", true);
    if (!StartServiceW(installed.value, 0, nullptr)) return bootstrapResult("HOLD", "SERVICE_START_OUTCOME_UNKNOWN", true);
    const ULONGLONG deadline = GetTickCount64() + 8'000;
    while (!exactService(installed.value, binary, true)) {
        if (GetTickCount64() >= deadline) return bootstrapResult("HOLD", "SERVICE_RUNNING_READBACK_TIMEOUT", true);
        Sleep(100);
    }
    if (!exactFile(binary, serviceBytes) || !createExact(result, marker) || !exactFile(result, marker))
        return bootstrapResult("HOLD", "TERMINAL_BOOTSTRAP_PROOF_UNPROVEN", true);
    return bootstrapResult("READY", "EXACT_MACHINE_COPY_SCM_AND_RUNNING_PROVEN", true);
}
}

int wmain(int argc, wchar_t** argv) {
    if (argc == 2 && std::wstring_view(argv[1]) == L"--install") return installEmbedded();
    if (argc == 2 && std::wstring_view(argv[1]) == L"--contract-json") {
        std::cout << "{\"schema\":\"metaengine.browser-guardian.machine-bootstrap.v1\","
            "\"requires_administrator\":true,\"embedded_assets_only\":true,"
            "\"caller_path_allowed\":false,\"network_allowed\":false,\"shell_allowed\":false,"
            "\"automatic_retry_allowed\":false,\"owner_replacement_allowed\":false,"
            "\"existing_service_replacement_allowed\":false,\"read_only\":true,\"authority_effect\":false}\n";
        return 0;
    }
    return bootstrapResult("NO_EFFECT_PROVEN", "EXPLICIT_INSTALL_REQUIRED", false);
}
