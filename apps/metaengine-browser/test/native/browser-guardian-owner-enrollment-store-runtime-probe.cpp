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

}  // namespace

int wmain(int argc, wchar_t** argv) {
    using metaengine::guardian::OwnerEnrollmentDurableRecord;
    using metaengine::guardian::OwnerEnrollmentStore;
    using metaengine::guardian::browserGuardianOwnerEnrollmentStoreDefaultRoot;

    if (argc < 2) {
        std::cerr << "usage: probe read | probe create <sid> <evidence_sha256> <device_sha256>\n";
        return 64;
    }

    OwnerEnrollmentStore store(browserGuardianOwnerEnrollmentStoreDefaultRoot());
    const std::wstring command = argv[1];
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
