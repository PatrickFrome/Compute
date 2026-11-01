#include "browser-guardian-installed-namespace.hpp"
#include "browser-guardian-release-signature.hpp"

#include <aclapi.h>
#include <bcrypt.h>
#include <winioctl.h>

#include <algorithm>
#include <array>
#include <cstring>
#include <cwctype>
#include <set>
#include <string_view>
#include <utility>
#include <vector>

namespace metaengine::guardian {
namespace {

// Same inventory budgets as the existing W68 package producer.
constexpr std::size_t kMaxEntries = 100'000;
constexpr std::size_t kMaxDepth = 48;
constexpr std::uint64_t kMaxTotalBytes = 12ULL * 1024 * 1024 * 1024;
constexpr std::uint64_t kMaxFileBytes = kMaxTotalBytes;
constexpr DWORD kWriteRights = FILE_WRITE_DATA | FILE_APPEND_DATA | FILE_WRITE_EA |
    FILE_WRITE_ATTRIBUTES | FILE_DELETE_CHILD | DELETE | WRITE_DAC | WRITE_OWNER |
    GENERIC_WRITE | GENERIC_ALL;

struct Handle {
    HANDLE value = INVALID_HANDLE_VALUE;
    explicit Handle(HANDLE h = INVALID_HANDLE_VALUE) : value(h) {}
    ~Handle() { if (valid()) CloseHandle(value); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    Handle(Handle&& h) noexcept : value(std::exchange(h.value, INVALID_HANDLE_VALUE)) {}
    Handle& operator=(Handle&& h) noexcept {
        if (this != &h) { if (valid()) CloseHandle(value); value = std::exchange(h.value, INVALID_HANDLE_VALUE); }
        return *this;
    }
    bool valid() const noexcept { return value != nullptr && value != INVALID_HANDLE_VALUE; }
};

struct Hash {
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    std::vector<unsigned char> object;
    ~Hash() { if (hash) BCryptDestroyHash(hash); if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0); }
    bool start() {
        DWORD bytes = 0, written = 0;
        if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, MS_PRIMITIVE_PROVIDER, 0) < 0 ||
            BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&bytes), sizeof(bytes), &written, 0) < 0 ||
            written != sizeof(bytes) || bytes == 0) return false;
        object.resize(bytes);
        return BCryptCreateHash(algorithm, &hash, object.data(), bytes, nullptr, 0, 0) >= 0;
    }
    bool append(const void* data, std::size_t size) {
        if (size > MAXDWORD) return false;
        return BCryptHashData(hash, static_cast<PUCHAR>(const_cast<void*>(data)), static_cast<ULONG>(size), 0) >= 0;
    }
    std::string finish() {
        std::array<unsigned char, 32> digest{};
        if (BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0) < 0) return {};
        constexpr char hex[] = "0123456789abcdef";
        std::string out;
        for (auto byte : digest) { out.push_back(hex[byte >> 4]); out.push_back(hex[byte & 15]); }
        return out;
    }
};

struct ReadOplock {
    HANDLE file = INVALID_HANDLE_VALUE;  // Borrowed ORIGINAL file handle.
    Handle event;
    OVERLAPPED operation{};
    REQUEST_OPLOCK_INPUT_BUFFER input{};
    REQUEST_OPLOCK_OUTPUT_BUFFER output{};
    bool pending = false;

