#include "browser-guardian-connected-peer.hpp"
#include "browser-guardian-installed-namespace.hpp"
#include "browser-guardian-release-signature.hpp"

#include <sddl.h>
#include <shlobj.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <cwctype>
#include <mutex>
#include <string_view>
#include <utility>
#include <vector>

namespace metaengine::guardian {
namespace {

constexpr wchar_t kPipe[] = L"\\\\.\\pipe\\METAENGINEBrowserGuardianUpdateV1";
constexpr wchar_t kService[] = L"METAENGINEBrowserGuardian";
constexpr wchar_t kExe[] = L"METAENGINEBrowserGuardian.exe";
constexpr wchar_t kPackageExe[] = L"Programs\\METAENGINE Browser Test\\METAENGINE Browser Test.exe";
constexpr DWORD kClientAccess = FILE_READ_DATA | FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE;

struct Handle {
    HANDLE value = INVALID_HANDLE_VALUE;
    explicit Handle(HANDLE h = INVALID_HANDLE_VALUE) : value(h) {}
    ~Handle() { reset(); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    Handle(Handle&& other) noexcept : value(std::exchange(other.value, INVALID_HANDLE_VALUE)) {}
    Handle& operator=(Handle&& other) noexcept {
        if (this != &other) { reset(); value = std::exchange(other.value, INVALID_HANDLE_VALUE); }
        return *this;
    }
    bool valid() const { return value != nullptr && value != INVALID_HANDLE_VALUE; }
    void reset(HANDLE next = INVALID_HANDLE_VALUE) { if (valid()) CloseHandle(value); value = next; }
};

struct ServiceHandle {
    SC_HANDLE value = nullptr;
    explicit ServiceHandle(SC_HANDLE h = nullptr) : value(h) {}
    ~ServiceHandle() { if (value) CloseServiceHandle(value); }
    ServiceHandle(const ServiceHandle&) = delete;
    ServiceHandle& operator=(const ServiceHandle&) = delete;
    void reset() { if (value) CloseServiceHandle(value); value = nullptr; }
};

std::uint64_t ticks(const FILETIME& time) {
    ULARGE_INTEGER value{}; value.LowPart = time.dwLowDateTime; value.HighPart = time.dwHighDateTime; return value.QuadPart;
}

std::wstring lower(std::wstring value) {
    std::transform(value.begin(), value.end(), value.begin(), [](wchar_t c) { return static_cast<wchar_t>(std::towlower(c)); });
    return value;
}

std::wstring imagePath(HANDLE process) {
    std::array<wchar_t, 32768> buffer{};
    DWORD count = static_cast<DWORD>(buffer.size());
    if (!QueryFullProcessImageNameW(process, 0, buffer.data(), &count) || count == 0 || count >= buffer.size()) return {};
    return std::wstring(buffer.data(), count);
}

std::wstring folder(REFKNOWNFOLDERID id, HANDLE token = nullptr) {
    PWSTR raw = nullptr;
    if (SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, token, &raw) != S_OK || !raw) return {};
    std::wstring out(raw); CoTaskMemFree(raw); return out;
}

std::wstring append(const std::wstring& directory, const std::wstring& name) {
    return directory.empty() ? std::wstring{} : directory + (directory.back() == L'\\' ? L"" : L"\\") + name;
}

bool hex(std::wstring_view value, std::size_t size) {
    return value.size() == size && std::all_of(value.begin(), value.end(), [](wchar_t c) {
        return (c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'f');
    });
}

// The authenticated package contains PowerShell's pretty-printed staging JSON.
// Read only uniquely occurring ASCII string fields; expected EXE bytes come
// directly from the signed retained inventory, never a JSON hash/verified flag.
bool uniqueString(const std::string& bytes, std::string_view key, std::string* value) {
    const std::string marker = "\"" + std::string(key) + "\"";
    auto at = bytes.find(marker);
    if (at == std::string::npos || bytes.find(marker, at + marker.size()) != std::string::npos) return false;
    at += marker.size();
    const auto space = [](char c) { return c == ' ' || c == '\t' || c == '\r' || c == '\n'; };
    while (at < bytes.size() && space(bytes[at])) ++at;
    if (at == bytes.size() || bytes[at++] != ':') return false;
    while (at < bytes.size() && space(bytes[at])) ++at;
    if (at == bytes.size() || bytes[at++] != '"') return false;
    const auto end = bytes.find('"', at);
    if (end == std::string::npos || end - at > 128) return false;
    const auto text = std::string_view(bytes).substr(at, end - at);
    if (!std::all_of(text.begin(), text.end(), [](unsigned char c) { return c >= 0x20 && c <= 0x7e && c != '\\'; })) return false;
    *value = text;
    return true;
}

}  // namespace

struct GuardianConnectedPeer::State {
    mutable std::mutex lock;
    Handle cancelled{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
    Handle pipe;
    Handle server_process;
    ServiceHandle scm;
    ServiceHandle service;
    std::unique_ptr<GuardianInstalledNamespace> machine_slot;
    std::unique_ptr<GuardianInstalledNamespace> application;
    DWORD server_pid = 0;
    std::uint64_t server_birth = 0;
    std::wstring server_image;
    std::string server_image_sha256;
    std::string source_sha;
    std::string reason = "CONNECTED_PIPE_UNAVAILABLE";
    DWORD error = ERROR_SUCCESS;
    bool kernel_exact = false;
    bool scm_exact = false;
    bool package_bound = false;
    bool closed = false;
    bool connect_attempted = false;
    std::string account = "UNAVAILABLE";

    bool fail(const char* text, DWORD code = ERROR_SUCCESS) {
        // These are current completed-observation facts, never cached approval
        // from an earlier pass (or an earlier step that lost its post-fence).
        kernel_exact = scm_exact = package_bound = false;
        account = "UNAVAILABLE";
        source_sha.clear();
        reason = text; error = code == ERROR_SUCCESS ? GetLastError() : code;
        if (error == ERROR_SUCCESS) error = ERROR_INVALID_DATA;
        return false;
    }

    bool originalKernel() {
        kernel_exact = false;
        if (closed || !pipe.valid() || !server_process.valid() || !cancelled.valid() ||
            WaitForSingleObject(cancelled.value, 0) != WAIT_TIMEOUT) return fail("ORIGINAL_PIPE_CLOSED", ERROR_OPERATION_ABORTED);
        ULONG server = 0, client = 0;
        DWORD flags = 0;
        if (GetFileType(pipe.value) != FILE_TYPE_PIPE || !GetNamedPipeInfo(pipe.value, &flags, nullptr, nullptr, nullptr) ||
            (flags & PIPE_SERVER_END) != 0 || (flags & PIPE_TYPE_MESSAGE) == 0 ||
            !PeekNamedPipe(pipe.value, nullptr, 0, nullptr, nullptr, nullptr) ||
            !GetNamedPipeClientProcessId(pipe.value, &client) || client != GetCurrentProcessId() ||
            !GetNamedPipeServerProcessId(pipe.value, &server) || server != server_pid ||
            GetProcessId(server_process.value) != server_pid || WaitForSingleObject(server_process.value, 0) != WAIT_TIMEOUT) {
            return fail("ORIGINAL_PIPE_KERNEL_BINDING_LOST");
        }
        FILETIME creation{}, exited{}, kernel{}, user{};
        if (!GetProcessTimes(server_process.value, &creation, &exited, &kernel, &user) ||
            ticks(creation) != server_birth || imagePath(server_process.value) != server_image) return fail("ORIGINAL_SERVER_INCARNATION_CHANGED");
        kernel_exact = true;
        return true;
    }

    bool captureKernel() {
        ULONG server = 0;
        if (!pipe.valid() || !GetNamedPipeServerProcessId(pipe.value, &server) || server == 0) return fail("PIPE_SERVER_PID_UNAVAILABLE");
        server_pid = server;
        server_process.reset(OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, server_pid));
        if (!server_process.valid()) return fail("PIPE_SERVER_PROCESS_UNAVAILABLE");
        FILETIME creation{}, exited{}, kernel{}, user{};
        if (!GetProcessTimes(server_process.value, &creation, &exited, &kernel, &user) ||
            (server_birth = ticks(creation)) <= 116444736000000000ULL || (server_image = imagePath(server_process.value)).empty()) {
            return fail("PIPE_SERVER_BIRTH_IMAGE_UNAVAILABLE");
        }
        return originalKernel();
    }

