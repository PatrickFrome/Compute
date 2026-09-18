#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <aclapi.h>
#include <shlobj.h>
#include <shellapi.h>

#include <algorithm>
#include <cwctype>
#include <iostream>
#include <string>
#include <string_view>
#include <vector>

namespace {

constexpr wchar_t kServiceName[] = L"METAENGINEBrowserGuardian";
constexpr wchar_t kServiceBinaryName[] = L"METAENGINEBrowserGuardian.exe";
constexpr wchar_t kServiceDisplayName[] = L"METAENGINE Browser Guardian";
constexpr wchar_t kGuardianRelativeRoot[] = L"METAENGINE\\Guardian";
constexpr wchar_t kServiceDescription[] =
    L"METAENGINE Browser lifecycle Guardian. Owns only external process/release supervision; no page or task authority.";
constexpr wchar_t kRequiredPrivilegeTcb[] = L"SeTcbPrivilege";
constexpr wchar_t kRequiredPrivilegeAssignPrimary[] = L"SeAssignPrimaryTokenPrivilege";
constexpr wchar_t kRequiredPrivilegeIncreaseQuota[] = L"SeIncreaseQuotaPrivilege";
constexpr std::wstring_view kRequiredPrivileges[] = {
    kRequiredPrivilegeTcb,
    kRequiredPrivilegeAssignPrimary,
    kRequiredPrivilegeIncreaseQuota,
};
constexpr DWORD kRestartDelaysMs[] = {5'000, 15'000, 60'000};
constexpr DWORD kRecoveryConfigServiceAccess = SERVICE_QUERY_CONFIG | SERVICE_CHANGE_CONFIG | SERVICE_START;
constexpr ACCESS_MASK kLowPrivilegeForbiddenWriteMask =
    FILE_WRITE_DATA | FILE_APPEND_DATA | FILE_WRITE_EA | FILE_WRITE_ATTRIBUTES |
    DELETE | WRITE_DAC | WRITE_OWNER | GENERIC_WRITE | GENERIC_ALL;
constexpr char kContractJson[] =
    "{\"schema\":\"metaengine.browser-guardian.scm-configurator.v1\","
    "\"version\":\"1.2.0\","
    "\"service_name\":\"METAENGINEBrowserGuardian\","
    "\"apply_requires_explicit_flag\":true,"
    "\"service_configuration_authority\":true,"
    "\"service_start_stop_authority\":false,"
    "\"service_start_access_prerequisite_only\":true,"
    "\"machine_secure_service_path_required\":true,"
    "\"machine_secure_root\":\"%ProgramFiles%\\\\METAENGINE\\\\Guardian\","
    "\"service_binary_basename\":\"METAENGINEBrowserGuardian.exe\","
    "\"final_path_reparse_escape_forbidden\":true,"
    "\"low_privilege_write_acl_forbidden\":true,"
    "\"user_writable_service_binary_forbidden\":true,"
    "\"required_privileges\":[\"SeTcbPrivilege\",\"SeAssignPrimaryTokenPrivilege\",\"SeIncreaseQuotaPrivilege\"],"
    "\"service_sid_type\":\"SERVICE_SID_TYPE_UNRESTRICTED\","
    "\"least_privilege_readback_required\":true,"
    "\"browser_authority\":false,"
    "\"task_authority\":false,"
    "\"scheduler_authority\":false,"
    "\"page_model_text_authority\":false,"
    "\"release_authority\":false,"
    "\"automatic_retry_allowed\":false,"
    "\"failure_action_reboot_allowed\":false,"
    "\"failure_action_run_command_allowed\":false,"
    "\"readback_required\":true,"
    "\"authority_effect\":false}";

struct ServiceHandle {
    SC_HANDLE value = nullptr;
    ServiceHandle() = default;
    explicit ServiceHandle(SC_HANDLE handle) : value(handle) {}
    ~ServiceHandle() { if (value != nullptr) CloseServiceHandle(value); }
    ServiceHandle(const ServiceHandle&) = delete;
    ServiceHandle& operator=(const ServiceHandle&) = delete;
};

struct WinHandle {
    HANDLE value = INVALID_HANDLE_VALUE;
    WinHandle() = default;
    explicit WinHandle(HANDLE handle) : value(handle) {}
    ~WinHandle() { if (value != nullptr && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
    WinHandle(const WinHandle&) = delete;
    WinHandle& operator=(const WinHandle&) = delete;
};

struct LocalSecurityDescriptor {
    PSECURITY_DESCRIPTOR value = nullptr;
    ~LocalSecurityDescriptor() { if (value != nullptr) LocalFree(value); }
    LocalSecurityDescriptor(const LocalSecurityDescriptor&) = delete;
    LocalSecurityDescriptor& operator=(const LocalSecurityDescriptor&) = delete;
    LocalSecurityDescriptor() = default;
};

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

bool fileExists(const std::wstring& path) {
    const DWORD attrs = GetFileAttributesW(path.c_str());
    return attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

std::wstring lower(std::wstring value) {
    std::transform(value.begin(), value.end(), value.begin(), [](wchar_t ch) {
        return static_cast<wchar_t>(std::towlower(ch));
    });
    return value;
}

std::wstring trimExtendedPrefix(std::wstring value) {
    if (value.rfind(L"\\\\?\\UNC\\", 0) == 0) return L"\\\\" + value.substr(8);
    if (value.rfind(L"\\\\?\\", 0) == 0) return value.substr(4);
    return value;
}

std::wstring finalPath(const std::wstring& input, bool directory) {
    const DWORD flags = directory ? FILE_FLAG_BACKUP_SEMANTICS : FILE_ATTRIBUTE_NORMAL;
    WinHandle handle(CreateFileW(
        input.c_str(),
        FILE_READ_ATTRIBUTES | READ_CONTROL,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr,
        OPEN_EXISTING,
        flags,
        nullptr));
    if (handle.value == INVALID_HANDLE_VALUE) return {};
    const DWORD required = GetFinalPathNameByHandleW(handle.value, nullptr, 0, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    if (required == 0) return {};
    std::wstring buffer(required, L'\0');
    const DWORD written = GetFinalPathNameByHandleW(handle.value, buffer.data(), required, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    if (written == 0 || written >= required) return {};
    buffer.resize(written);
    return trimExtendedPrefix(buffer);
}

std::wstring parentDirectory(const std::wstring& path) {
    const std::size_t pos = path.find_last_of(L"\\/");
    return pos == std::wstring::npos ? std::wstring{} : path.substr(0, pos);
}

std::wstring baseName(const std::wstring& path) {
    const std::size_t pos = path.find_last_of(L"\\/");
    return pos == std::wstring::npos ? path : path.substr(pos + 1);
}

std::wstring programFilesRoot() {
    const HRESULT init = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    PWSTR raw = nullptr;
    const HRESULT hr = SHGetKnownFolderPath(FOLDERID_ProgramFiles, KF_FLAG_DEFAULT, nullptr, &raw);
    std::wstring out;
    if (SUCCEEDED(hr) && raw != nullptr) out = raw;
    if (raw != nullptr) CoTaskMemFree(raw);
    if (SUCCEEDED(init)) CoUninitialize();
    return out;
}

bool pathInside(const std::wstring& child, const std::wstring& root) {
    const std::wstring normalizedChild = lower(child);
    std::wstring normalizedRoot = lower(root);
    while (!normalizedRoot.empty() && (normalizedRoot.back() == L'\\' || normalizedRoot.back() == L'/')) normalizedRoot.pop_back();
    return normalizedChild.size() > normalizedRoot.size()
        && normalizedChild.compare(0, normalizedRoot.size(), normalizedRoot) == 0
        && (normalizedChild[normalizedRoot.size()] == L'\\' || normalizedChild[normalizedRoot.size()] == L'/');
}

bool buildWellKnownSid(WELL_KNOWN_SID_TYPE type, std::vector<BYTE>* storage) {
    if (storage == nullptr) return false;
    storage->resize(SECURITY_MAX_SID_SIZE);
    DWORD size = static_cast<DWORD>(storage->size());
    if (!CreateWellKnownSid(type, nullptr, storage->data(), &size)) return false;
    storage->resize(size);
    return true;
}

bool ownerIsMachineTrusted(PSID owner) {
    if (owner == nullptr || !IsValidSid(owner)) return false;
    std::vector<BYTE> systemSid;
    std::vector<BYTE> adminsSid;
    if (!buildWellKnownSid(WinLocalSystemSid, &systemSid)
        || !buildWellKnownSid(WinBuiltinAdministratorsSid, &adminsSid)) return false;
    return EqualSid(owner, systemSid.data()) || EqualSid(owner, adminsSid.data());
}

bool sidIsLowPrivilege(PSID sid) {
    if (sid == nullptr || !IsValidSid(sid)) return false;
    for (const WELL_KNOWN_SID_TYPE type : {WinWorldSid, WinBuiltinUsersSid, WinAuthenticatedUserSid}) {
        std::vector<BYTE> candidate;
        if (!buildWellKnownSid(type, &candidate)) return true;
        if (EqualSid(sid, candidate.data())) return true;
    }
    return false;
}

bool aclForbidsLowPrivilegeWrite(const std::wstring& path) {
    PSID owner = nullptr;
    PACL dacl = nullptr;
    LocalSecurityDescriptor descriptor;
    const DWORD error = GetNamedSecurityInfoW(
        const_cast<LPWSTR>(path.c_str()),
        SE_FILE_OBJECT,
        OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
        &owner,
        nullptr,
        &dacl,
        nullptr,
        &descriptor.value);
    if (error != ERROR_SUCCESS || descriptor.value == nullptr || dacl == nullptr || !IsValidAcl(dacl)) return false;
    if (!ownerIsMachineTrusted(owner)) return false;

    ACL_SIZE_INFORMATION info{};
    if (!GetAclInformation(dacl, &info, sizeof(info), AclSizeInformation)) return false;
    for (DWORD index = 0; index < info.AceCount; ++index) {
        LPVOID rawAce = nullptr;
        if (!GetAce(dacl, index, &rawAce) || rawAce == nullptr) return false;
        const auto* header = static_cast<const ACE_HEADER*>(rawAce);
        if (header->AceType != ACCESS_ALLOWED_ACE_TYPE) continue;
        const auto* ace = reinterpret_cast<const ACCESS_ALLOWED_ACE*>(rawAce);
        PSID sid = const_cast<PSID>(reinterpret_cast<const void*>(&ace->SidStart));
        if (sidIsLowPrivilege(sid) && (ace->Mask & kLowPrivilegeForbiddenWriteMask) != 0) return false;
    }
    return true;
}

bool machineSecureServiceBinary(const std::wstring& binaryPath) {
    if (_wcsicmp(baseName(binaryPath).c_str(), kServiceBinaryName) != 0) return false;
    const std::wstring programFiles = programFilesRoot();
    if (programFiles.empty()) return false;
    const std::wstring configuredRoot = fullPath(programFiles + L"\\" + kGuardianRelativeRoot);
    if (configuredRoot.empty()) return false;
    const std::wstring finalRoot = finalPath(configuredRoot, true);
    const std::wstring finalBinary = finalPath(binaryPath, false);
    if (finalRoot.empty() || finalBinary.empty() || !pathInside(finalBinary, finalRoot)) return false;
    const std::wstring finalParent = parentDirectory(finalBinary);
    if (finalParent.empty() || !pathInside(finalParent + L"\\child", finalRoot)) return false;
    return aclForbidsLowPrivilegeWrite(finalRoot)
        && aclForbidsLowPrivilegeWrite(finalParent)
        && aclForbidsLowPrivilegeWrite(finalBinary);
}

bool imagePathMatches(const wchar_t* configured, const std::wstring& expected) {
    if (configured == nullptr || expected.empty()) return false;
    int argc = 0;
    LPWSTR* argv = CommandLineToArgvW(configured, &argc);
    if (argv == nullptr) return false;
    const bool oneArgument = argc == 1;
    const std::wstring actual = oneArgument ? fullPath(argv[0]) : std::wstring{};
    LocalFree(argv);
    return oneArgument && !actual.empty() && lower(actual) == lower(expected);
}

std::vector<BYTE> queryConfig(SC_HANDLE service) {
    DWORD required = 0;
    QueryServiceConfigW(service, nullptr, 0, &required);
    if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || required == 0) return {};
    std::vector<BYTE> buffer(required);
    if (!QueryServiceConfigW(service, reinterpret_cast<LPQUERY_SERVICE_CONFIGW>(buffer.data()), required, &required)) return {};
    return buffer;
}

std::vector<BYTE> queryConfig2(SC_HANDLE service, DWORD level) {
    DWORD required = 0;
    QueryServiceConfig2W(service, level, nullptr, 0, &required);
    if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || required == 0) return {};
    std::vector<BYTE> buffer(required);
    if (!QueryServiceConfig2W(service, level, buffer.data(), required, &required)) return {};
    return buffer;
}

bool localSystemAccount(const wchar_t* value) {
    if (value == nullptr) return false;
    const std::wstring normalized = lower(value);
    return normalized == L"localsystem" || normalized == L".\\localsystem" || normalized == L"nt authority\\system";
}

std::vector<wchar_t> requiredPrivilegeMultiSz() {
    std::vector<wchar_t> out;
    for (const std::wstring_view privilege : kRequiredPrivileges) {
        out.insert(out.end(), privilege.begin(), privilege.end());
        out.push_back(L'\0');
    }
    out.push_back(L'\0');
    return out;
}

std::vector<std::wstring> parseMultiSz(const wchar_t* raw) {
    std::vector<std::wstring> values;
    if (raw == nullptr) return values;
    const wchar_t* cursor = raw;
    while (*cursor != L'\0') {
        std::wstring value(cursor);
        if (value.empty()) return {};
        values.push_back(lower(std::move(value)));
        cursor += std::wcslen(cursor) + 1;
    }
    return values;
}

bool requiredPrivilegesMatch(const wchar_t* raw) {
    std::vector<std::wstring> actual = parseMultiSz(raw);
    if (actual.size() != std::size(kRequiredPrivileges)) return false;
    std::vector<std::wstring> expected;
    expected.reserve(std::size(kRequiredPrivileges));
    for (const std::wstring_view privilege : kRequiredPrivileges) expected.push_back(lower(std::wstring(privilege)));
    std::sort(actual.begin(), actual.end());
    std::sort(expected.begin(), expected.end());
    return actual == expected;
}

int fail(const char* reason, DWORD error = ERROR_SUCCESS) {
    std::cerr << "{\"schema\":\"metaengine.browser-guardian.scm-configurator-error.v1\","
              << "\"reason\":\"" << reason << "\","
              << "\"win32_error\":" << error << ","
              << "\"automatic_retry_allowed\":false,"
              << "\"browser_authority\":false,"
              << "\"task_authority\":false,"
              << "\"authority_effect\":false}\n";
    return 2;
}

int printContract() {
    std::cout << kContractJson << '\n';
    return 0;
}

int applyConfiguration(const std::wstring& rawBinaryPath) {
    const std::wstring binaryPath = fullPath(rawBinaryPath);
    if (binaryPath.empty() || !fileExists(binaryPath)) return fail("SERVICE_BINARY_INVALID", GetLastError());
    if (!machineSecureServiceBinary(binaryPath)) return fail("SERVICE_BINARY_MACHINE_TRUST_INVALID", ERROR_ACCESS_DENIED);
    const std::wstring quotedBinaryPath = L"\"" + binaryPath + L"\"";

    ServiceHandle scm(OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT | SC_MANAGER_CREATE_SERVICE));
    if (scm.value == nullptr) return fail("SCM_OPEN_FAILED", GetLastError());

    bool created = false;
    ServiceHandle service(OpenServiceW(scm.value, kServiceName, kRecoveryConfigServiceAccess));
    if (service.value == nullptr) {
        const DWORD openError = GetLastError();
        if (openError != ERROR_SERVICE_DOES_NOT_EXIST) return fail("SERVICE_OPEN_FAILED", openError);
        service.value = CreateServiceW(
            scm.value,
            kServiceName,
            kServiceDisplayName,
            kRecoveryConfigServiceAccess,
            SERVICE_WIN32_OWN_PROCESS,
            SERVICE_AUTO_START,
            SERVICE_ERROR_NORMAL,
            quotedBinaryPath.c_str(),
            nullptr,
            nullptr,
            nullptr,
            nullptr,
            nullptr);
        if (service.value == nullptr) return fail("SERVICE_CREATE_FAILED", GetLastError());
        created = true;
    } else {
        const std::vector<BYTE> currentBuffer = queryConfig(service.value);
        if (currentBuffer.empty()) return fail("SERVICE_EXISTING_CONFIG_READ_FAILED", GetLastError());
        const auto* current = reinterpret_cast<const QUERY_SERVICE_CONFIGW*>(currentBuffer.data());
        if (current->dwServiceType != SERVICE_WIN32_OWN_PROCESS) return fail("SERVICE_EXISTING_TYPE_DRIFT");
        if (!localSystemAccount(current->lpServiceStartName)) return fail("SERVICE_EXISTING_ACCOUNT_DRIFT");
        if (!imagePathMatches(current->lpBinaryPathName, binaryPath)) return fail("SERVICE_EXISTING_BINARY_DRIFT");
        if (!ChangeServiceConfigW(service.value, SERVICE_NO_CHANGE, SERVICE_AUTO_START, SERVICE_NO_CHANGE,
                nullptr, nullptr, nullptr, nullptr, nullptr, nullptr, kServiceDisplayName)) {
            return fail("SERVICE_START_MODE_CONFIG_FAILED", GetLastError());
        }
    }

    SERVICE_DESCRIPTIONW description{};
    description.lpDescription = const_cast<LPWSTR>(kServiceDescription);
    if (!ChangeServiceConfig2W(service.value, SERVICE_CONFIG_DESCRIPTION, &description)) {
        return fail("SERVICE_DESCRIPTION_CONFIG_FAILED", GetLastError());
    }

    std::vector<wchar_t> privilegeMultiSz = requiredPrivilegeMultiSz();
    SERVICE_REQUIRED_PRIVILEGES_INFOW requiredPrivileges{};
    requiredPrivileges.pmszRequiredPrivileges = privilegeMultiSz.data();
    if (!ChangeServiceConfig2W(service.value, SERVICE_CONFIG_REQUIRED_PRIVILEGES_INFO, &requiredPrivileges)) {
        return fail("SERVICE_REQUIRED_PRIVILEGES_CONFIG_FAILED", GetLastError());
    }

    SERVICE_SID_INFO sidInfo{};
    sidInfo.dwServiceSidType = SERVICE_SID_TYPE_UNRESTRICTED;
    if (!ChangeServiceConfig2W(service.value, SERVICE_CONFIG_SERVICE_SID_INFO, &sidInfo)) {
        return fail("SERVICE_SID_CONFIG_FAILED", GetLastError());
    }

    SC_ACTION actions[3] = {
        {SC_ACTION_RESTART, kRestartDelaysMs[0]},
        {SC_ACTION_RESTART, kRestartDelaysMs[1]},
        {SC_ACTION_RESTART, kRestartDelaysMs[2]},
    };
    SERVICE_FAILURE_ACTIONSW failureActions{};
    failureActions.dwResetPeriod = INFINITE;
    failureActions.cActions = 3;
    failureActions.lpsaActions = actions;
    if (!ChangeServiceConfig2W(service.value, SERVICE_CONFIG_FAILURE_ACTIONS, &failureActions)) {
        return fail("SERVICE_FAILURE_ACTIONS_CONFIG_FAILED", GetLastError());
    }

    SERVICE_FAILURE_ACTIONS_FLAG failureFlag{};
    failureFlag.fFailureActionsOnNonCrashFailures = TRUE;
    if (!ChangeServiceConfig2W(service.value, SERVICE_CONFIG_FAILURE_ACTIONS_FLAG, &failureFlag)) {
        return fail("SERVICE_FAILURE_FLAG_CONFIG_FAILED", GetLastError());
    }

    const std::vector<BYTE> configBuffer = queryConfig(service.value);
    if (configBuffer.empty()) return fail("SERVICE_CONFIG_READBACK_FAILED", GetLastError());
    const auto* config = reinterpret_cast<const QUERY_SERVICE_CONFIGW*>(configBuffer.data());
    if (config->dwServiceType != SERVICE_WIN32_OWN_PROCESS) return fail("SERVICE_TYPE_READBACK_MISMATCH");
    if (config->dwStartType != SERVICE_AUTO_START) return fail("SERVICE_START_MODE_READBACK_MISMATCH");
    if (!localSystemAccount(config->lpServiceStartName)) return fail("SERVICE_ACCOUNT_READBACK_MISMATCH");
    if (!imagePathMatches(config->lpBinaryPathName, binaryPath)) return fail("SERVICE_BINARY_READBACK_MISMATCH");

    const std::vector<BYTE> privilegeBuffer = queryConfig2(service.value, SERVICE_CONFIG_REQUIRED_PRIVILEGES_INFO);
    if (privilegeBuffer.size() < sizeof(SERVICE_REQUIRED_PRIVILEGES_INFOW)) {
        return fail("SERVICE_REQUIRED_PRIVILEGES_READBACK_FAILED", GetLastError());
    }
    const auto* privilegeReadback = reinterpret_cast<const SERVICE_REQUIRED_PRIVILEGES_INFOW*>(privilegeBuffer.data());
    if (!requiredPrivilegesMatch(privilegeReadback->pmszRequiredPrivileges)) {
        return fail("SERVICE_REQUIRED_PRIVILEGES_READBACK_MISMATCH");
    }

    const std::vector<BYTE> sidBuffer = queryConfig2(service.value, SERVICE_CONFIG_SERVICE_SID_INFO);
    if (sidBuffer.size() < sizeof(SERVICE_SID_INFO)) return fail("SERVICE_SID_READBACK_FAILED", GetLastError());
    const auto* sidReadback = reinterpret_cast<const SERVICE_SID_INFO*>(sidBuffer.data());
    if (sidReadback->dwServiceSidType != SERVICE_SID_TYPE_UNRESTRICTED) return fail("SERVICE_SID_READBACK_MISMATCH");

    const std::vector<BYTE> failureBuffer = queryConfig2(service.value, SERVICE_CONFIG_FAILURE_ACTIONS);
    if (failureBuffer.empty()) return fail("SERVICE_FAILURE_ACTIONS_READBACK_FAILED", GetLastError());
    const auto* failure = reinterpret_cast<const SERVICE_FAILURE_ACTIONSW*>(failureBuffer.data());
    if (failure->dwResetPeriod != INFINITE || failure->cActions != 3 || failure->lpsaActions == nullptr) {
        return fail("SERVICE_FAILURE_ACTIONS_READBACK_MISMATCH");
    }
    for (DWORD i = 0; i < 3; ++i) {
        if (failure->lpsaActions[i].Type != SC_ACTION_RESTART || failure->lpsaActions[i].Delay != kRestartDelaysMs[i]) {
            return fail("SERVICE_RESTART_SEQUENCE_READBACK_MISMATCH");
        }
    }
    if ((failure->lpRebootMsg != nullptr && failure->lpRebootMsg[0] != L'\0')
        || (failure->lpCommand != nullptr && failure->lpCommand[0] != L'\0')) {
        return fail("SERVICE_FORBIDDEN_FAILURE_ACTION_READBACK");
    }

    const std::vector<BYTE> flagBuffer = queryConfig2(service.value, SERVICE_CONFIG_FAILURE_ACTIONS_FLAG);
    if (flagBuffer.size() < sizeof(SERVICE_FAILURE_ACTIONS_FLAG)) return fail("SERVICE_FAILURE_FLAG_READBACK_FAILED", GetLastError());
    const auto* flag = reinterpret_cast<const SERVICE_FAILURE_ACTIONS_FLAG*>(flagBuffer.data());
    if (flag->fFailureActionsOnNonCrashFailures != TRUE) return fail("SERVICE_FAILURE_FLAG_READBACK_MISMATCH");

    std::cout << "{\"schema\":\"metaengine.browser-guardian.scm-configurator-result.v1\","
              << "\"service_name\":\"METAENGINEBrowserGuardian\","
              << "\"created\":" << (created ? "true" : "false") << ','
              << "\"service_type\":\"SERVICE_WIN32_OWN_PROCESS\","
              << "\"start_type\":\"SERVICE_AUTO_START\","
              << "\"account\":\"LocalSystem\","
              << "\"required_privileges\":[\"SeTcbPrivilege\",\"SeAssignPrimaryTokenPrivilege\",\"SeIncreaseQuotaPrivilege\"],"
              << "\"service_sid_type\":\"SERVICE_SID_TYPE_UNRESTRICTED\","
              << "\"least_privilege_readback_proven\":true,"
              << "\"machine_secure_binary_path\":true,"
              << "\"failure_reset_period\":\"INFINITE\","
              << "\"failure_actions\":["
              << "{\"type\":\"RESTART\",\"delay_ms\":5000},"
              << "{\"type\":\"RESTART\",\"delay_ms\":15000},"
              << "{\"type\":\"RESTART\",\"delay_ms\":60000}],"
              << "\"last_failure_action_repeats\":true,"
              << "\"non_crash_failure_actions\":true,"
              << "\"reboot_action\":false,"
              << "\"run_command_action\":false,"
              << "\"service_start_stop_effect\":false,"
              << "\"browser_authority\":false,"
              << "\"task_authority\":false,"
              << "\"scheduler_authority\":false,"
              << "\"page_model_text_authority\":false,"
              << "\"release_authority\":false,"
              << "\"automatic_retry_allowed\":false,"
              << "\"readback_proven\":true,"
              << "\"authority_effect\":true}\n";
    return 0;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
    if (argc == 2 && std::wstring_view(argv[1]) == L"--contract-json") return printContract();
    if (argc == 4 && std::wstring_view(argv[1]) == L"--apply" && std::wstring_view(argv[2]) == L"--service-binary") {
        return applyConfiguration(argv[3] == nullptr ? L"" : argv[3]);
    }
    return fail("USAGE_INVALID");
}