#include "browser-guardian-owner-enrollment-store.hpp"

#include <windows.h>

#include <iostream>
#include <string>
#include <string_view>

namespace {

std::string ascii(const std::wstring& value) {
    std::string out;
    out.reserve(value.size());
    for (const wchar_t ch : value) {
        if (ch < 0x20 || ch > 0x7e) return {};
        out.push_back(static_cast<char>(ch));
    }
    return out;
}

std::string jsonEscape(std::string_view value) {
    std::string out;
    out.reserve(value.size() + 8);
    for (const char ch : value) {
        switch (ch) {
            case '\\': out += "\\\\"; break;
            case '"': out += "\\\""; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default: out.push_back(ch); break;
        }
    }
    return out;
}

void emit(const metaengine::guardian::OwnerEnrollmentStoreResult& result) {
    const std::string sid = ascii(result.record.expected_owner_sid);
    std::cout
        << "{\"present\":" << (result.present ? "true" : "false")
        << ",\"committed\":" << (result.committed ? "true" : "false")
        << ",\"exact\":" << (result.exact ? "true" : "false")
        << ",\"provenance_exact\":" << (result.provenance_exact ? "true" : "false")
        << ",\"owner_mismatch\":" << (result.owner_mismatch ? "true" : "false")
        << ",\"corrupt\":" << (result.corrupt ? "true" : "false")
        << ",\"root_trusted\":" << (result.root_trusted ? "true" : "false")
        << ",\"staging_flushed\":" << (result.staging_flushed ? "true" : "false")
        << ",\"move_committed\":" << (result.move_committed ? "true" : "false")
        << ",\"post_commit_readback\":" << (result.post_commit_readback ? "true" : "false")
        << ",\"win32_error\":" << result.win32_error
        << ",\"reason\":\"" << jsonEscape(result.reason) << "\""
        << ",\"record\":{\"expected_owner_sid\":\"" << jsonEscape(sid)
        << "\",\"enrollment_evidence_sha256\":\"" << jsonEscape(result.record.enrollment_evidence_sha256)
        << "\",\"device_key_fingerprint_sha256\":\"" << jsonEscape(result.record.device_key_fingerprint_sha256)
        << "\"}}\n";
}

std::string narrowAscii(const wchar_t* value) {
    if (value == nullptr) return {};
    return ascii(value);
}

int proveAncestorRenameFence() {
    using metaengine::guardian::browserGuardianOwnerEnrollmentStoreDefaultRoot;

    const std::wstring root = browserGuardianOwnerEnrollmentStoreDefaultRoot();
    const std::size_t slash = root.find_last_of(L"\\/");
    if (slash == std::wstring::npos || slash == 0) {
        std::cerr << "ancestor_fence_parent_invalid\n";
        return 70;
    }
    const std::wstring parent = root.substr(0, slash);
    const std::wstring alternate = parent + L".owner-store-fence-" + std::to_wstring(GetCurrentProcessId());
    if (GetFileAttributesW(alternate.c_str()) != INVALID_FILE_ATTRIBUTES) {
        std::cerr << "ancestor_fence_alternate_exists\n";
        return 71;
    }

    HANDLE rootHandle = CreateFileW(
        root.c_str(),
        FILE_READ_ATTRIBUTES | READ_CONTROL | FILE_ADD_FILE,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        nullptr,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
        nullptr);
    if (rootHandle == INVALID_HANDLE_VALUE) {
        std::cerr << "ancestor_fence_root_open_failed:" << GetLastError() << '\n';
        return 72;
    }

    if (MoveFileExW(parent.c_str(), alternate.c_str(), MOVEFILE_WRITE_THROUGH)) {
        CloseHandle(rootHandle);
        const BOOL restored = MoveFileExW(alternate.c_str(), parent.c_str(), MOVEFILE_WRITE_THROUGH);
        std::cout << "{\"blocked\":false,\"unexpected_rename_succeeded\":true,\"restored\":"
                  << (restored ? "true" : "false")
                  << ",\"classification\":\"ANCESTOR_RENAME_UNEXPECTEDLY_SUCCEEDED\"}\n";
        return restored ? 73 : 74;
    }

    const DWORD error = GetLastError();
    CloseHandle(rootHandle);

    // MS-FSA specifies STATUS_ACCESS_DENIED when a directory rename discovers
    // open descendants. Related Win32 share-mode implementations may surface a
    // sharing violation instead. Accept only those two documented fence classes;
    // an arbitrary rename failure is not proof of the production invariant.
    const bool descendantFence = error == ERROR_ACCESS_DENIED || error == ERROR_SHARING_VIOLATION;
    std::cout << "{\"blocked\":" << (descendantFence ? "true" : "false")
              << ",\"win32_error\":" << error
              << ",\"classification\":\""
              << (descendantFence ? "OPEN_DESCENDANT_RENAME_FENCE" : "UNEXPECTED_RENAME_FAILURE")
              << "\"}\n";
    return descendantFence ? 0 : 75;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
    using metaengine::guardian::OwnerEnrollmentDurableRecord;
    using metaengine::guardian::OwnerEnrollmentStore;
    using metaengine::guardian::browserGuardianOwnerEnrollmentStoreDefaultRoot;

    if (argc < 2) {
        std::cerr << "usage: probe read | probe create <sid> <evidence_sha256> <device_sha256> | probe fence-parent-rename\n";
        return 64;
    }

    const std::wstring command = argv[1];
    if (command == L"fence-parent-rename") {
        if (argc != 2) return 64;
        return proveAncestorRenameFence();
    }

    OwnerEnrollmentStore store(browserGuardianOwnerEnrollmentStoreDefaultRoot());
    if (command == L"read") {
        if (argc != 2) return 64;
        emit(store.read());
        return 0;
    }

    if (command == L"create") {
        if (argc != 5) return 64;
        const std::string evidence = narrowAscii(argv[3]);
        const std::string device = narrowAscii(argv[4]);
        if (evidence.empty() || device.empty()) return 65;
        OwnerEnrollmentDurableRecord candidate{argv[2], evidence, device};
        emit(store.createIfAbsent(candidate));
        return 0;
    }

    std::cerr << "unknown command\n";
    return 64;
}
