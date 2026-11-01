#ifndef METAENGINE_GUARDIAN_PEER_TEST
#error This mechanics probe requires the private connected-peer test friend.
#endif

#include "browser-guardian-connected-peer.hpp"
#include "browser-guardian-owner-enrollment-observer.hpp"

#include <sddl.h>

#include <array>
#include <functional>
#include <iostream>
#include <memory>
#include <regex>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace metaengine::guardian {
struct GuardianConnectedPeerTest {
    static std::unique_ptr<GuardianConnectedPeer> observe(HANDLE original) {
        return GuardianConnectedPeer::observeTestConnection(original);
    }
    static bool kernel(GuardianConnectedPeer& peer) { return peer.recheckOriginalKernelForTest(); }
};
}  // namespace metaengine::guardian

namespace {

using metaengine::guardian::GuardianConnectedPeer;
using metaengine::guardian::GuardianConnectedPeerTest;
using metaengine::guardian::OwnerEnrollmentPipe;

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
    bool valid() const noexcept { return value != nullptr && value != INVALID_HANDLE_VALUE; }
    void reset(HANDLE next = INVALID_HANDLE_VALUE) noexcept {
        if (valid()) CloseHandle(value);
        value = next;
    }
};

class Failure final : public std::runtime_error {
public:
    explicit Failure(const std::string& reason, DWORD error = GetLastError())
        : std::runtime_error(reason), error_(error) {}
    DWORD error() const noexcept { return error_; }
private:
    DWORD error_;
};

void require(bool value, const char* reason) { if (!value) throw Failure(reason); }

std::string escape(std::string_view value) {
    std::string result;
    for (const char c : value) {
        if (c == '"' || c == '\\') { result.push_back('\\'); result.push_back(c); }
        else if (c == '\n') result += "\\n";
        else if (c == '\r') result += "\\r";
        else result.push_back(c);
    }
    return result;
}

std::string stringField(const std::string& json, const std::string& name) {
    require(json.size() <= 64 * 1024, "snapshot_unbounded");
    const std::regex expression("\"" + name + "\"\\s*:\\s*\"([^\"]*)\"");
    std::smatch match;
    require(std::regex_search(json, match, expression), ("snapshot_string_missing:" + name).c_str());
    return match[1].str();
}

std::uint64_t numberField(const std::string& json, const std::string& name) {
    const std::regex expression("\"" + name + "\"\\s*:\\s*([0-9]+)");
    std::smatch match;
    require(std::regex_search(json, match, expression), "snapshot_number_missing");
    return std::stoull(match[1].str());
}

DWORD pidField(const std::string& json) {
    const auto value = numberField(json, "server_pid");
    require(value > 0 && value <= MAXDWORD, "snapshot_pid_invalid");
    return static_cast<DWORD>(value);
}

std::string birth(HANDLE process) {
    FILETIME created{}, exited{}, kernel{}, user{};
    require(GetProcessTimes(process, &created, &exited, &kernel, &user) != FALSE, "oracle_process_times_failed");
    ULARGE_INTEGER ticks{};
    ticks.LowPart = created.dwLowDateTime;
    ticks.HighPart = created.dwHighDateTime;
    require(ticks.QuadPart > 116444736000000000ULL, "oracle_birth_invalid");
    return std::to_string(ticks.QuadPart);
}

std::wstring uniqueId() {
    static LONG counter = 0;
    return std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(GetTickCount64()) + L"-" +
        std::to_wstring(InterlockedIncrement(&counter));
}

bool testId(std::wstring_view id) {
    if (id.empty() || id.size() > 96) return false;
    for (const wchar_t c : id) if ((c < L'0' || c > L'9') && c != L'-') return false;
    return true;
}

std::wstring pipeName(const std::wstring& id) {
    require(testId(id), "fixture_id_invalid");
    return L"\\\\.\\pipe\\METAENGINEGuardianPeerTest-" + id;
}