    bool systemAccount() {
        account = "UNAVAILABLE";
        HANDLE raw = nullptr;
        if (!OpenProcessToken(server_process.value, TOKEN_QUERY, &raw)) return fail("PIPE_SERVER_TOKEN_UNAVAILABLE");
        Handle token(raw);
        DWORD size = 0;
        GetTokenInformation(token.value, TokenUser, nullptr, 0, &size);
        if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || size == 0) return fail("PIPE_SERVER_TOKEN_USER_UNAVAILABLE");
        std::vector<unsigned char> storage(size);
        if (!GetTokenInformation(token.value, TokenUser, storage.data(), size, &size)) return fail("PIPE_SERVER_TOKEN_USER_UNAVAILABLE");
        const auto* user = reinterpret_cast<const TOKEN_USER*>(storage.data());
        if (!IsValidSid(user->User.Sid) || !IsWellKnownSid(user->User.Sid, WinLocalSystemSid)) {
            account = "OTHER"; return fail("PIPE_SERVER_NOT_LOCAL_SYSTEM", ERROR_ACCESS_DENIED);
        }
        DWORD session = MAXDWORD, written = 0;
        if (!GetTokenInformation(token.value, TokenSessionId, &session, sizeof(session), &written) ||
            written != sizeof(session) || session != 0) return fail("PIPE_SERVER_SYSTEM_SESSION_UNPROVEN");
        account = "LOCAL_SYSTEM";
        return true;
    }