    explicit ReadOplock(HANDLE original) : file(original), event(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {}
    ~ReadOplock() {
        if (pending) {
            // The kernel may still own operation/output after CancelIoEx. Drain
            // completion BEFORE their storage, event or original handle dies.
            CancelIoEx(file, &operation);
            DWORD transferred = 0;
            GetOverlappedResult(file, &operation, &transferred, TRUE);
        }
    }
    bool acquire() {
        if (!event.valid()) return false;
        operation.hEvent = event.value;
        input.StructureVersion = REQUEST_OPLOCK_CURRENT_VERSION;
        input.StructureLength = static_cast<WORD>(sizeof(input));
        input.RequestedOplockLevel = OPLOCK_LEVEL_CACHE_READ;
        input.Flags = REQUEST_OPLOCK_INPUT_FLAG_REQUEST;
        DWORD transferred = 0;
        // Microsoft specifies STATUS_PENDING as the grant result. A completed
        // call/output buffer is never treated as an active retained oplock.
        const BOOL completed = DeviceIoControl(file, FSCTL_REQUEST_OPLOCK,
            &input, sizeof(input), &output, sizeof(output), &transferred, &operation);
        pending = !completed && GetLastError() == ERROR_IO_PENDING;
        return held();
    }
    bool held() const { return pending && WaitForSingleObject(event.value, 0) == WAIT_TIMEOUT; }
};

struct Entry {
    Handle handle;
    std::unique_ptr<ReadOplock> oplock;
    std::wstring path;
    std::wstring relative;
    FILE_ID_INFO identity{};
    bool directory = false;
    bool code_namespace = false;
    std::string digest;
    std::uint64_t size = 0;