std::wstring eventName(const std::wstring& id, const wchar_t* suffix) {
    require(testId(id), "fixture_event_id_invalid");
    return L"Local\\METAENGINEGuardianPeerTest-" + id + suffix;
}

Handle client(const std::wstring& name) {
    return Handle(CreateFileW(name.c_str(), kClientAccess, 0, nullptr, OPEN_EXISTING,
        FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, nullptr));
}

struct PipeFixture {
    std::wstring id = uniqueId();
    Handle server;
    Handle connected;
    Handle event;
    OVERLAPPED operation{};
    bool pending = false;

    ~PipeFixture() {
        if (pending && server.valid()) {
            CancelIoEx(server.value, &operation);
            DWORD ignored = 0;
            GetOverlappedResult(server.value, &operation, &ignored, TRUE);
        }
    }
    void createServer() {
        server.reset(CreateNamedPipeW(pipeName(id).c_str(),
            PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1, 4096, 4096, 0, nullptr));
        require(server.valid(), "fixture_pipe_create_failed");
    }
    void connectClient() {
        require(server.valid() && !pending, "fixture_server_not_ready_for_connect");
        event.reset(CreateEventW(nullptr, TRUE, FALSE, nullptr));
        require(event.valid(), "fixture_connect_event_failed");
        operation = {};
        operation.hEvent = event.value;
        if (!ConnectNamedPipe(server.value, &operation)) {
            const DWORD error = GetLastError();
            require(error == ERROR_IO_PENDING, "fixture_connect_not_pending");
            pending = true;
        }
        connected = client(pipeName(id));
        require(connected.valid(), "fixture_client_open_failed");
        if (pending) {
            require(WaitForSingleObject(event.value, 5'000) == WAIT_OBJECT_0, "fixture_connect_timeout");
            DWORD ignored = 0;
            require(GetOverlappedResult(server.value, &operation, &ignored, FALSE) != FALSE, "fixture_connect_result_failed");
            pending = false;
        }
    }
    void connect() { createServer();connectClient(); }
    void disconnect() {
        require(DisconnectNamedPipe(server.value) != FALSE, "fixture_disconnect_failed");
    }
};

struct PendingIo {
    HANDLE file;
    Handle event{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
    OVERLAPPED operation{};
    bool pending = false;
    explicit PendingIo(HANDLE original) : file(original) {
        require(event.valid(), "observer_io_event_failed");
        operation.hEvent = event.value;
    }
    ~PendingIo() {
        if (pending) {
            CancelIoEx(file, &operation);
            DWORD ignored = 0;
            GetOverlappedResult(file, &operation, &ignored, TRUE);
        }
    }
    DWORD finish() {
        if (pending) require(WaitForSingleObject(event.value, 5'000) == WAIT_OBJECT_0, "observer_io_timeout");
        DWORD transferred = 0;
        require(GetOverlappedResult(file, &operation, &transferred, FALSE) != FALSE, "observer_io_readback_failed");
        pending = false;
        return transferred;
    }
    void requirePending() {
        require(GetLastError() == ERROR_IO_PENDING, "observer_io_not_pending");
        pending = true;
    }
};

std::wstring tokenSid(HANDLE token) {
    DWORD bytes = 0;
    GetTokenInformation(token, TokenUser, nullptr, 0, &bytes);
    require(GetLastError() == ERROR_INSUFFICIENT_BUFFER && bytes != 0, "observer_oracle_token_size_failed");
    std::vector<unsigned char> storage(bytes);
    require(GetTokenInformation(token, TokenUser, storage.data(), bytes, &bytes) != FALSE, "observer_oracle_token_user_failed");
    LPWSTR raw = nullptr;
    require(ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(storage.data())->User.Sid, &raw) != FALSE && raw,
        "observer_oracle_sid_string_failed");
    const std::wstring value(raw);
    LocalFree(raw);
    return value;
}

void identificationObserverCompatibility() {
    OwnerEnrollmentPipe server;
    const auto name = pipeName(uniqueId());
    require(server.create(name), "observer_unique_pipe_create_failed");
    PendingIo connect(server.handle());
    if (!ConnectNamedPipe(server.handle(), &connect.operation)) connect.requirePending();
    Handle connected(CreateFileW(name.c_str(),
        metaengine::guardian::browserGuardianOwnerEnrollmentClientAccessMask(), 0, nullptr, OPEN_EXISTING,
        FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, nullptr));
    require(connected.valid(), "observer_identification_client_open_failed");
    connect.finish();

    constexpr char message[] = "identification-token-context\n";
    std::array<char, 128> buffer{};
    PendingIo read(server.handle());
    DWORD readBytes = 0;
    if (!ReadFile(server.handle(), buffer.data(), static_cast<DWORD>(buffer.size()), &readBytes, &read.operation)) read.requirePending();
    PendingIo write(connected.value);
    DWORD written = 0;
    if (!WriteFile(connected.value, message, static_cast<DWORD>(sizeof(message) - 1), &written, &write.operation)) write.requirePending();
    require(write.finish() == sizeof(message) - 1, "observer_context_write_incomplete");
    readBytes = read.finish();
    require(readBytes == sizeof(message) - 1 && std::string_view(buffer.data(), readBytes) == message,
        "observer_context_read_incomplete");

    HANDLE rawProcessToken = nullptr;
    require(OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &rawProcessToken) != FALSE, "observer_oracle_process_token_failed");
    Handle processToken(rawProcessToken);
    const auto expectedSid = tokenSid(processToken.value);
    DWORD expectedSession = MAXDWORD, bytes = 0;
    require(GetTokenInformation(processToken.value, TokenSessionId, &expectedSession, sizeof(expectedSession), &bytes) != FALSE &&
        bytes == sizeof(expectedSession), "observer_oracle_session_failed");

    // Prove this actual read carries Identification-level security before
    // testing the real observer. This is not a caller-declared token level.
    struct Revert {
        bool active = false;
        ~Revert() { if (active) RevertToSelf(); }
    } revert;
    require(ImpersonateNamedPipeClient(server.handle()) != FALSE, "observer_level_impersonation_failed");
    revert.active = true;
    HANDLE rawThreadToken = nullptr;
    require(OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, TRUE, &rawThreadToken) != FALSE, "observer_identification_token_open_failed");
    Handle threadToken(rawThreadToken);
    SECURITY_IMPERSONATION_LEVEL level = SecurityAnonymous;
    require(GetTokenInformation(threadToken.value, TokenImpersonationLevel, &level, sizeof(level), &bytes) != FALSE &&
        bytes == sizeof(level) && level == SecurityIdentification, "observer_actual_sqos_not_identification");
    require(RevertToSelf() != FALSE, "observer_level_revert_failed");
    revert.active = false;
    threadToken.reset();

    // The true value is supplied only after the ORIGINAL bounded read above has
    // physically completed with the exact message. There is no fake read ACK.
    const auto observed = server.observeClientIdentity(true);
    revert.active = !observed.revert_to_self_succeeded;
    require(observed.client_message_read_before_impersonation && observed.impersonation_succeeded &&
        observed.revert_to_self_succeeded && observed.token_user_readback && observed.token_session_id_readback,
        "observer_identification_readback_unproven");
    require(observed.reason == "TOKEN_IDENTITY_OBSERVED" && observed.win32_error == ERROR_SUCCESS,
        "observer_identification_result_failed");
    require(observed.client_pid == GetCurrentProcessId() && std::to_string(observed.client_creation_time_100ns) == birth(GetCurrentProcess()),
        "observer_identification_birth_mismatch");
    require(observed.user_sid == expectedSid && observed.session_id == expectedSession,
        "observer_identification_sid_session_mismatch");
    HANDLE unexpectedToken = nullptr;
    const BOOL stillImpersonating = OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, TRUE, &unexpectedToken);
    const DWORD tokenError = GetLastError();
    Handle unexpected(unexpectedToken);
    require(!stillImpersonating && tokenError == ERROR_NO_TOKEN, "observer_left_thread_impersonating");
}

void refused(HANDLE handle) {
    auto peer = GuardianConnectedPeerTest::observe(handle);
    require(peer != nullptr, "negative_observation_missing");
    require(!GuardianConnectedPeerTest::kernel(*peer), "invalid_handle_kernel_accepted");
    require(!peer->recheck(), "invalid_handle_production_accepted");
    const auto json = peer->snapshotJson();
    require(stringField(json, "launch_admission") == "UNAVAILABLE", "negative_launch_admission_changed");
}

void checkKernel(GuardianConnectedPeer& peer, DWORD pid, const std::string& expectedBirth) {
    require(GuardianConnectedPeerTest::kernel(peer), "connected_kernel_observation_unproven");
    const auto json = peer.snapshotJson();
    require(pidField(json) == pid, "connected_server_pid_mismatch");
    require(stringField(json, "server_creation_time_100ns") == expectedBirth, "connected_server_full_birth_mismatch");
    require(stringField(json, "kernel_binding") == "EXACT", "connected_kernel_binding_not_exact");
    require(stringField(json, "launch_admission") == "UNAVAILABLE", "mechanics_became_launch_admission");
}

int serverChild(const std::wstring& id) {
    require(testId(id), "child_id_invalid");
    Handle ready(OpenEventW(EVENT_MODIFY_STATE, FALSE, eventName(id, L"-ready").c_str()));
    Handle stop(OpenEventW(SYNCHRONIZE, FALSE, eventName(id, L"-stop").c_str()));
    require(ready.valid() && stop.valid(), "child_control_events_missing");
    PipeFixture fixture;
    fixture.id = id;
    fixture.createServer();
    fixture.event.reset(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    require(fixture.event.valid(), "child_connect_event_failed");
    fixture.operation.hEvent = fixture.event.value;
    if (!ConnectNamedPipe(fixture.server.value, &fixture.operation)) {
        const DWORD error = GetLastError();
        require(error == ERROR_IO_PENDING || error == ERROR_PIPE_CONNECTED, "child_connect_failed");
        fixture.pending = error == ERROR_IO_PENDING;
    }
    require(SetEvent(ready.value) != FALSE, "child_ready_signal_failed");
    HANDLE waits[] = {stop.value, fixture.event.value};
    if (fixture.pending) {
        const DWORD wait = WaitForMultipleObjects(2, waits, FALSE, 15'000);
        if (wait == WAIT_OBJECT_0) return 0;
        require(wait == WAIT_OBJECT_0 + 1, "child_connect_wait_failed");
        DWORD ignored = 0;
        require(GetOverlappedResult(fixture.server.value, &fixture.operation, &ignored, FALSE) != FALSE, "child_connect_readback_failed");
        fixture.pending = false;
    }
    require(WaitForSingleObject(stop.value, 15'000) == WAIT_OBJECT_0, "child_stop_wait_failed");
    return 0;
}

struct ChildFixture {
    std::wstring id = uniqueId();
    Handle ready;
    Handle stop;
    Handle job;
    Handle process;
    Handle thread;
    Handle connected;
    DWORD pid = 0;

    ~ChildFixture() {
        if (stop.valid()) SetEvent(stop.value);
        if (process.valid() && WaitForSingleObject(process.value, 0) != WAIT_OBJECT_0) {
            TerminateProcess(process.value, ERROR_PROCESS_ABORTED);
            WaitForSingleObject(process.value, 5'000);
        }
    }
    void start() {
        ready.reset(CreateEventW(nullptr, TRUE, FALSE, eventName(id, L"-ready").c_str()));
        stop.reset(CreateEventW(nullptr, TRUE, FALSE, eventName(id, L"-stop").c_str()));
        require(ready.valid() && stop.valid(), "fixture_child_events_failed");
        std::array<wchar_t, 32768> module{};
        const DWORD count = GetModuleFileNameW(nullptr, module.data(), static_cast<DWORD>(module.size()));
        require(count > 0 && count < module.size(), "fixture_self_image_unavailable");
        const std::wstring executable(module.data(), count);
        std::wstring command = L"\"" + executable + L"\" --server " + id;
        job.reset(CreateJobObjectW(nullptr, nullptr));
        require(job.valid(), "fixture_job_create_failed");
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        require(SetInformationJobObject(job.value, JobObjectExtendedLimitInformation, &limits, sizeof(limits)) != FALSE,
            "fixture_job_limits_failed");
        SIZE_T attributeBytes = 0;
        InitializeProcThreadAttributeList(nullptr, 1, 0, &attributeBytes);
        require(GetLastError() == ERROR_INSUFFICIENT_BUFFER && attributeBytes != 0, "fixture_attribute_size_failed");
        std::vector<unsigned char> storage(attributeBytes);
        auto* attributes = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
        require(InitializeProcThreadAttributeList(attributes, 1, 0, &attributeBytes) != FALSE, "fixture_attributes_failed");
        struct AttributeCleanup {
            LPPROC_THREAD_ATTRIBUTE_LIST value;
            ~AttributeCleanup() { DeleteProcThreadAttributeList(value); }
        } cleanup{attributes};
        require(UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST, &job.value,
            sizeof(job.value), nullptr, nullptr) != FALSE, "fixture_job_list_failed");
        STARTUPINFOEXW startup{};
        startup.StartupInfo.cb = sizeof(startup);
        startup.lpAttributeList = attributes;
        PROCESS_INFORMATION info{};
        require(CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, FALSE,
            CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT, nullptr, nullptr, &startup.StartupInfo, &info) != FALSE,
            "fixture_child_create_failed");
        process.reset(info.hProcess);thread.reset(info.hThread);pid = info.dwProcessId;
        require(WaitForSingleObject(ready.value, 5'000) == WAIT_OBJECT_0, "fixture_child_ready_timeout");
        connected = client(pipeName(id));
        require(connected.valid(), "fixture_child_client_open_failed");
    }
    void exit() {
        require(SetEvent(stop.value) != FALSE, "fixture_child_exit_signal_failed");
        require(WaitForSingleObject(process.value, 5'000) == WAIT_OBJECT_0, "fixture_child_exit_unconfirmed");
        DWORD code = STILL_ACTIVE;
        require(GetExitCodeProcess(process.value, &code) != FALSE && code == 0, "fixture_child_exit_failed");
    }
};

unsigned passed = 0, failed = 0;
void run(const char* name, const std::function<void()>& body) {
    try {
        body();++passed;
        std::cout << "{\"name\":\"" << name << "\",\"state\":\"PASS\"}\n";
    } catch (const Failure& error) {
        ++failed;
        std::cout << "{\"name\":\"" << name << "\",\"state\":\"FAIL\",\"reason\":\""
            << escape(error.what()) << "\",\"win32_error\":" << error.error() << "}\n";
    } catch (const std::exception& error) {
        ++failed;
        std::cout << "{\"name\":\"" << name << "\",\"state\":\"FAIL\",\"reason\":\""
            << escape(error.what()) << "\"}\n";
    }
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
    if (argc == 3 && std::wstring_view(argv[1]) == L"--server") {
        try { return serverChild(argv[2]); }
        catch (...) { return 2; }
    }
    if (argc != 1) return 2;
    run("cancel_before_connect_never_opens_fixed_pipe", [] {
        auto peer = GuardianConnectedPeer::create();
        require(peer != nullptr, "cancel_before_connect_peer_missing");
        peer->requestCancel();
        require(!peer->connectOriginal(), "cancelled_connect_attempt_accepted");
        const auto json = peer->snapshotJson();
        require(numberField(json, "server_pid") == 0 && stringField(json, "server_creation_time_100ns").empty(),
            "cancelled_connect_acquired_server_identity");
        require(stringField(json, "kernel_binding") == "UNPROVEN" && stringField(json, "launch_admission") == "UNAVAILABLE",
            "cancelled_connect_claimed_authority");
    });
    run("cancelled_connect_cannot_be_rearmed_or_replaced", [] {
        auto peer = GuardianConnectedPeer::create();
        require(peer != nullptr, "repeated_cancel_peer_missing");
        peer->requestCancel();
        require(!peer->connectOriginal(), "first_cancelled_connect_accepted");
        peer->requestCancel();
        require(!peer->connectOriginal(), "second_cancelled_connect_accepted");
        require(numberField(peer->snapshotJson(), "server_pid") == 0 &&
            stringField(peer->snapshotJson(), "kernel_binding") == "UNPROVEN", "repeated_cancel_opened_peer");
        require(!peer->recheck(), "repeated_cancel_recheck_accepted");
    });
    run("actual_connected_server_pid_and_full_birth", [] {
        PipeFixture fixture;fixture.connect();
        auto peer = GuardianConnectedPeerTest::observe(fixture.connected.value);
        require(peer != nullptr, "positive_observation_missing");
        const auto expectedBirth = birth(GetCurrentProcess());
        checkKernel(*peer, GetCurrentProcessId(), expectedBirth);
        std::cout << "{\"name\":\"kernel_oracle\",\"state\":\"OBSERVED\",\"server_pid\":"
            << GetCurrentProcessId() << ",\"server_creation_time_100ns\":\"" << expectedBirth
            << "\",\"snapshot\":" << peer->snapshotJson() << "}\n";
    });
    run("duplicate_retains_original_client_handle", [] {
        PipeFixture fixture;fixture.connect();
        auto peer = GuardianConnectedPeerTest::observe(fixture.connected.value);
        require(peer != nullptr, "duplicate_observation_missing");
        fixture.connected.reset();
        checkKernel(*peer, GetCurrentProcessId(), birth(GetCurrentProcess()));
    });
    run("invalid_and_null_handles_refused", [] {
        refused(INVALID_HANDLE_VALUE);refused(nullptr);
    });
    run("nonpipe_handle_refused", [] {
        Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
        require(event.valid(), "fixture_nonpipe_event_failed");
        refused(event.value);
    });
    run("unconnected_server_end_refused", [] {
        PipeFixture fixture;fixture.createServer();refused(fixture.server.value);
    });
    run("connected_server_end_refused", [] {
        PipeFixture fixture;fixture.connect();refused(fixture.server.value);
    });
    run("disconnected_original_pipe_refused", [] {
        PipeFixture fixture;fixture.connect();
        auto peer = GuardianConnectedPeerTest::observe(fixture.connected.value);
        require(peer && GuardianConnectedPeerTest::kernel(*peer), "before_disconnect_unproven");
        fixture.disconnect();
        require(!GuardianConnectedPeerTest::kernel(*peer), "disconnected_original_pipe_accepted");
        require(!peer->recheck(), "disconnected_production_peer_accepted");
        require(stringField(peer->snapshotJson(), "kernel_binding") == "UNPROVEN", "disconnected_binding_not_revoked");
    });
    run("recheck_never_substitutes_another_connection", [] {
        PipeFixture first;first.connect();
        auto heldFirst = GuardianConnectedPeerTest::observe(first.connected.value);
        require(heldFirst && GuardianConnectedPeerTest::kernel(*heldFirst), "first_connection_unproven");
        first.disconnect();
        PipeFixture second;second.connect();
        auto heldSecond = GuardianConnectedPeerTest::observe(second.connected.value);
        require(heldSecond && GuardianConnectedPeerTest::kernel(*heldSecond), "second_connection_unproven");
        require(!GuardianConnectedPeerTest::kernel(*heldFirst), "new_connection_revived_original_peer");
        require(!heldFirst->recheck(), "new_connection_became_original_authority");
    });
    run("same_name_same_process_reconnection_does_not_revive_original", [] {
        PipeFixture fixture;fixture.connect();
        auto original = GuardianConnectedPeerTest::observe(fixture.connected.value);
        require(original && GuardianConnectedPeerTest::kernel(*original), "same_name_original_unproven");
        fixture.disconnect();fixture.connected.reset();
        // Reuse the exact server instance/name/PID/birth while the original peer
        // still owns its duplicate of the disconnected ORIGINAL client object.
        fixture.connectClient();
        auto replacement = GuardianConnectedPeerTest::observe(fixture.connected.value);
        require(replacement != nullptr, "same_name_replacement_missing");
        checkKernel(*replacement, GetCurrentProcessId(), birth(GetCurrentProcess()));
        require(!GuardianConnectedPeerTest::kernel(*original), "same_name_reconnect_revived_original_object");
        require(!original->recheck(), "same_name_reconnect_became_original_authority");
    });
    run("fixture_cannot_qualify_guardian_or_launch", [] {
        PipeFixture fixture;fixture.connect();
        auto peer = GuardianConnectedPeerTest::observe(fixture.connected.value);
        require(peer && GuardianConnectedPeerTest::kernel(*peer), "fixture_kernel_unproven");
        require(!peer->recheck(), "fixture_qualified_as_guardian");
        const auto json = peer->snapshotJson();
        require(stringField(json, "state") == "HOLD", "fixture_did_not_hold");
        require(stringField(json, "scm_binding") == "UNPROVEN", "fixture_claimed_scm_binding");
        require(stringField(json, "source_binding") == "UNAVAILABLE", "fixture_claimed_package_source");
        require(stringField(json, "launch_admission") == "UNAVAILABLE", "fixture_claimed_launch_admission");
    });
    run("close_is_idempotent_and_revokes_kernel_observation", [] {
        PipeFixture fixture;fixture.connect();
        auto peer = GuardianConnectedPeerTest::observe(fixture.connected.value);
        require(peer && GuardianConnectedPeerTest::kernel(*peer), "pre_close_kernel_unproven");
        peer->close();peer->close();
        require(!GuardianConnectedPeerTest::kernel(*peer), "closed_peer_kernel_accepted");
        require(!peer->recheck(), "closed_peer_production_accepted");
        require(stringField(peer->snapshotJson(), "launch_admission") == "UNAVAILABLE", "closed_peer_claimed_launch");
    });
    run("child_server_exit_invalidates_original_process_handle", [] {
        ChildFixture fixture;fixture.start();
        const auto expectedBirth = birth(fixture.process.value);
        auto peer = GuardianConnectedPeerTest::observe(fixture.connected.value);
        require(peer != nullptr, "child_observation_missing");
        checkKernel(*peer, fixture.pid, expectedBirth);
        fixture.connected.reset();
        fixture.exit();
        require(!GuardianConnectedPeerTest::kernel(*peer), "exited_original_process_accepted");
        require(!peer->recheck(), "exited_production_peer_accepted");
    });
    run("identification_client_message_binds_original_observer_token", [] {
        identificationObserverCompatibility();
    });
    std::cout << "{\"name\":\"summary\",\"schema\":\"metaengine.browser-guardian.connected-peer-mechanical-tests.v1\","
        "\"state\":\"" << (failed == 0 ? "PASS" : "FAIL") << "\",\"runtime\":\"WINDOWS_NATIVE_PIPE_KERNEL\","
        "\"tests_passed\":" << passed << ",\"tests_failed\":" << failed
        << ",\"tests_skipped\":0,\"authority_effect\":false,\"loaded_runtime_code_attested\":false,"
        "\"launch_admission\":\"UNAVAILABLE\",\"qualification\":\"MECHANICS_ONLY_NOT_APPROVED_GUARDIAN\"}\n";
    return failed == 0 ? 0 : 1;
}
