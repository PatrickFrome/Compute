#ifndef METAENGINE_GUARDIAN_NAMESPACE_TEST
#error This mechanical probe requires the test-only private capture friend.
#endif

#include "browser-guardian-installed-namespace.hpp"
#include "browser-guardian-release-signature.hpp"


#include <aclapi.h>
#include <bcrypt.h>
#include <sddl.h>

#include <array>
#include <functional>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace metaengine::guardian {
struct GuardianInstalledNamespaceTest {
    static std::unique_ptr<GuardianInstalledNamespace> capture(const std::wstring& path, HANDLE stop_event = nullptr) {
        return GuardianInstalledNamespace::capture(path, stop_event);
    }
    static bool serializeRetainedPackage(const GuardianInstalledNamespace& held,
        const ReleaseManifestV2& manifest, std::string* bytes) {
        return held.serializeRetainedPackage(manifest, bytes);
    }
    static bool bindRetainedReleaseSignature(GuardianInstalledNamespace& held) {
        return held.bindRetainedReleaseSignature();
    }
};
}  // namespace metaengine::guardian

namespace {

using metaengine::guardian::GuardianInstalledNamespace;
using metaengine::guardian::GuardianInstalledNamespaceTest;
constexpr wchar_t kSecureAcl[] = L"O:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)";
constexpr wchar_t kWritableAcl[] = L"O:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FW;;;AU)";
constexpr char kExecutableBytes[] = "guardian namespace exe fixture\n";
constexpr char kPackageBytes[] = "guardian namespace package fixture\n";
constexpr DWORD kShareAll = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;

struct Handle {
    HANDLE value = INVALID_HANDLE_VALUE;
    explicit Handle(HANDLE handle = INVALID_HANDLE_VALUE) : value(handle) {}
    ~Handle() { reset(); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    void reset() {
        if (value != nullptr && value != INVALID_HANDLE_VALUE) CloseHandle(value);
        value = INVALID_HANDLE_VALUE;
    }
    bool valid() const { return value != nullptr && value != INVALID_HANDLE_VALUE; }
};

class Failure final : public std::runtime_error {
public:
    explicit Failure(const std::string& message, DWORD error = ERROR_SUCCESS)
        : std::runtime_error(message), error_(error) {}
    DWORD error() const { return error_; }
private:
    DWORD error_;
};

class Unsupported final : public std::runtime_error {
public:
    explicit Unsupported(const std::string& message, DWORD error)
        : std::runtime_error(message), error_(error) {}
    DWORD error() const { return error_; }
private:
    DWORD error_;
};

void require(bool value, const std::string& message) {
    if (!value) throw Failure(message, GetLastError());
}

std::string escape(std::string_view text) {
    std::string result;
    for (const char c : text) {
        if (c == '\\' || c == '"') result.push_back('\\');
        if (c == '\n') result += "\\n";
        else if (c == '\r') result += "\\r";
        else result.push_back(c);
    }
    return result;
}

void applyAcl(const std::wstring& path, bool writable = false) {
    PSECURITY_DESCRIPTOR raw = nullptr;
    require(ConvertStringSecurityDescriptorToSecurityDescriptorW(writable ? kWritableAcl : kSecureAcl,
        SDDL_REVISION_1, &raw, nullptr) != FALSE, "fixture_descriptor_failed");
    PSID owner = nullptr;
    PACL dacl = nullptr;
    BOOL present = FALSE, defaulted = FALSE;
    const bool parsed = GetSecurityDescriptorOwner(raw, &owner, &defaulted) != FALSE &&
        GetSecurityDescriptorDacl(raw, &present, &dacl, &defaulted) != FALSE && present && dacl;
    DWORD result = parsed ? SetNamedSecurityInfoW(const_cast<LPWSTR>(path.c_str()), SE_FILE_OBJECT,
        OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
        owner, nullptr, dacl, nullptr) : ERROR_INVALID_SECURITY_DESCR;
    LocalFree(raw);
    if (result != ERROR_SUCCESS) throw Failure("fixture_machine_owner_acl_failed", result);
}

bool removeTree(const std::wstring& path) {
    const DWORD attributes = GetFileAttributesW(path.c_str());
    if (attributes == INVALID_FILE_ATTRIBUTES) return GetLastError() == ERROR_FILE_NOT_FOUND || GetLastError() == ERROR_PATH_NOT_FOUND;
    if ((attributes & FILE_ATTRIBUTE_DIRECTORY) == 0) return DeleteFileW(path.c_str()) != FALSE;
    if ((attributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0) {
        WIN32_FIND_DATAW data{};
        HANDLE search = FindFirstFileW((path + L"\\*").c_str(), &data);
        if (search != INVALID_HANDLE_VALUE) {
            bool removed = true;
            do {
                const std::wstring name(data.cFileName);
                if (name != L"." && name != L".." && !removeTree(path + L"\\" + name)) removed = false;
            } while (FindNextFileW(search, &data));
            const DWORD error = GetLastError();
            FindClose(search);
            if (!removed || error != ERROR_NO_MORE_FILES) return false;
        } else if (GetLastError() != ERROR_FILE_NOT_FOUND) return false;
    }
    return RemoveDirectoryW(path.c_str()) != FALSE;
}

std::wstring canonicalFixturePath(const std::wstring& path) {
    // TEMP may contain RUNNER~1 or another short alias; the production capture
    // correctly rejects aliases, so obtain the actual created directory name.
    Handle handle(CreateFileW(path.c_str(), FILE_READ_ATTRIBUTES, kShareAll, nullptr, OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    require(handle.valid(), "fixture_canonical_path_open_failed");
    const DWORD size = GetFinalPathNameByHandleW(handle.value, nullptr, 0, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    require(size != 0, "fixture_canonical_path_size_failed");
    std::wstring result(size, L'\0');
    const DWORD written = GetFinalPathNameByHandleW(handle.value, result.data(), size, FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    require(written != 0 && written < size, "fixture_canonical_path_failed");
    result.resize(written);
    if (result.starts_with(L"\\\\?\\")) result.erase(0, 4);
    require(result.size() > 3 && result[1] == L':' && result[2] == L'\\', "fixture_local_drive_path_required");
    return result;
}

struct Fixture {
    std::wstring outer;
    std::wstring root;
    std::wstring executable;
    ~Fixture() { if (!outer.empty()) removeTree(outer); }

    void file(const std::wstring& path, std::string_view contents) {
        Handle output(CreateFileW(path.c_str(), GENERIC_WRITE, kShareAll, nullptr, CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL, nullptr));
        require(output.valid(), "fixture_file_create_failed");
        DWORD written = 0;
        if (!contents.empty()) require(WriteFile(output.value, contents.data(), static_cast<DWORD>(contents.size()), &written, nullptr) != FALSE &&
            written == contents.size(), "fixture_file_write_failed");
        output.reset();
        applyAcl(path);
    }

    void create() {
        std::array<wchar_t, MAX_PATH> temporary{}, unique{};
        const DWORD length = GetTempPathW(static_cast<DWORD>(temporary.size()), temporary.data());
        require(length != 0 && length < temporary.size(), "fixture_temp_path_failed");
        require(GetTempFileNameW(temporary.data(), L"gns", 0, unique.data()) != 0, "fixture_unique_path_failed");
        outer = unique.data();
        require(DeleteFileW(outer.c_str()) != FALSE, "fixture_placeholder_delete_failed");
        require(CreateDirectoryW(outer.c_str(), nullptr) != FALSE, "fixture_outer_create_failed");
        outer = canonicalFixturePath(outer);
        applyAcl(outer);
        root = outer + L"\\installed";
        require(CreateDirectoryW(root.c_str(), nullptr) != FALSE, "fixture_root_create_failed");
        applyAcl(root);
        executable = root + L"\\METAENGINE Browser Test.exe";
        file(executable, kExecutableBytes);
        file(root + L"\\empty.bin", {});
        require(CreateDirectoryW((root + L"\\resources").c_str(), nullptr) != FALSE, "fixture_resources_create_failed");
        applyAcl(root + L"\\resources");
        file(root + L"\\resources\\app.asar", kPackageBytes);
    }

    void cleanup() {
        require(removeTree(outer), "fixture_cleanup_unconfirmed");
        outer.clear();
    }
};

std::string bytesSha256(std::string_view bytes) {
    require(bytes.size() <= MAXDWORD, "oracle_hash_input_too_large");
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    require(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, MS_PRIMITIVE_PROVIDER, 0) >= 0,
        "oracle_hash_provider_failed");
    std::array<unsigned char, 32> output{};
    const auto status = BCryptHash(algorithm, nullptr, 0,
        reinterpret_cast<PUCHAR>(const_cast<char*>(bytes.data())), static_cast<ULONG>(bytes.size()),
        output.data(), static_cast<ULONG>(output.size()));
    BCryptCloseAlgorithmProvider(algorithm, 0);
    require(status >= 0, "oracle_hash_failed");
    constexpr char digits[] = "0123456789abcdef";
    std::string result;
    for (const auto byte : output) { result.push_back(digits[byte >> 4]); result.push_back(digits[byte & 15]); }
    return result;
}

std::string diskSha256(const std::wstring& path) {
    // Independent pathname read is an oracle only in this disposable fixture;
    // production must continue hashing its original retained file handle.
    Handle input(CreateFileW(path.c_str(), GENERIC_READ, kShareAll, nullptr, OPEN_EXISTING,
        FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    require(input.valid(), "oracle_file_open_failed");
    std::array<unsigned char, 4096> bytes{};
    DWORD count = 0;
    require(ReadFile(input.value, bytes.data(), static_cast<DWORD>(bytes.size()), &count, nullptr) != FALSE &&
        count < bytes.size(), "oracle_read_failed");
    return bytesSha256(std::string_view(reinterpret_cast<const char*>(bytes.data()), count));
}

std::unique_ptr<GuardianInstalledNamespace> captured(Fixture& fixture) {
    auto result = GuardianInstalledNamespaceTest::capture(fixture.executable);
    require(result && result->recheck(), "positive_capture_failed:" + (result ? result->reason() : "null"));
    return result;
}

void rejected(Fixture& fixture, std::string_view reason) {
    auto result = GuardianInstalledNamespaceTest::capture(fixture.executable);
    require(result && !result->recheck(), "unsafe_namespace_capture_accepted");
    require(result->reason() == reason, "negative_reason_mismatch:" + result->reason());
}

void sharingFailure(BOOL succeeded, const char* name) {
    const DWORD error = GetLastError();
    if (succeeded) throw Failure(std::string(name) + "_unexpectedly_succeeded");
    require(error == ERROR_SHARING_VIOLATION || error == ERROR_ACCESS_DENIED,
        std::string(name) + "_unexpected_failure_class");
}

unsigned passed = 0, failed = 0, skipped = 0;

void run(const char* name, const std::function<void(Fixture&)>& body) {
    Fixture fixture;
    try {
        fixture.create();
        body(fixture);
        fixture.cleanup();
        ++passed;
        std::cout << "{\"name\":\"" << name << "\",\"state\":\"PASS\"}\n";
    } catch (const Unsupported& error) {
        try { fixture.cleanup(); }
        catch (const Failure& cleanup) {
            ++failed;
            std::cout << "{\"name\":\"" << name << "\",\"state\":\"FAIL\",\"reason\":\""
                << escape(cleanup.what()) << "\",\"win32_error\":" << cleanup.error() << "}\n";
            return;
        }
        ++skipped;
        std::cout << "{\"name\":\"" << name << "\",\"state\":\"SKIP\",\"reason\":\""
            << escape(error.what()) << "\",\"win32_error\":" << error.error() << "}\n";
    } catch (const Failure& error) {
        ++failed;
        std::cout << "{\"name\":\"" << name << "\",\"state\":\"FAIL\",\"reason\":\""
            << escape(error.what()) << "\",\"win32_error\":" << error.error() << "}\n";
    }
}

void mappedWriterRejected(Fixture& fixture, bool withView) {
    Handle writer(CreateFileW(fixture.executable.c_str(), GENERIC_READ | GENERIC_WRITE, kShareAll,
        nullptr, OPEN_EXISTING, 0, nullptr));
    require(writer.valid(), "mapping_writer_open_failed");
    Handle mapping(CreateFileMappingW(writer.value, nullptr, PAGE_READWRITE, 0, 0, nullptr));
    require(mapping.valid(), "mapping_create_failed");
    struct View {
        void* value = nullptr;
        ~View() { if (value != nullptr) UnmapViewOfFile(value); }
    } retainedView;
    if (withView) {
        retainedView.value = MapViewOfFile(mapping.value, FILE_MAP_WRITE, 0, 0, 0);
        require(retainedView.value != nullptr, "mapping_view_failed");
    }
    // The PAGE_READWRITE section survives even with no mapped view and after
    // the original writable file HANDLE closes. Immediate R-oplock denial is
    // required; later hashing/mutation detection cannot replace that fence.
    writer.reset();
    rejected(fixture, "INSTALLED_NAMESPACE_ENTRY_UNTRUSTED");
}

}  // namespace

int main() {
    // Machine-owned ACLs are confined to newly created, disposable temp paths.
    // Never enable token privileges or modify an installed file/OS security.
    std::array<unsigned char, SECURITY_MAX_SID_SIZE> administrators{};
    DWORD sidSize = static_cast<DWORD>(administrators.size());
    BOOL enabledAdmin = FALSE;
    if (!CreateWellKnownSid(WinBuiltinAdministratorsSid, nullptr, administrators.data(), &sidSize) ||
        !CheckTokenMembership(nullptr, administrators.data(), &enabledAdmin) || !enabledAdmin) {
        std::cout << "{\"name\":\"summary\",\"state\":\"SKIP\",\"authority_effect\":false,"
            "\"reason\":\"MACHINE_OWNED_FIXTURE_UNAVAILABLE:ADMIN_TOKEN_NOT_ENABLED\",\"win32_error\":"
            << ERROR_ACCESS_DENIED << "}\n";
        return 77;
    }
    try {
        Fixture prerequisites;
        prerequisites.create();
        prerequisites.cleanup();
    } catch (const Failure& error) {
        const bool needsAdmin = std::string_view(error.what()) == "fixture_machine_owner_acl_failed" &&
            (error.error() == ERROR_ACCESS_DENIED || error.error() == ERROR_INVALID_OWNER || error.error() == ERROR_PRIVILEGE_NOT_HELD);
        std::cout << "{\"name\":\"summary\",\"state\":\"" << (needsAdmin ? "SKIP" : "FAIL")
            << "\",\"authority_effect\":false,\"reason\":\"MACHINE_OWNED_FIXTURE_UNAVAILABLE:"
            << escape(error.what()) << "\",\"win32_error\":" << error.error() << "}\n";
        return needsAdmin ? 77 : 1;
    }

    run("positive_disk_hash_and_empty_file", [](Fixture& fixture) {
        const auto disk = diskSha256(fixture.executable);
        auto held = captured(fixture);
        require(held->executableSha256() == disk, "executable_digest_differs_from_disk");
        require(held->fileCount() == 3, "file_count_incorrect");
        require(held->namespaceSha256().size() == 64, "namespace_digest_missing");
        std::cout << "{\"name\":\"digest_oracle\",\"state\":\"OBSERVED\",\"executable_sha256\":\""
            << held->executableSha256() << "\",\"disk_sha256\":\"" << disk
            << "\",\"namespace_sha256\":\"" << held->namespaceSha256() << "\",\"files\":" << held->fileCount() << "}\n";
    });
    run("retained_package_canonical_serialization", [](Fixture& fixture) {
        auto held = captured(fixture);
        metaengine::guardian::ReleaseManifestV2 manifest;
        manifest.source_sha = std::string(40, 'a');
        manifest.package_version = "0.7.0-dev.12345.1";
        manifest.exe_name = "METAENGINE Browser Test.exe";
        manifest.exe_sha256 = held->executableSha256();
        std::string bytes;
        require(GuardianInstalledNamespaceTest::serializeRetainedPackage(*held, manifest, &bytes),
            "retained_package_serialization_failed");
        require(!bytes.empty() && bytes.back() == '\n', "retained_package_terminal_newline_missing");
        require(held->recheck(), "retained_package_serialization_lost_custody");
        std::cout << "{\"name\":\"retained_package_oracle\",\"state\":\"OBSERVED\",\"sha256\":\""
            << bytesSha256(bytes) << "\",\"bytes\":" << bytes.size() << "}\n";
    });
#ifndef METAENGINE_GUARDIAN_RELEASE_SIGNATURE_LINKED
    run("default_release_signature_build_unavailable", [](Fixture& fixture) {
        auto held = captured(fixture);
        require(!held->releaseSignatureBound(), "unsigned_fixture_already_signature_bound");
        require(!GuardianInstalledNamespaceTest::bindRetainedReleaseSignature(*held), "unlinked_signature_build_accepted");
        require(!held->releaseSignatureBound(), "unlinked_signature_build_minted_verified_release");
        require(held->authenticityReason() == "RELEASE_SIGNATURE_BUILD_UNAVAILABLE", "unlinked_signature_build_reason_incorrect");
        require(held->recheck(), "signature_unavailable_destroyed_mechanical_custody");
    });
#else
    run("linked_missing_envelope_rejected", [](Fixture& fixture) {
        auto held = captured(fixture);
        require(!GuardianInstalledNamespaceTest::bindRetainedReleaseSignature(*held), "missing_envelope_accepted");
        require(held->authenticityReason() == "RELEASE_ENVELOPE_NOT_RETAINED", "linked_missing_reason");
        require(!held->releaseSignatureBound() && held->recheck(), "missing_envelope_changed_custody");
    });
    const std::string canonical =
        "{\"schema\":\"metaengine.browser.installed-release-manifest.v2\",\"source_sha\":\"" + std::string(40, 'a')
        + "\",\"package_version\":\"0.7.0-dev.12345.1\",\"exe_name\":\"METAENGINE Browser Test.exe\",\"exe_sha256\":\"" + std::string(64, 'b')
        + "\",\"signer_thumbprint\":\"" + std::string(40, 'c') + "\",\"installer_sha256\":\"" + std::string(64, 'd')
        + "\",\"slsa_bundle_sha256\":\"" + std::string(64, 'e') + "\",\"slsa_evidence_sha256\":\"" + std::string(64, 'f')
        + "\",\"package_code_sha256\":\"" + std::string(64, '0') + "\"}";
    const auto envelope = [&](const std::string& signature) {
        return "{\"schema\":\"metaengine.browser.installed-release-envelope.v2\",\"manifest\":" + canonical
            + ",\"signature_base64\":\"" + signature + "\"}";
    };
    const auto refuse = [&](Fixture& fixture, const std::string& bytes, const char* reason) {
        fixture.file(fixture.root + L"\\metaengine-installed-release-proof.v2.json", bytes);
        auto held = captured(fixture);
        require(!GuardianInstalledNamespaceTest::bindRetainedReleaseSignature(*held), "invalid_signature_accepted");
        require(held->authenticityReason() == reason, "linked_signature_reason:" + held->authenticityReason());
        require(!held->releaseSignatureBound() && held->recheck(), "signature_rejection_changed_custody");
    };
    run("linked_noncanonical_envelope_rejected", [&](Fixture& fixture) {
        refuse(fixture, envelope(std::string(86, 'A') + "==") + "\n", "RELEASE_ENVELOPE_NONCANONICAL");
    });
    run("linked_noncanonical_base64_rejected", [&](Fixture& fixture) {
        refuse(fixture, envelope(std::string(85, 'A') + "B=="), "RELEASE_SIGNATURE_ENCODING_INVALID");
    });
    run("linked_invalid_base64_rejected", [&](Fixture& fixture) {
        refuse(fixture, envelope(std::string(85, 'A') + "?=="), "RELEASE_SIGNATURE_ENCODING_INVALID");
    });
    run("linked_canonical_zero_signature_rejected", [&](Fixture& fixture) {
        refuse(fixture, envelope(std::string(86, 'A') + "=="), "RELEASE_SIGNATURE_INVALID");
    });
    run("linked_rfc_signature_is_not_production_root", [&](Fixture& fixture) {
        // Public RFC8032 signature only; no signing key and no alternate root.
        refuse(fixture, envelope("5VZDAMNgrHKQhuLMgG6CioSHfx645dl02HPgZSJJAVVfuIIVkKM7rMYeOXAc+bRr0lv18FlbviRlUUFDjnoQCw=="),
            "RELEASE_SIGNATURE_INVALID");
    });
#endif
    run("unicode_package_binding_refused", [](Fixture& fixture) {
        // NTFS preserves these different UTF-16 names; ECMAScript toLowerCase
        // folds the first to the second. CREATE_NEW must succeed for BOTH.
        fixture.file(fixture.root + L"\\" + L"\u0130.bin", "first distinct Unicode fixture\n");
        fixture.file(fixture.root + L"\\" + L"i\u0307.bin", "second distinct Unicode fixture\n");
        auto held = captured(fixture);
        require(held->fileCount() == 5, "unicode_names_not_physically_distinct");
        require(!held->releaseSignatureBound(), "unicode_fixture_already_signature_bound");
        metaengine::guardian::ReleaseManifestV2 manifest;
        manifest.source_sha = std::string(40, 'a');
        manifest.package_version = "0.7.0-dev.12345.1";
        manifest.exe_name = "METAENGINE Browser Test.exe";
        manifest.exe_sha256 = held->executableSha256();
        std::string bytes;
        require(!GuardianInstalledNamespaceTest::serializeRetainedPackage(*held, manifest, &bytes),
            "unicode_package_serialization_accepted_without_native_case_parity");
        require(!held->releaseSignatureBound(), "unicode_package_minted_signature_binding");
        require(held->recheck(), "unicode_observation_custody_lost");
    });
    run("preexisting_writer_rejected", [](Fixture& fixture) {
        Handle writer(CreateFileW(fixture.executable.c_str(), GENERIC_WRITE, kShareAll, nullptr, OPEN_EXISTING, 0, nullptr));
        require(writer.valid(), "fixture_writer_open_failed");
        rejected(fixture, "INSTALLED_NAMESPACE_ENTRY_UNTRUSTED");
    });
    run("preexisting_mapped_writer_rejected", [](Fixture& fixture) {
        mappedWriterRejected(fixture, true);
    });
    run("preexisting_writable_section_without_view_rejected", [](Fixture& fixture) {
        mappedWriterRejected(fixture, false);
    });
    run("writable_code_root_rejected", [](Fixture& fixture) {
        applyAcl(fixture.root, true);
        rejected(fixture, "INSTALLED_NAMESPACE_WRITABLE_OR_UNTRUSTED");
    });
    run("writable_code_child_rejected", [](Fixture& fixture) {
        applyAcl(fixture.executable, true);
        rejected(fixture, "INSTALLED_NAMESPACE_ENTRY_UNTRUSTED");
    });
    run("hardlink_rejected", [](Fixture& fixture) {
        if (!CreateHardLinkW((fixture.root + L"\\alias.dll").c_str(), fixture.executable.c_str(), nullptr)) {
            const DWORD error = GetLastError();
            if (error == ERROR_NOT_SUPPORTED || error == ERROR_INVALID_FUNCTION)
                throw Unsupported("FILESYSTEM_HARDLINK_UNSUPPORTED", error);
            throw Failure("fixture_hardlink_create_failed", error);
        }
        rejected(fixture, "INSTALLED_NAMESPACE_ENTRY_UNTRUSTED");
    });
    run("symlink_reparse_rejected", [](Fixture& fixture) {
        const auto link = fixture.root + L"\\provider.dll";
        if (!CreateSymbolicLinkW(link.c_str(), fixture.executable.c_str(), 0x2)) {
            DWORD error = GetLastError();
            if (error == ERROR_INVALID_PARAMETER && CreateSymbolicLinkW(link.c_str(), fixture.executable.c_str(), 0)) error = ERROR_SUCCESS;
            else if (error == ERROR_INVALID_PARAMETER) error = GetLastError();
            if (error == ERROR_PRIVILEGE_NOT_HELD || error == ERROR_NOT_SUPPORTED || error == ERROR_INVALID_FUNCTION)
                throw Unsupported("SYMLINK_REQUIRES_PRIVILEGE_OR_SUPPORTED_FILESYSTEM", error);
            if (error != ERROR_SUCCESS) throw Failure("fixture_symlink_create_failed", error);
        }
        rejected(fixture, "INSTALLED_NAMESPACE_ENUMERATION_FAILED");
    });
    run("case_sensitive_directory_rejected", [](Fixture& fixture) {
        const auto directory = fixture.outer + L"\\case-sensitive";
        require(CreateDirectoryW(directory.c_str(), nullptr) != FALSE, "case_sensitive_fixture_create_failed");
        applyAcl(directory);
        {
            Handle handle(CreateFileW(directory.c_str(), FILE_WRITE_ATTRIBUTES, kShareAll, nullptr, OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
            require(handle.valid(), "case_sensitive_directory_open_failed");
            FILE_CASE_SENSITIVE_INFO info{};
            info.Flags = FILE_CS_FLAG_CASE_SENSITIVE_DIR;
            if (!SetFileInformationByHandle(handle.value, FileCaseSensitiveInfo, &info, sizeof(info))) {
                const DWORD error = GetLastError();
                if (error == ERROR_INVALID_PARAMETER || error == ERROR_NOT_SUPPORTED || error == ERROR_INVALID_FUNCTION ||
                    error == ERROR_ACCESS_DENIED || error == ERROR_PRIVILEGE_NOT_HELD)
                    throw Unsupported("CASE_SENSITIVE_DIRECTORY_ENABLE_UNAVAILABLE", error);
                throw Failure("case_sensitive_directory_set_failed", error);
            }
        }
        const auto executable = directory + L"\\METAENGINE Browser Test.exe";
        fixture.file(executable, kExecutableBytes);
        auto held = GuardianInstalledNamespaceTest::capture(executable);
        require(held && !held->recheck(), "case_sensitive_directory_capture_accepted");
        require(held->reason() == "INSTALLED_NAMESPACE_WRITABLE_OR_UNTRUSTED", "case_sensitive_negative_reason_incorrect");
    });
    run("cancelled_capture_rejected", [](Fixture& fixture) {
        Handle stop(CreateEventW(nullptr, TRUE, TRUE, nullptr));
        require(stop.valid(), "cancel_event_create_failed");
        auto held = GuardianInstalledNamespaceTest::capture(fixture.executable, stop.value);
        require(held && !held->recheck(), "cancelled_capture_accepted");
        require(held->reason() == "INSTALLED_NAMESPACE_CANCELLED", "cancelled_capture_reason_incorrect");
    });
    run("cancelled_retained_custody_rejected", [](Fixture& fixture) {
        Handle stop(CreateEventW(nullptr, TRUE, FALSE, nullptr));
        require(stop.valid(), "cancel_event_create_failed");
        auto held = GuardianInstalledNamespaceTest::capture(fixture.executable, stop.value);
        require(held && held->recheck(), "pre_cancel_capture_failed");
        require(SetEvent(stop.value) != FALSE, "cancel_event_set_failed");
        require(!held->recheck(), "cancelled_retained_custody_accepted");
        require(ResetEvent(stop.value) != FALSE, "cancel_event_reset_failed");
        require(!held->recheck(), "cancelled_custody_revived_after_reset");
    });
    run("retained_file_blocks_writer_delete_and_rename", [](Fixture& fixture) {
        auto held = captured(fixture);
        Handle writer(CreateFileW(fixture.executable.c_str(), GENERIC_WRITE, kShareAll, nullptr, OPEN_EXISTING, 0, nullptr));
        sharingFailure(writer.valid() ? TRUE : FALSE, "retained_write");
        sharingFailure(DeleteFileW(fixture.executable.c_str()), "retained_delete");
        sharingFailure(MoveFileExW(fixture.executable.c_str(), (fixture.executable + L".moved").c_str(), 0), "retained_file_rename");
        require(held->recheck(), "failed_mutation_changed_namespace");
    });
    run("retained_root_and_ancestor_block_rename", [](Fixture& fixture) {
        auto held = captured(fixture);
        sharingFailure(MoveFileExW(fixture.root.c_str(), (fixture.root + L".moved").c_str(), 0), "retained_root_rename");
        sharingFailure(MoveFileExW(fixture.outer.c_str(), (fixture.outer + L".moved").c_str(), 0), "retained_ancestor_rename");
        require(held->recheck(), "failed_ancestor_rename_changed_namespace");
    });
    run("privileged_new_provider_detected", [](Fixture& fixture) {
        auto held = captured(fixture);
        fixture.file(fixture.root + L"\\new-provider.dll", "privileged fixture addition\n");
        require(!held->recheck(), "new_provider_membership_change_undetected");
        require(held->reason() == "INSTALLED_NAMESPACE_MEMBERSHIP_DRIFT", "membership_drift_reason_incorrect:" + held->reason());
        require(!held->recheck(), "failed_custody_revived");
    });
    run("privileged_acl_drift_detected", [](Fixture& fixture) {
        auto held = captured(fixture);
        applyAcl(fixture.executable, true);
        require(!held->recheck(), "writable_acl_drift_undetected");
        require(held->reason() == "INSTALLED_NAMESPACE_HANDLE_DRIFT", "acl_drift_reason_incorrect:" + held->reason());
    });
    run("disposed_capture_releases_file_and_ancestor_handles", [](Fixture& fixture) {
        auto held = captured(fixture);
        held.reset();
        Handle writer(CreateFileW(fixture.executable.c_str(), GENERIC_WRITE, kShareAll, nullptr, OPEN_EXISTING, 0, nullptr));
        require(writer.valid(), "disposed_capture_retained_file_handle");
        writer.reset();
        require(DeleteFileW((fixture.root + L"\\empty.bin").c_str()) != FALSE, "disposed_capture_retained_empty_file_handle");
        const auto moved = fixture.outer + L".moved";
        require(MoveFileExW(fixture.outer.c_str(), moved.c_str(), 0) != FALSE, "disposed_capture_retained_ancestor_handle");
        const auto original = fixture.outer;
        fixture.outer = moved;
        require(MoveFileExW(moved.c_str(), original.c_str(), 0) != FALSE, "fixture_ancestor_restore_failed");
        fixture.outer = original;
    });
    std::cout << "{\"name\":\"summary\",\"schema\":\"metaengine.browser-guardian.installed-namespace-mechanical-tests.v1\",\"state\":\"" << (failed == 0 ? "PASS" : "FAIL")
        << "\",\"runtime\":\"WINDOWS_NATIVE_FILESYSTEM\",\"passed\":" << passed
        << ",\"failed\":" << failed << ",\"skipped\":" << skipped
        << ",\"tests_passed\":" << passed << ",\"tests_failed\":" << failed << ",\"tests_skipped\":" << skipped
        << ",\"authority_effect\":false,\"loaded_runtime_code_attested\":false,\"limitations\":["
           "\"WINDOWS_FILESYSTEM_MECHANICS_ONLY\",\"WINDOWS_RUNTIME_QUALIFICATION_PENDING\","
           "\"NO_MAIN_LAUNCH_OR_LOADED_CODE_ATTESTATION\"]}\n";
    return failed == 0 ? 0 : 1;
}