    Entry() = default;
    Entry(Entry&&) noexcept = default;
    Entry& operator=(Entry&& other) noexcept {
        if (this != &other) {
            // Drain the previous request while its borrowed handle is valid.
            oplock.reset();
            handle = std::move(other.handle);
            oplock = std::move(other.oplock);
            path = std::move(other.path); relative = std::move(other.relative);
            identity = other.identity; directory = other.directory;
            code_namespace = other.code_namespace; digest = std::move(other.digest); size = other.size;
        }
        return *this;
    }
};

std::wstring lower(std::wstring text) {
    std::transform(text.begin(), text.end(), text.begin(), [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });
    return text;
}

std::wstring finalPath(HANDLE file) {
    const DWORD size = GetFinalPathNameByHandleW(file, nullptr, 0, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    if (size == 0) return {};
    std::wstring out(size, L'\0');
    const DWORD written = GetFinalPathNameByHandleW(file, out.data(), size, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    if (written == 0 || written >= size) return {};
    out.resize(written);
    if (out.starts_with(L"\\\\?\\")) out.erase(0, 4);
    return out;
}

bool localAbsolute(const std::wstring& path) {
    // No UNC, device path, alternate data stream, dot component or alias root.
    if (path.size() < 4 || path.size() > 2048 || path[1] != L':' || path[2] != L'\\' ||
        !((path[0] >= L'A' && path[0] <= L'Z') || (path[0] >= L'a' && path[0] <= L'z'))) return false;
    std::size_t start = 3;
    while (start < path.size()) {
        auto end = path.find(L'\\', start);
        if (end == std::wstring::npos) end = path.size();
        const auto part = std::wstring_view(path).substr(start, end - start);
        if (part.empty() || part == L"." || part == L".." || part.back() == L'.' || part.back() == L' ' ||
            part.find_first_of(L":/*?\"<>|") != std::wstring_view::npos || part.find(L'\0') != std::wstring_view::npos) return false;
        for (const wchar_t c : part) if (c < 0x20) return false;
        const auto device = lower(std::wstring(part.substr(0, part.find(L'.'))));
        if (device == L"con" || device == L"prn" || device == L"aux" || device == L"nul" ||
            (device.size() == 4 && (device.starts_with(L"com") || device.starts_with(L"lpt")) &&
                device[3] >= L'1' && device[3] <= L'9')) return false;
        start = end + 1;
    }
    return path.back() != L'\\';
}

bool machineSid(PSID sid) {
    if (!sid || !IsValidSid(sid)) return false;
    return IsWellKnownSid(sid, WinLocalSystemSid) || IsWellKnownSid(sid, WinBuiltinAdministratorsSid);
}

bool immutableCodeAcl(HANDLE file) {
    PSID owner = nullptr;
    PACL dacl = nullptr;
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    const DWORD result = GetSecurityInfo(file, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
        &owner, nullptr, &dacl, nullptr, &descriptor);
    const auto release = [&]() { if (descriptor) LocalFree(descriptor); };
    if (result != ERROR_SUCCESS || !descriptor || !machineSid(owner) || !dacl || !IsValidAcl(dacl)) { release(); return false; }
    ACL_SIZE_INFORMATION info{};
    if (!GetAclInformation(dacl, &info, sizeof(info), AclSizeInformation)) { release(); return false; }
    for (DWORD index = 0; index < info.AceCount; ++index) {
        void* raw = nullptr;
        if (!GetAce(dacl, index, &raw) || !raw) { release(); return false; }
        const auto* header = static_cast<const ACE_HEADER*>(raw);
        if (header->AceType == ACCESS_DENIED_ACE_TYPE) continue;
        // Object/callback/conditional ACEs cannot be simplified into a grant.
        if (header->AceType != ACCESS_ALLOWED_ACE_TYPE || header->AceSize < sizeof(ACCESS_ALLOWED_ACE)) { release(); return false; }
        const auto* ace = static_cast<const ACCESS_ALLOWED_ACE*>(raw);
        PSID sid = const_cast<DWORD*>(&ace->SidStart);
        if (!IsValidSid(sid)) { release(); return false; }
        // INHERIT_ONLY grants also matter: a later DLL/provider must not acquire
        // writable permissions through CREATOR OWNER or another inherited ACE.
        if ((ace->Mask & kWriteRights) != 0 && !machineSid(sid)) { release(); return false; }
    }
    release();
    return true;
}

bool metadataExact(const Entry& entry) {
    FILE_ATTRIBUTE_TAG_INFO tag{};
    BY_HANDLE_FILE_INFORMATION basic{};
    FILE_ID_INFO identity{};
    if ((!entry.directory && (!entry.oplock || !entry.oplock->held())) ||
        !GetFileInformationByHandleEx(entry.handle.value, FileAttributeTagInfo, &tag, sizeof(tag)) ||
        (tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ||
        ((tag.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) != entry.directory ||
        !GetFileInformationByHandle(entry.handle.value, &basic) || (!entry.directory && basic.nNumberOfLinks != 1) ||
        !GetFileInformationByHandleEx(entry.handle.value, FileIdInfo, &identity, sizeof(identity)) ||
        std::memcmp(&identity, &entry.identity, sizeof(identity)) != 0 ||
        lower(finalPath(entry.handle.value)) != lower(entry.path)) return false;
    if (entry.directory) {
        FILE_CASE_SENSITIVE_INFO caseInfo{};
        if (!GetFileInformationByHandleEx(entry.handle.value, FileCaseSensitiveInfo, &caseInfo, sizeof(caseInfo)) ||
            (caseInfo.Flags & FILE_CS_FLAG_CASE_SENSITIVE_DIR) != 0) return false;
    }
    return !entry.code_namespace || immutableCodeAcl(entry.handle.value);
}

bool readOriginalHandle(HANDLE file, HANDLE event, HANDLE stopEvent, std::uint64_t offset,
    void* buffer, DWORD bytes, DWORD* transferred) {
    OVERLAPPED operation{};
    operation.hEvent = event;
    operation.Offset = static_cast<DWORD>(offset);
    operation.OffsetHigh = static_cast<DWORD>(offset >> 32);
    if (!ResetEvent(event)) return false;
    if (!ReadFile(file, buffer, bytes, transferred, &operation)) {
        const DWORD error = GetLastError();
        if (error == ERROR_HANDLE_EOF) { *transferred = 0; return true; }
        if (error != ERROR_IO_PENDING) return false;
        HANDLE waits[] = {stopEvent, event};
        const DWORD wait = stopEvent ? WaitForMultipleObjects(2, waits, FALSE, INFINITE) : WaitForSingleObject(event, INFINITE);
        const DWORD completed = stopEvent ? WAIT_OBJECT_0 + 1 : WAIT_OBJECT_0;
        if (wait != completed) {
            CancelIoEx(file, &operation);
            DWORD ignored = 0;
            GetOverlappedResult(file, &operation, &ignored, TRUE);
            SetLastError(ERROR_OPERATION_ABORTED);
            return false;
        }
    }
    if (!GetOverlappedResult(file, &operation, transferred, FALSE)) {
        if (GetLastError() == ERROR_HANDLE_EOF) { *transferred = 0; return true; }
        return false;
    }
    return true;
}

bool hashOriginalHandle(Entry* entry, std::uint64_t* total, HANDLE stopEvent) {
    LARGE_INTEGER size{};
    if (!GetFileSizeEx(entry->handle.value, &size) || size.QuadPart < 0 ||
        static_cast<std::uint64_t>(size.QuadPart) > kMaxFileBytes ||
        *total > kMaxTotalBytes - static_cast<std::uint64_t>(size.QuadPart)) return false;
    Hash hash;
    if (!hash.start()) return false;
    Handle readEvent(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!readEvent.valid()) return false;
    std::array<unsigned char, 64 * 1024> buffer{};
    std::uint64_t seen = 0;
    for (;;) {
        if (stopEvent && WaitForSingleObject(stopEvent, 0) != WAIT_TIMEOUT) { SetLastError(ERROR_OPERATION_ABORTED); return false; }
        DWORD read = 0;
        if (!readOriginalHandle(entry->handle.value, readEvent.value, stopEvent, seen,
                buffer.data(), static_cast<DWORD>(buffer.size()), &read)) return false;
        if (read == 0) break;
        seen += read;
        if (seen > static_cast<std::uint64_t>(size.QuadPart) || !hash.append(buffer.data(), read)) return false;
    }
    if (seen != static_cast<std::uint64_t>(size.QuadPart)) return false;
    entry->digest = hash.finish();
    entry->size = seen;
    *total += seen;
    return entry->digest.size() == 64 && metadataExact(*entry);
}

bool openEntry(const std::wstring& path, const std::wstring& relative, bool directory, bool code, Entry* out) {
    Entry entry;
    entry.path = path; entry.relative = relative; entry.directory = directory; entry.code_namespace = code;
    // Refuse already-open write/delete handles as well as future ones. A read
    // oplock on this SAME file handle also rejects preexisting writable sections
    // that survive after their source file handle closes.
    const DWORD share = FILE_SHARE_READ;
    const std::wstring nativePath = L"\\\\?\\" + path;
    entry.handle = Handle(CreateFileW(nativePath.c_str(), (directory ? FILE_READ_ATTRIBUTES : GENERIC_READ) | READ_CONTROL,
        share, nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT |
            (directory ? FILE_FLAG_BACKUP_SEMANTICS : FILE_FLAG_OVERLAPPED), nullptr));
    if (!entry.handle.valid() || !GetFileInformationByHandleEx(entry.handle.value, FileIdInfo, &entry.identity, sizeof(entry.identity))) return false;
    if (!directory) {
        entry.oplock = std::make_unique<ReadOplock>(entry.handle.value);
        if (!entry.oplock->acquire()) return false;
    }
    if (!metadataExact(entry)) return false;
    *out = std::move(entry);
    return true;
}

bool names(const std::wstring& directory, std::vector<std::pair<std::wstring, bool>>* out) {
    WIN32_FIND_DATAW data{};
    HANDLE search = FindFirstFileW((L"\\\\?\\" + directory + L"\\*").c_str(), &data);
    if (search == INVALID_HANDLE_VALUE) return GetLastError() == ERROR_FILE_NOT_FOUND;
    bool ok = true;
    do {
        const std::wstring name(data.cFileName);
        if (name == L"." || name == L"..") continue;
        if (out->size() >= kMaxEntries || (data.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ||
            !localAbsolute(directory + L"\\" + name)) { ok = false; break; }
        out->emplace_back(name, (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0);
    } while (FindNextFileW(search, &data));
    const DWORD error = GetLastError();
    FindClose(search);
    if (!ok || error != ERROR_NO_MORE_FILES) return false;
    std::sort(out->begin(), out->end());
    return true;
}

}  // namespace

struct GuardianInstalledNamespace::State {
    std::vector<Entry> entries;
    std::vector<std::pair<std::wstring, std::vector<std::pair<std::wstring, bool>>>> directories;
    std::string reason = "INSTALLED_NAMESPACE_NOT_CAPTURED";
    DWORD error = ERROR_SUCCESS;
    std::string executable_digest;
    std::wstring executable_relative;
    std::string namespace_digest;
    std::size_t file_count = 0;
    std::uint64_t total_bytes = 0;
    HANDLE stop_event = nullptr;
    std::unique_ptr<const VerifiedReleaseSignatureV2> signed_release;
    std::string authenticity_reason = "RELEASE_SIGNATURE_NOT_BOUND";

    bool fail(const char* text) { reason = text; error = GetLastError(); if (error == ERROR_SUCCESS) error = ERROR_INVALID_DATA; return false; }
    bool walk(const std::wstring& root, const std::wstring& relative, std::size_t depth) {
        if (stop_event && WaitForSingleObject(stop_event, 0) != WAIT_TIMEOUT) { SetLastError(ERROR_OPERATION_ABORTED); return fail("INSTALLED_NAMESPACE_CANCELLED"); }
        if (depth > kMaxDepth || entries.size() >= kMaxEntries) return fail("INSTALLED_NAMESPACE_BUDGET_EXCEEDED");
        const std::wstring directory = relative.empty() ? root : root + L"\\" + relative;
        std::vector<std::pair<std::wstring, bool>> children;
        if (!names(directory, &children)) return fail("INSTALLED_NAMESPACE_ENUMERATION_FAILED");
        directories.emplace_back(directory, children);
        for (const auto& child : children) {
            if (entries.size() >= kMaxEntries) return fail("INSTALLED_NAMESPACE_BUDGET_EXCEEDED");
            const std::wstring name = relative.empty() ? child.first : relative + L"\\" + child.first;
            Entry entry;
            if (!openEntry(root + L"\\" + name, name, child.second, true, &entry)) return fail("INSTALLED_NAMESPACE_ENTRY_UNTRUSTED");
            if (!child.second && !hashOriginalHandle(&entry, &total_bytes, stop_event)) return fail("INSTALLED_NAMESPACE_HANDLE_HASH_FAILED");
            entries.push_back(std::move(entry));
            if (child.second) { if (!walk(root, name, depth + 1)) return false; }
            else ++file_count;
        }
        return true;
    }

    const Entry* find(const std::wstring& relative) const {
        for (const auto& entry : entries) if (entry.code_namespace && entry.relative == relative) return &entry;
        return nullptr;
    }

    bool readRetained(const std::wstring& relative, std::size_t limit, std::string* bytes) const {
        const auto* entry = find(relative);
        if (!entry || entry->directory || entry->size > limit || !metadataExact(*entry)) return false;
        Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
        if (!event.valid()) return false;
        bytes->assign(static_cast<std::size_t>(entry->size), '\0');
        std::size_t offset = 0;
        while (offset < bytes->size()) {
            DWORD read = 0;
            const auto count = static_cast<DWORD>(std::min<std::size_t>(64 * 1024, bytes->size() - offset));
            if (!readOriginalHandle(entry->handle.value, event.value, stop_event, offset,
                    bytes->data() + offset, count, &read) || read == 0) return false;
            offset += read;
        }
        Hash hash;
        return hash.start() && hash.append(bytes->data(), bytes->size()) && hash.finish() == entry->digest && metadataExact(*entry);
    }

    bool packageBytes(const ReleaseManifestV2& manifest, std::string* out) const {
        constexpr std::array<std::wstring_view, 5> excluded = {
            L"metaengine-installed-release-proof.v2.json", L"installer-slsa-provenance.bundle.json",
            L"browser-package-slsa-provenance-evidence.json", L"metaengine-installed-package-code.v1.json",
            L"Uninstall METAENGINE Browser Test.exe"};
        std::vector<const Entry*> code;
        std::set<std::wstring> foldedNames;
        for (const auto& entry : entries) {
            if (!entry.code_namespace || entry.relative.empty()) continue;
            // The publisher uses ECMAScript Unicode toLowerCase, which is not
            // Windows/C-locale folding. Until an exact native Unicode parity
            // producer exists, signature binding of non-ASCII code names is
            // explicitly refused; observation custody itself still supports it.
            for (const wchar_t c : entry.relative) if (c > 0x7f) return false;
            if (!foldedNames.insert(lower(entry.relative)).second) return false;
            bool exclude = false;
            for (const auto name : excluded) {
                if (lower(entry.relative) != lower(std::wstring(name))) continue;
                if (entry.relative != name || entry.directory) return false;
                exclude = true;
            }
            if (exclude) continue;
            const auto folded = lower(entry.relative);
            if (folded == L"resources\\app" || folded.starts_with(L"resources\\app\\")) return false;
            code.push_back(&entry);
        }
        const auto normalized = [](std::wstring name) { std::replace(name.begin(), name.end(), L'\\', L'/'); return name; };
        std::sort(code.begin(), code.end(), [&](const Entry* left, const Entry* right) {
            return normalized(left->relative) < normalized(right->relative);
        });
        const std::wstring exeName(manifest.exe_name.begin(), manifest.exe_name.end());
        if (exeName != executable_relative) return false;
        const auto* exe = find(exeName);
        const auto* resources = find(L"resources");
        const auto* asar = find(L"resources\\app.asar");
        if (!exe || exe->directory || exe->size == 0 || exe->digest != manifest.exe_sha256 ||
            !resources || !resources->directory || !asar || asar->directory || asar->size == 0) return false;
        *out = "{\"schema\":\"metaengine.browser.installed-package-code.v1\",\"source_sha\":\"" + manifest.source_sha +
            "\",\"package_version\":\"" + manifest.package_version + "\",\"exe_name\":\"" + manifest.exe_name + "\",\"entries\":[";
        bool first = true;
        for (const auto* entry : code) {
            const auto name = normalized(entry->relative);
            const int count = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, name.data(), static_cast<int>(name.size()),
                nullptr, 0, nullptr, nullptr);
            if (count <= 0) return false;
            std::string utf8(static_cast<std::size_t>(count), '\0');
            if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, name.data(), static_cast<int>(name.size()),
                    utf8.data(), count, nullptr, nullptr) != count || utf8.find_first_of("\"\\") != std::string::npos) return false;
            for (const unsigned char c : utf8) if (c < 0x20) return false;
            if (!first) out->push_back(',');
            first = false;
            *out += "{\"path\":\"" + utf8 + "\",\"kind\":\"" + (entry->directory ? "directory" : "file") + "\"";
            if (!entry->directory) *out += ",\"size\":" + std::to_string(entry->size) + ",\"sha256\":\"" + entry->digest + "\"";
            *out += "}";
            if (out->size() > 32 * 1024 * 1024) return false;
        }
        *out += "]}\n";
        return true;
    }
};

GuardianInstalledNamespace::GuardianInstalledNamespace() : state_(std::make_unique<State>()) {}
GuardianInstalledNamespace::~GuardianInstalledNamespace() = default;

std::unique_ptr<GuardianInstalledNamespace> GuardianInstalledNamespace::capture(const std::wstring& executable, HANDLE stopEvent) {
    auto out = std::unique_ptr<GuardianInstalledNamespace>(new GuardianInstalledNamespace());
    out->state_->stop_event = stopEvent;
    if (!localAbsolute(executable)) { out->state_->fail("INSTALLED_NAMESPACE_PATH_INVALID"); return out; }
    const auto split = executable.find_last_of(L'\\');
    if (split <= 2) { out->state_->fail("INSTALLED_NAMESPACE_ROOT_INVALID"); return out; }
    const auto root = executable.substr(0, split);
    out->state_->executable_relative = executable.substr(split + 1);
    // Pin every component from the drive root before opening its descendant.
    for (std::size_t end = 3;;) {
        const std::wstring component = root.substr(0, end);
        Entry entry;
        if (!openEntry(component, {}, true, end == root.size(), &entry)) {
            out->state_->fail(end == root.size() ? "INSTALLED_NAMESPACE_WRITABLE_OR_UNTRUSTED" : "INSTALLED_NAMESPACE_ANCESTOR_UNTRUSTED");
            return out;
        }
        out->state_->entries.push_back(std::move(entry));
        if (end == root.size()) break;
        const auto next = root.find(L'\\', end + 1);
        end = next == std::wstring::npos ? root.size() : next;
    }
    if (!out->state_->walk(root, {}, 0)) return out;
    Hash hash;
    if (!hash.start()) { out->state_->fail("INSTALLED_NAMESPACE_DIGEST_FAILED"); return out; }
    for (const auto& entry : out->state_->entries) {
        if (!entry.code_namespace || entry.relative.empty()) continue;
        // UTF-16 length framed name + type + digest: no locale conversion or
        // JSON canonicalization can alias two different retained files.
        const auto size = static_cast<std::uint32_t>(entry.relative.size());
        const unsigned char type = entry.directory ? 1 : 0;
        if (!hash.append(&size, sizeof(size)) || !hash.append(entry.relative.data(), entry.relative.size() * sizeof(wchar_t)) ||
            !hash.append(&type, sizeof(type)) || !hash.append(entry.digest.data(), entry.digest.size())) {
            out->state_->fail("INSTALLED_NAMESPACE_DIGEST_FAILED"); return out;
        }
        if (!entry.directory && lower(entry.path) == lower(executable)) out->state_->executable_digest = entry.digest;
    }
    out->state_->namespace_digest = hash.finish();
    if (out->state_->executable_digest.size() != 64 || out->state_->namespace_digest.size() != 64) {
        out->state_->fail("INSTALLED_EXECUTABLE_NOT_IN_NAMESPACE"); return out;
    }
    out->state_->reason = "INSTALLED_NAMESPACE_HANDLES_RETAINED";
    out->state_->error = ERROR_SUCCESS;
    return out;
}

bool GuardianInstalledNamespace::recheck() {
    if (state_->reason != "INSTALLED_NAMESPACE_HANDLES_RETAINED") return false;
    std::uint64_t total = 0;
    for (auto& entry : state_->entries) {
        if (!metadataExact(entry)) return state_->fail("INSTALLED_NAMESPACE_HANDLE_DRIFT");
        if (!entry.directory) {
            const auto expected = entry.digest;
            if (!hashOriginalHandle(&entry, &total, state_->stop_event) || entry.digest != expected) return state_->fail("INSTALLED_NAMESPACE_CONTENT_DRIFT");
        }
    }
    for (const auto& directory : state_->directories) {
        std::vector<std::pair<std::wstring, bool>> current;
        if (!names(directory.first, &current) || current != directory.second) return state_->fail("INSTALLED_NAMESPACE_MEMBERSHIP_DRIFT");
    }
    return true;
}

bool GuardianInstalledNamespace::bindRetainedReleaseSignature() {
    state_->signed_release.reset();
#if !defined(METAENGINE_GUARDIAN_RELEASE_SIGNATURE_LINKED)
    // Crypto/build owns this compile/link dependency. No DLL discovery, runtime
    // provider injection, caller callback or alternate verification root.
    state_->authenticity_reason = "RELEASE_SIGNATURE_BUILD_UNAVAILABLE";
    return false;
#else
    if (!recheck()) { state_->authenticity_reason = "RELEASE_CUSTODY_INVALID"; return false; }
    std::string envelope;
    if (!state_->readRetained(L"metaengine-installed-release-proof.v2.json", 4096, &envelope)) {
        state_->authenticity_reason = "RELEASE_ENVELOPE_NOT_RETAINED"; return false;
    }
    constexpr std::string_view prefix = "{\"schema\":\"metaengine.browser.installed-release-envelope.v2\",\"manifest\":";
    constexpr std::string_view separator = ",\"signature_base64\":\"";
    const auto split = envelope.rfind(separator);
    if (!envelope.starts_with(prefix) || !envelope.ends_with("\"}") || split == std::string::npos ||
        split < prefix.size() || envelope.size() != split + separator.size() + 88 + 2) {
        state_->authenticity_reason = "RELEASE_ENVELOPE_NONCANONICAL"; return false;
    }
    const auto canonical = std::string_view(envelope).substr(prefix.size(), split - prefix.size());
    const auto encoded = std::string_view(envelope).substr(split + separator.size(), 88);
    std::array<std::uint8_t, 64> signature{};
    constexpr std::string_view alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    unsigned bits = 0, accumulator = 0;
    std::size_t emitted = 0;
    if (!encoded.ends_with("==")) { state_->authenticity_reason = "RELEASE_SIGNATURE_ENCODING_INVALID"; return false; }
    for (const char c : encoded.substr(0, 86)) {
        const auto digit = alphabet.find(c);
        if (digit == std::string_view::npos) { state_->authenticity_reason = "RELEASE_SIGNATURE_ENCODING_INVALID"; return false; }
        accumulator = (accumulator << 6) | static_cast<unsigned>(digit); bits += 6;
        if (bits >= 8) { bits -= 8; signature[emitted++] = static_cast<std::uint8_t>(accumulator >> bits); }
    }
    if (emitted != signature.size() || bits != 4 || (accumulator & 15U) != 0) {
        state_->authenticity_reason = "RELEASE_SIGNATURE_ENCODING_INVALID"; return false;
    }
    auto verified = verifyGuardianReleaseSignatureV2(canonical, signature);
    if (!verified) { state_->authenticity_reason = "RELEASE_SIGNATURE_INVALID"; return false; }
    const auto& manifest = verified->manifest();
    std::string expected, observed;
    const auto* bundle = state_->find(L"installer-slsa-provenance.bundle.json");
    const auto* evidence = state_->find(L"browser-package-slsa-provenance-evidence.json");
    const auto* package = state_->find(L"metaengine-installed-package-code.v1.json");
    if (manifest.exe_sha256 != state_->executable_digest || !bundle || bundle->directory || bundle->digest != manifest.slsa_bundle_sha256 ||
        !evidence || evidence->directory || evidence->digest != manifest.slsa_evidence_sha256 ||
        !package || package->directory || package->digest != manifest.package_code_sha256 ||
        !serializeRetainedPackage(manifest, &expected) || !state_->readRetained(package->relative, 32 * 1024 * 1024, &observed) ||
        expected != observed || !recheck()) {
        state_->authenticity_reason = "RELEASE_RETAINED_PACKAGE_MISMATCH"; return false;
    }
    state_->signed_release = std::move(verified);
    state_->authenticity_reason = "RELEASE_SIGNATURE_BOUND_FRESHNESS_AND_AUTHENTICODE_UNQUALIFIED";
    return true;
#endif
}

const std::string& GuardianInstalledNamespace::reason() const noexcept { return state_->reason; }
DWORD GuardianInstalledNamespace::error() const noexcept { return state_->error; }
const std::string& GuardianInstalledNamespace::executableSha256() const noexcept { return state_->executable_digest; }
const std::string& GuardianInstalledNamespace::namespaceSha256() const noexcept { return state_->namespace_digest; }
std::size_t GuardianInstalledNamespace::fileCount() const noexcept { return state_->file_count; }
bool GuardianInstalledNamespace::serializeRetainedPackage(const ReleaseManifestV2& manifest, std::string* bytes) const {
    return bytes && state_->reason == "INSTALLED_NAMESPACE_HANDLES_RETAINED" && state_->packageBytes(manifest, bytes);
}
bool GuardianInstalledNamespace::releaseSignatureBound() const noexcept {
    return state_->reason == "INSTALLED_NAMESPACE_HANDLES_RETAINED" && state_->signed_release != nullptr;
}
const std::string& GuardianInstalledNamespace::authenticityReason() const noexcept { return state_->authenticity_reason; }
bool GuardianInstalledNamespace::readRetainedBytes(const std::wstring& relative, std::size_t limit, std::string* bytes) const {
    return bytes && state_->reason == "INSTALLED_NAMESPACE_HANDLES_RETAINED" && state_->readRetained(relative, limit, bytes);
}
std::string GuardianInstalledNamespace::retainedFileSha256(const std::wstring& relative) const {
    const auto* entry = state_->find(relative);
    return state_->reason == "INSTALLED_NAMESPACE_HANDLES_RETAINED" && entry && !entry->directory ? entry->digest : std::string{};
}
const ReleaseManifestV2* GuardianInstalledNamespace::boundReleaseManifest() const noexcept {
    return releaseSignatureBound() ? &state_->signed_release->manifest() : nullptr;
}

}  // namespace metaengine::guardian