    bool currentScm() {
        scm_exact = false;
        if (!scm.value || !service.value) return fail("GUARDIAN_SCM_UNAVAILABLE");
        SERVICE_STATUS_PROCESS status{};
        DWORD needed = 0;
        if (!QueryServiceStatusEx(service.value, SC_STATUS_PROCESS_INFO, reinterpret_cast<BYTE*>(&status), sizeof(status), &needed) ||
            status.dwServiceType != SERVICE_WIN32_OWN_PROCESS || status.dwCurrentState != SERVICE_RUNNING ||
            status.dwProcessId != server_pid || !originalKernel()) return fail("GUARDIAN_SCM_LIFETIME_UNPROVEN");
        QueryServiceConfigW(service.value, nullptr, 0, &needed);
        if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || needed == 0 || needed > 64 * 1024) return fail("GUARDIAN_SCM_CONFIG_UNAVAILABLE");
        std::vector<unsigned char> bytes(needed);
        if (!QueryServiceConfigW(service.value, reinterpret_cast<QUERY_SERVICE_CONFIGW*>(bytes.data()), needed, &needed)) {
            return fail("GUARDIAN_SCM_CONFIG_UNAVAILABLE");
        }
        const auto* config = reinterpret_cast<const QUERY_SERVICE_CONFIGW*>(bytes.data());
        if (config->dwServiceType != SERVICE_WIN32_OWN_PROCESS || config->dwStartType != SERVICE_AUTO_START ||
            !config->lpServiceStartName || _wcsicmp(config->lpServiceStartName, L"LocalSystem") != 0 ||
            !config->lpBinaryPathName || lower(config->lpBinaryPathName) != lower(L"\"" + server_image + L"\"")) {
            return fail("GUARDIAN_SCM_CONFIG_DRIFT", ERROR_ACCESS_DENIED);
        }
        scm_exact = true;
        return true;
    }

    bool captureMachineSlot() {
        const auto pf = folder(FOLDERID_ProgramFiles);
        const auto prefix = append(pf, L"METAENGINE\\Guardian\\slots\\");
        if (pf.empty() || !lower(server_image).starts_with(lower(prefix))) return fail("GUARDIAN_IMAGE_OUTSIDE_MACHINE_SLOT", ERROR_ACCESS_DENIED);
        const auto relative = std::wstring_view(server_image).substr(prefix.size());
        if (relative.size() != 33 + 1 + std::wstring_view(kExe).size() || relative[16] != L'-' || relative[33] != L'\\' ||
            !hex(relative.substr(0, 16), 16) || !hex(relative.substr(17, 16), 16) || relative.substr(34) != kExe) {
            return fail("GUARDIAN_IMAGE_SLOT_INVALID", ERROR_ACCESS_DENIED);
        }
        // Same retained-handle fences as installed app custody: every ancestor,
        // machine ACL, FILE_ID_INFO, single link, reparse refusal and R oplock.
        machine_slot = GuardianInstalledNamespace::capture(server_image, cancelled.value);
        if (!machine_slot->recheck()) return fail("GUARDIAN_MACHINE_IMAGE_CUSTODY_UNAVAILABLE", machine_slot->error());
        server_image_sha256 = machine_slot->executableSha256();
        return true;
    }

    bool bindApplicationSource() {
        package_bound = false;
        HANDLE raw = nullptr;
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw)) return fail("CLIENT_PACKAGE_TOKEN_UNAVAILABLE");
        Handle token(raw);
        const auto local = folder(FOLDERID_LocalAppData, token.value);
        const auto expected = append(local, kPackageExe);
        if (local.empty() || lower(imagePath(GetCurrentProcess())) != lower(expected)) return fail("CLIENT_NOT_FIXED_INSTALLED_MAIN", ERROR_ACCESS_DENIED);
        if (!application) application = GuardianInstalledNamespace::capture(expected, cancelled.value);
        if (!application->recheck()) return fail("CLIENT_PACKAGE_CUSTODY_UNAVAILABLE", application->error());
        if (!application->boundReleaseManifest() && !application->bindRetainedReleaseSignature()) {
            return fail("CLIENT_RELEASE_SIGNATURE_UNAVAILABLE", ERROR_NOT_SUPPORTED);
        }
        const auto* release = application->boundReleaseManifest();
        std::string manifest, schema, source, version;
        constexpr wchar_t manifestRelative[] = L"resources\\guardian-native\\guardian-native-manifest.json";
        const auto staged = application->retainedFileSha256(L"resources\\guardian-native\\METAENGINEBrowserGuardian.exe");
        const auto manifestSha = application->retainedFileSha256(manifestRelative);
        if (!release || staged.size() != 64 || manifestSha.size() != 64 || staged != server_image_sha256 ||
            !application->readRetainedBytes(manifestRelative, 64 * 1024, &manifest) ||
            !uniqueString(manifest, "schema", &schema) || schema != "metaengine.browser.guardian-native-staging-manifest.v1" ||
            !uniqueString(manifest, "source_head", &source) || source != release->source_sha ||
            !uniqueString(manifest, "package_version", &version) || version != release->package_version) {
            return fail("GUARDIAN_SIGNED_PACKAGE_SOURCE_MISMATCH", ERROR_ACCESS_DENIED);
        }
        const std::string slot = source.substr(0, 16) + "-" + manifestSha.substr(0, 16);
        const std::wstring expectedImage = append(append(folder(FOLDERID_ProgramFiles), L"METAENGINE\\Guardian\\slots"),
            std::wstring(slot.begin(), slot.end()) + L"\\" + kExe);
        if (server_image != expectedImage || !application->recheck() || !machine_slot->recheck() || !currentScm()) {
            return fail("GUARDIAN_SOURCE_POSTCHECK_FAILED", ERROR_ACCESS_DENIED);
        }
        source_sha = source;
        package_bound = true;
        return true;
    }

    bool observe() {
        scm_exact = package_bound = false;
        account = "UNAVAILABLE";
        source_sha.clear();
        if (!originalKernel()) return false;
        if (!scm.value) scm.value = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT);
        if (!scm.value) return fail("GUARDIAN_SCM_UNAVAILABLE");
        if (!service.value) service.value = OpenServiceW(scm.value, kService, SERVICE_QUERY_STATUS | SERVICE_QUERY_CONFIG);
        if (!service.value) return fail("GUARDIAN_SERVICE_UNAVAILABLE");
        if (!currentScm() || !systemAccount()) return false;
        if (!machine_slot && !captureMachineSlot()) return false;
        if (!bindApplicationSource()) return false;
        if (!machine_slot->recheck() || !application->recheck() || !currentScm() || !systemAccount()) return fail("GUARDIAN_PEER_POSTCHECK_FAILED");
        // The compared on-disk source is not independently proven loaded image
        // provenance or current release/rollback policy. Those real producers
        // remain prerequisites; neither this object nor a snapshot grants ARM.
        reason = "GUARDIAN_LOADED_IMAGE_AND_RELEASE_POLICY_UNAVAILABLE";
        error = ERROR_NOT_SUPPORTED;
        return false;
    }
};

