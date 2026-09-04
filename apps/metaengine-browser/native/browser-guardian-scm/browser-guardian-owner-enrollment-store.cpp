#include "browser-guardian-owner-enrollment-store.hpp"

#include <aclapi.h>
#include <objbase.h>
#include <sddl.h>
#include <shlobj.h>

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstring>
#include <cwctype>
#include <string_view>
#include <utility>
#include <vector>

namespace metaengine::guardian {
namespace {

constexpr wchar_t kRelativeRoot[] = L"METAENGINE\\Guardian";
constexpr wchar_t kRecordName[] = L"owner-enrollment-v1.record";
constexpr wchar_t kStageDacl[] = L"D:P(A;;FA;;;SY)(A;;FA;;;BA)";
constexpr char kLogicalSchema[] = "metaengine.browser-guardian.owner-enrollment-record.v1";
constexpr char kWireSchema[] = "metaengine.browser-guardian.owner-enrollment-store-record.v1";
constexpr DWORD kForbiddenWrite = FILE_WRITE_DATA | FILE_APPEND_DATA | FILE_WRITE_EA |
    FILE_WRITE_ATTRIBUTES | FILE_DELETE_CHILD | DELETE | WRITE_DAC | WRITE_OWNER |
    GENERIC_WRITE | GENERIC_ALL;
constexpr std::size_t kMaxBytes = 2048;

constexpr char kContract[] =
    "{\"schema\":\"metaengine.browser-guardian.owner-enrollment-native-store.v1\","
    "\"version\":\"1.0.1\","
    "\"machine_secure_root_required\":true,\"root_creation_implemented\":false,"
    "\"root_repair_implemented\":false,\"final_path_reparse_escape_forbidden\":true,"
    "\"low_privilege_write_acl_forbidden\":true,\"non_machine_write_acl_forbidden\":true,"
    "\"machine_trusted_owner_required\":true,\"root_delete_share_fenced\":true,"
    "\"same_directory_staging\":true,\"staging_create_new\":true,"
    "\"staging_flush_file_buffers\":true,\"commit_move_fail_if_exists\":true,"
    "\"commit_move_write_through\":true,\"commit_handle_relative_rename\":true,"
    "\"post_commit_readback_required\":true,"
    "\"owner_replacement_allowed\":false,\"token_session_id_persisted\":false,"
    "\"journal_mutation_allowed\":false,\"wts_execution_allowed\":false,"
    "\"process_effect_allowed\":false,\"scm_effect_allowed\":false,"
    "\"browser_authority\":false,\"task_authority\":false,\"scheduler_authority\":false,"
    "\"automatic_retry_allowed\":false,\"second_scheduler_loop\":false,\"authority_effect\":false}";

struct Handle {
    HANDLE value = INVALID_HANDLE_VALUE;
    explicit Handle(HANDLE h = INVALID_HANDLE_VALUE) : value(h) {}
    ~Handle() { if (value != nullptr && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    Handle(Handle&& other) noexcept : value(std::exchange(other.value, INVALID_HANDLE_VALUE)) {}
    Handle& operator=(Handle&& other) noexcept {
        if (this == &other) return *this;
        if (value != nullptr && value != INVALID_HANDLE_VALUE) CloseHandle(value);
        value = std::exchange(other.value, INVALID_HANDLE_VALUE);
        return *this;
    }
    bool valid() const noexcept { return value != nullptr && value != INVALID_HANDLE_VALUE; }
};
struct Local {
    HLOCAL value = nullptr;
    Local() = default;
    ~Local() { if (value != nullptr) LocalFree(value); }
    Local(const Local&) = delete;
    Local& operator=(const Local&) = delete;
};

std::wstring lower(std::wstring v) {
    std::transform(v.begin(), v.end(), v.begin(), [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });
    return v;
}
std::wstring stripPrefix(std::wstring v) {
    if (v.rfind(L"\\\\?\\UNC\\", 0) == 0) return L"\\\\" + v.substr(8);
    if (v.rfind(L"\\\\?\\", 0) == 0) return v.substr(4);
    return v;
}
std::wstring fullPath(const std::wstring& p) {
    if (p.empty()) return {};
    const DWORD n = GetFullPathNameW(p.c_str(), 0, nullptr, nullptr);
    if (n == 0) return {};
    std::wstring out(n, L'\0');
    const DWORD written = GetFullPathNameW(p.c_str(), n, out.data(), nullptr);
    if (written == 0 || written >= n) return {};
    out.resize(written);
    return out;
}
std::wstring finalPath(HANDLE h) {
    const DWORD n = GetFinalPathNameByHandleW(h, nullptr, 0, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    if (n == 0) return {};
    std::wstring out(n, L'\0');
    const DWORD written = GetFinalPathNameByHandleW(h, out.data(), n, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    if (written == 0 || written >= n) return {};
    out.resize(written);
    return stripPrefix(out);
}
std::wstring programData() {
    PWSTR raw = nullptr;
    const HRESULT hr = SHGetKnownFolderPath(FOLDERID_ProgramData, KF_FLAG_DEFAULT, nullptr, &raw);
    std::wstring out;
    if (SUCCEEDED(hr) && raw != nullptr) out = raw;
    if (raw != nullptr) CoTaskMemFree(raw);
    return out;
}

bool wellKnown(WELL_KNOWN_SID_TYPE type, std::vector<BYTE>* out) {
    out->resize(SECURITY_MAX_SID_SIZE);
    DWORD n = static_cast<DWORD>(out->size());
    if (!CreateWellKnownSid(type, nullptr, out->data(), &n)) return false;
    out->resize(n);
    return true;
}
bool machineOwner(PSID sid) {
    if (sid == nullptr || !IsValidSid(sid)) return false;
    std::vector<BYTE> system, admins;
    return wellKnown(WinLocalSystemSid, &system) && wellKnown(WinBuiltinAdministratorsSid, &admins)
        && (EqualSid(sid, system.data()) || EqualSid(sid, admins.data()));
}
bool secureAcl(HANDLE h) {
    PSID owner = nullptr;
    PACL dacl = nullptr;
    PSECURITY_DESCRIPTOR raw = nullptr;
    const DWORD error = GetSecurityInfo(h, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
        &owner, nullptr, &dacl, nullptr, &raw);
    Local holder; holder.value = reinterpret_cast<HLOCAL>(raw);
    if (error != ERROR_SUCCESS || raw == nullptr || dacl == nullptr || !IsValidAcl(dacl) || !machineOwner(owner)) return false;
    ACL_SIZE_INFORMATION info{};
    if (!GetAclInformation(dacl, &info, sizeof(info), AclSizeInformation)) return false;
    for (DWORD i = 0; i < info.AceCount; ++i) {
        LPVOID rawAce = nullptr;
        if (!GetAce(dacl, i, &rawAce) || rawAce == nullptr) return false;
        const auto* header = static_cast<const ACE_HEADER*>(rawAce);
        if (header->AceType == ACCESS_DENIED_ACE_TYPE) continue;
        if (header->AceType != ACCESS_ALLOWED_ACE_TYPE) return false;
        const auto* ace = reinterpret_cast<const ACCESS_ALLOWED_ACE*>(rawAce);
        PSID sid = const_cast<PSID>(reinterpret_cast<const void*>(&ace->SidStart));
        if (!IsValidSid(sid)) return false;
        if ((ace->Mask & kForbiddenWrite) != 0 && !machineOwner(sid)) return false;
    }
    return true;
}
bool noReparse(HANDLE h) {
    FILE_ATTRIBUTE_TAG_INFO info{};
    return GetFileInformationByHandleEx(h, FileAttributeTagInfo, &info, sizeof(info))
        && (info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0;
}
Handle openSecureRoot(const std::wstring& root, DWORD extraAccess = 0) {
    const std::wstring pd = programData();
    const std::wstring expected = pd.empty() ? std::wstring{} : fullPath(pd + L"\\" + kRelativeRoot);
    const std::wstring actual = fullPath(root);
    if (expected.empty() || actual.empty() || lower(expected) != lower(actual)) return Handle{};

    Handle h(CreateFileW(actual.c_str(), FILE_READ_ATTRIBUTES | READ_CONTROL | extraAccess,
        FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    if (!h.valid() || !noReparse(h.value)) return Handle{};
    const std::wstring resolved = finalPath(h.value);
    if (resolved.empty() || lower(resolved) != lower(actual) || !secureAcl(h.value)) return Handle{};
    return h;
}

bool hash64(std::string_view s) {
    return s.size() == 64 && std::all_of(s.begin(), s.end(), [](unsigned char c) {
        return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
    });
}
std::wstring canonicalSid(const std::wstring& input) {
    PSID sid = nullptr;
    if (!ConvertStringSidToSidW(input.c_str(), &sid) || sid == nullptr) return {};
    Local sidHolder; sidHolder.value = reinterpret_cast<HLOCAL>(sid);
    LPWSTR raw = nullptr;
    if (!IsValidSid(sid) || !ConvertSidToStringSidW(sid, &raw) || raw == nullptr) return {};
    Local rawHolder; rawHolder.value = reinterpret_cast<HLOCAL>(raw);
    return raw;
}
std::string ascii(const std::wstring& s) {
    std::string out;
    out.reserve(s.size());
    for (wchar_t c : s) {
        if (c < 0x20 || c > 0x7e) return {};
        out.push_back(static_cast<char>(c));
    }
    return out;
}
bool normalize(const OwnerEnrollmentDurableRecord& in, OwnerEnrollmentDurableRecord* out) {
    const std::wstring sid = canonicalSid(in.expected_owner_sid);
    if (out == nullptr || sid.empty() || !hash64(in.enrollment_evidence_sha256) || !hash64(in.device_key_fingerprint_sha256)) return false;
    out->expected_owner_sid = sid;
    out->enrollment_evidence_sha256 = in.enrollment_evidence_sha256;
    out->device_key_fingerprint_sha256 = in.device_key_fingerprint_sha256;
    return true;
}
std::string serializeRecord(const OwnerEnrollmentDurableRecord& r) {
    const std::string sid = ascii(r.expected_owner_sid);
    if (sid.empty()) return {};
    return std::string("wire_schema=") + kWireSchema + "\nlogical_schema=" + kLogicalSchema
        + "\nexpected_owner_sid=" + sid + "\nenrollment_evidence_sha256=" + r.enrollment_evidence_sha256
        + "\ndevice_key_fingerprint_sha256=" + r.device_key_fingerprint_sha256 + "\n";
}
bool line(std::string_view* rest, std::string_view prefix, std::string* value) {
    const auto n = rest->find('\n');
    if (n == std::string_view::npos) return false;
    const auto current = rest->substr(0, n);
    *rest = rest->substr(n + 1);
    if (!current.starts_with(prefix)) return false;
    *value = std::string(current.substr(prefix.size()));
    return true;
}
bool parseRecord(std::string_view payload, OwnerEnrollmentDurableRecord* out) {
    if (out == nullptr || payload.empty() || payload.size() > kMaxBytes) return false;
    std::string wire, logical, sid, evidence, device;
    if (!line(&payload, "wire_schema=", &wire) || !line(&payload, "logical_schema=", &logical)
        || !line(&payload, "expected_owner_sid=", &sid) || !line(&payload, "enrollment_evidence_sha256=", &evidence)
        || !line(&payload, "device_key_fingerprint_sha256=", &device) || !payload.empty()
        || wire != kWireSchema || logical != kLogicalSchema || !hash64(evidence) || !hash64(device)) return false;
    const std::wstring wide(sid.begin(), sid.end());
    const std::wstring canonical = canonicalSid(wide);
    if (canonical.empty() || canonical != wide) return false;
    out->expected_owner_sid = canonical;
    out->enrollment_evidence_sha256 = std::move(evidence);
    out->device_key_fingerprint_sha256 = std::move(device);
    return true;
}
bool readBounded(HANDLE h, std::string* out, DWORD* error) {
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(h, &size) || size.QuadPart <= 0 || size.QuadPart > static_cast<LONGLONG>(kMaxBytes)) {
        if (error) *error = ERROR_INVALID_DATA;
        return false;
    }
    out->assign(static_cast<std::size_t>(size.QuadPart), '\0');
    DWORD total = 0;
    while (total < out->size()) {
        DWORD got = 0;
        const DWORD remaining = static_cast<DWORD>(out->size() - total);
        if (!ReadFile(h, out->data() + total, remaining, &got, nullptr) || got == 0) {
            if (error) *error = got == 0 ? ERROR_HANDLE_EOF : GetLastError();
            return false;
        }
        total += got;
    }
    if (error) *error = ERROR_SUCCESS;
    return true;
}

OwnerEnrollmentStoreResult classify(const std::wstring& root, const std::wstring& file,
    const OwnerEnrollmentDurableRecord* expected = nullptr) {
    OwnerEnrollmentStoreResult out;
    Handle rootGuard = openSecureRoot(root);
    out.root_trusted = rootGuard.valid();
    if (!out.root_trusted) { out.reason = "OWNER_STORE_ROOT_NOT_MACHINE_TRUSTED"; out.win32_error = ERROR_ACCESS_DENIED; return out; }

    Handle h(CreateFileW(file.c_str(), GENERIC_READ | READ_CONTROL, FILE_SHARE_READ, nullptr,
        OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    if (!h.valid()) {
        const DWORD error = GetLastError();
        if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND) { out.reason = "OWNER_STORE_RECORD_ABSENT"; return out; }
        out.reason = "OWNER_STORE_RECORD_OPEN_FAILED"; out.win32_error = error; return out;
    }
    out.present = true;
    const std::wstring resolved = finalPath(h.value);
    const std::wstring wanted = fullPath(file);
    if (!noReparse(h.value) || resolved.empty() || wanted.empty() || lower(resolved) != lower(wanted)) {
        out.corrupt = true; out.reason = "OWNER_STORE_FINAL_PATH_ESCAPE"; out.win32_error = ERROR_ACCESS_DENIED; return out;
    }
    if (!secureAcl(h.value)) { out.corrupt = true; out.reason = "OWNER_STORE_RECORD_SECURITY_INVALID"; out.win32_error = ERROR_ACCESS_DENIED; return out; }
    std::string payload; DWORD error = ERROR_SUCCESS;
    if (!readBounded(h.value, &payload, &error) || !parseRecord(payload, &out.record)) {
        out.corrupt = true; out.reason = "OWNER_STORE_RECORD_INVALID"; out.win32_error = error == ERROR_SUCCESS ? ERROR_INVALID_DATA : error; return out;
    }
    if (expected != nullptr) {
        OwnerEnrollmentDurableRecord normalized;
        if (!normalize(*expected, &normalized)) { out.corrupt = true; out.reason = "OWNER_STORE_EXPECTED_RECORD_INVALID"; out.win32_error = ERROR_INVALID_DATA; return out; }
        out.exact = out.record.expected_owner_sid == normalized.expected_owner_sid;
        out.provenance_exact = out.exact && out.record.enrollment_evidence_sha256 == normalized.enrollment_evidence_sha256
            && out.record.device_key_fingerprint_sha256 == normalized.device_key_fingerprint_sha256;
        out.owner_mismatch = !out.exact;
        out.reason = out.owner_mismatch ? "OWNER_STORE_OWNER_MISMATCH"
            : (out.provenance_exact ? "OWNER_STORE_RECORD_EXACT" : "OWNER_STORE_OWNER_EXACT_DIFFERENT_PROVENANCE");
    } else out.reason = "OWNER_STORE_RECORD_VALID";
    return out;
}

std::wstring stagePath(const std::wstring& root) {
    GUID id{}; if (FAILED(CoCreateGuid(&id))) return {};
    std::array<wchar_t, 64> raw{}; if (StringFromGUID2(id, raw.data(), static_cast<int>(raw.size())) <= 0) return {};
    std::wstring value(raw.data());
    value.erase(std::remove(value.begin(), value.end(), L'{'), value.end());
    value.erase(std::remove(value.begin(), value.end(), L'}'), value.end());
    return root + L"\\owner-enrollment-v1." + value + L".tmp";
}
bool writeAll(HANDLE h, std::string_view payload) {
    std::size_t offset = 0;
    while (offset < payload.size()) {
        DWORD written = 0;
        const DWORD n = static_cast<DWORD>(std::min<std::size_t>(payload.size() - offset, MAXDWORD));
        if (!WriteFile(h, payload.data() + offset, n, &written, nullptr) || written == 0) return false;
        offset += written;
    }
    return true;
}
bool renameIntoRootFailIfExists(HANDLE file, HANDLE root, std::wstring_view name, DWORD* error) {
    if (file == nullptr || file == INVALID_HANDLE_VALUE || root == nullptr || root == INVALID_HANDLE_VALUE || name.empty()) {
        if (error) *error = ERROR_INVALID_PARAMETER;
        return false;
    }
    constexpr std::size_t baseBytes = offsetof(FILE_RENAME_INFO, FileName);
    const std::size_t maxNameBytes = static_cast<std::size_t>(MAXDWORD) - baseBytes;
    if (name.size() > (maxNameBytes / sizeof(wchar_t))) {
        if (error) *error = ERROR_FILENAME_EXCED_RANGE;
        return false;
    }
    const std::size_t nameBytes = name.size() * sizeof(wchar_t);
    const std::size_t bytes = baseBytes + nameBytes;
    Local buffer;
    buffer.value = LocalAlloc(LPTR, bytes);
    if (buffer.value == nullptr) {
        if (error) *error = ERROR_NOT_ENOUGH_MEMORY;
        return false;
    }
    auto* info = reinterpret_cast<FILE_RENAME_INFO*>(buffer.value);
    info->ReplaceIfExists = FALSE;
    info->RootDirectory = root;
    info->FileNameLength = static_cast<DWORD>(nameBytes);
    std::memcpy(info->FileName, name.data(), nameBytes);
    if (!SetFileInformationByHandle(file, FileRenameInfo, info, static_cast<DWORD>(bytes))) {
        if (error) *error = GetLastError();
        return false;
    }
    if (error) *error = ERROR_SUCCESS;
    return true;
}

}  // namespace

OwnerEnrollmentStore::OwnerEnrollmentStore(std::wstring root_path) : root_path_(std::move(root_path)) {}
std::wstring OwnerEnrollmentStore::recordPath() const { return root_path_.empty() ? std::wstring{} : root_path_ + L"\\" + kRecordName; }
OwnerEnrollmentStoreResult OwnerEnrollmentStore::read() const { return classify(root_path_, recordPath()); }

OwnerEnrollmentStoreResult OwnerEnrollmentStore::createIfAbsent(const OwnerEnrollmentDurableRecord& candidate) const {
    OwnerEnrollmentStoreResult out;
    Handle rootGuard = openSecureRoot(root_path_, FILE_ADD_FILE);
    out.root_trusted = rootGuard.valid();
    if (!out.root_trusted) { out.reason = "OWNER_STORE_ROOT_NOT_MACHINE_TRUSTED"; out.win32_error = ERROR_ACCESS_DENIED; return out; }
    OwnerEnrollmentDurableRecord normalized;
    if (!normalize(candidate, &normalized)) { out.reason = "OWNER_STORE_CANDIDATE_INVALID"; out.win32_error = ERROR_INVALID_DATA; return out; }
    const std::string payload = serializeRecord(normalized);
    if (payload.empty() || payload.size() > kMaxBytes) { out.reason = "OWNER_STORE_SERIALIZATION_INVALID"; out.win32_error = ERROR_INVALID_DATA; return out; }

    const std::wstring final = recordPath();
    const auto before = classify(root_path_, final, &normalized);
    if (before.present || before.corrupt || before.win32_error != ERROR_SUCCESS) return before;

    PSECURITY_DESCRIPTOR raw = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(kStageDacl, SDDL_REVISION_1, &raw, nullptr)) {
        out.reason = "OWNER_STORE_STAGE_SECURITY_DESCRIPTOR_FAILED"; out.win32_error = GetLastError(); return out;
    }
    Local descriptor; descriptor.value = reinterpret_cast<HLOCAL>(raw);
    SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES), raw, FALSE};
    const std::wstring stage = stagePath(root_path_);
    if (stage.empty()) { out.reason = "OWNER_STORE_STAGE_PATH_FAILED"; out.win32_error = ERROR_INVALID_NAME; return out; }

    DWORD stageError = ERROR_SUCCESS;
    DWORD commitError = ERROR_SUCCESS;
    bool renameCommitted = false;
    {
        Handle h(CreateFileW(stage.c_str(), GENERIC_READ | GENERIC_WRITE | DELETE, 0, &security, CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, nullptr));
        if (!h.valid()) {
            out.reason = "OWNER_STORE_STAGE_CREATE_FAILED";
            out.win32_error = GetLastError();
            return out;
        }
        if (!writeAll(h.value, payload)) stageError = GetLastError();
        else if (!FlushFileBuffers(h.value)) stageError = GetLastError();
        else {
            out.staging_flushed = true;
            renameCommitted = renameIntoRootFailIfExists(h.value, rootGuard.value, kRecordName, &commitError);
            out.move_committed = renameCommitted;
        }
    }
    if (!out.staging_flushed) {
        DeleteFileW(stage.c_str());
        out.reason = "OWNER_STORE_STAGE_FLUSH_FAILED";
        out.win32_error = stageError == ERROR_SUCCESS ? ERROR_WRITE_FAULT : stageError;
        return out;
    }

    if (!renameCommitted) {
        DeleteFileW(stage.c_str());
        if (commitError == ERROR_ALREADY_EXISTS || commitError == ERROR_FILE_EXISTS) return classify(root_path_, final, &normalized);
        out.reason = "OWNER_STORE_COMMIT_RENAME_FAILED"; out.win32_error = commitError; return out;
    }

    auto readback = classify(root_path_, final, &normalized);
    readback.staging_flushed = out.staging_flushed;
    readback.move_committed = true;
    readback.post_commit_readback = readback.present && !readback.corrupt;
    readback.committed = readback.exact && readback.provenance_exact;
    if (!readback.committed) { readback.reason = "OWNER_STORE_POST_COMMIT_READBACK_MISMATCH"; return readback; }
    readback.reason = "OWNER_STORE_CREATE_IF_ABSENT_COMMITTED";
    return readback;
}

std::wstring browserGuardianOwnerEnrollmentStoreDefaultRoot() {
    const std::wstring pd = programData();
    return pd.empty() ? std::wstring{} : pd + L"\\" + kRelativeRoot;
}
const char* browserGuardianOwnerEnrollmentStoreContractJson() noexcept { return kContract; }

}  // namespace metaengine::guardian