GuardianConnectedPeer::GuardianConnectedPeer() : state_(std::make_unique<State>()) {}
GuardianConnectedPeer::~GuardianConnectedPeer() { close(); }

std::unique_ptr<GuardianConnectedPeer> GuardianConnectedPeer::connect() {
    auto out = create();
    out->connectOriginal();
    return out;
}

std::unique_ptr<GuardianConnectedPeer> GuardianConnectedPeer::create() {
    return std::unique_ptr<GuardianConnectedPeer>(new GuardianConnectedPeer());
}

bool GuardianConnectedPeer::connectOriginal() {
    std::lock_guard<std::mutex> guard(state_->lock);
    if (state_->closed || state_->connect_attempted || state_->pipe.valid() || !state_->cancelled.valid() ||
        WaitForSingleObject(state_->cancelled.value, 0) != WAIT_TIMEOUT) {
        return state_->fail("ORIGINAL_PIPE_CONNECTION_NOT_REPLACEABLE", ERROR_OPERATION_ABORTED);
    }
    state_->connect_attempted = true;
    state_->pipe.reset(CreateFileW(kPipe, kClientAccess, 0, nullptr, OPEN_EXISTING,
        FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, nullptr));
    if (!state_->pipe.valid()) return state_->fail("GUARDIAN_FIXED_PIPE_OPEN_FAILED");
    return state_->captureKernel() && state_->observe();
}

void GuardianConnectedPeer::requestCancel() noexcept {
    // No peer mutex, worker queue, I/O, allocation or new security authority.
    if (state_ && state_->cancelled.valid()) SetEvent(state_->cancelled.value);
}

bool GuardianConnectedPeer::recheck() {
    std::lock_guard<std::mutex> guard(state_->lock);
    return state_->observe();
}

std::string GuardianConnectedPeer::snapshotJson() const {
    std::lock_guard<std::mutex> guard(state_->lock);
    return "{\"schema\":\"metaengine.browser-guardian.connected-peer-observation.v1\",\"state\":\"HOLD\",\"reason\":\"" + state_->reason +
        "\",\"server_pid\":" + std::to_string(state_->server_pid) + ",\"server_creation_time_100ns\":\"" +
        (state_->server_birth ? std::to_string(state_->server_birth) : std::string{}) + "\",\"server_image_sha256\":\"" + state_->server_image_sha256 +
        "\",\"source_sha\":\"" + state_->source_sha + "\",\"kernel_binding\":\"" + (state_->kernel_exact ? "EXACT" : "UNPROVEN") +
        "\",\"scm_binding\":\"" + (state_->scm_exact ? "EXACT" : "UNPROVEN") + "\",\"account_binding\":\"" + state_->account +
        "\",\"source_binding\":\"" + (state_->package_bound ? "PACKAGE_BOUND" : "UNAVAILABLE") +
        "\",\"launch_admission\":\"UNAVAILABLE\",\"win32_error\":" + std::to_string(state_->error) +
        ",\"loaded_runtime_code_attested\":false,\"authority_effect\":false}";
}

void GuardianConnectedPeer::close() noexcept {
    if (!state_) return;
    requestCancel();
    std::lock_guard<std::mutex> guard(state_->lock);
    if (state_->closed) return;
    state_->closed = true;
    state_->kernel_exact = state_->scm_exact = state_->package_bound = false;
    state_->account = "UNAVAILABLE";
    state_->source_sha.clear();
    state_->pipe.reset();
    state_->application.reset();
    state_->machine_slot.reset();
    state_->server_process.reset();
    state_->service.reset();
    state_->scm.reset();
    state_->reason = "ORIGINAL_PIPE_CLOSED";
    state_->error = ERROR_OPERATION_ABORTED;
}

#ifdef METAENGINE_GUARDIAN_PEER_TEST
std::unique_ptr<GuardianConnectedPeer> GuardianConnectedPeer::observeTestConnection(HANDLE original) {
    auto out = std::unique_ptr<GuardianConnectedPeer>(new GuardianConnectedPeer());
    HANDLE duplicate = INVALID_HANDLE_VALUE;
    if (!DuplicateHandle(GetCurrentProcess(), original, GetCurrentProcess(), &duplicate, 0, FALSE, DUPLICATE_SAME_ACCESS)) {
        out->state_->fail("TEST_ORIGINAL_PIPE_DUPLICATION_FAILED"); return out;
    }
    out->state_->pipe.reset(duplicate);
    out->state_->connect_attempted = true;
    out->state_->captureKernel();
    return out;
}

bool GuardianConnectedPeer::recheckOriginalKernelForTest() {
    std::lock_guard<std::mutex> guard(state_->lock);
    return state_->originalKernel();
}
#endif

}  // namespace metaengine::guardian
