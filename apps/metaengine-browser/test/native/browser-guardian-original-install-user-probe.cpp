#ifndef METAENGINE_GUARDIAN_INSTALL_ORIGIN_TEST
#error Original-user mechanics require the private test friend.
#endif
#include "browser-guardian-original-install-user.hpp"
#include <sddl.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <functional>
#include <iostream>
#include <regex>
#include <stdexcept>
#include <string>
#include <thread>
#include <type_traits>
#include <utility>
#include <vector>

namespace metaengine::guardian {
struct GuardianOriginalInstallUserTest {
    static auto server(HANDLE original_client) { return GuardianOriginalInstallUser::captureOriginalPipeServer(original_client); }
    static auto client(HANDLE original_server) { return GuardianOriginalInstallUser::captureOriginalPipeClient(original_server); }
    static bool matches(GuardianOriginalInstallUser& user, HANDLE process) { return user.matchesOriginalProcess(process); }
};
}
using metaengine::guardian::GuardianOriginalInstallUser;
using metaengine::guardian::GuardianOriginalInstallUserTest;

namespace {
struct Handle {
    HANDLE value = INVALID_HANDLE_VALUE;
    explicit Handle(HANDLE raw = INVALID_HANDLE_VALUE) : value(raw) {}
    ~Handle() { reset(); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    Handle(Handle&& other) noexcept : value(std::exchange(other.value, INVALID_HANDLE_VALUE)) {}
    Handle& operator=(Handle&& other) noexcept { if (this != &other) reset(std::exchange(other.value, INVALID_HANDLE_VALUE)); return *this; }
    bool valid() const { return value && value != INVALID_HANDLE_VALUE; }
    void reset(HANDLE next = INVALID_HANDLE_VALUE) { if (valid()) CloseHandle(value); value = next; }
};
void require(bool value, const char* reason) { if (!value) throw std::runtime_error(reason); }
struct Skip {};
std::string field(const std::string& json, const std::string& name) {
    std::smatch match;
    require(std::regex_search(json, match, std::regex("\"" + name + "\":\"([^\"]*)\"")), "snapshot_string_missing");
    return match[1].str();
}
std::uint64_t number(const std::string& json, const std::string& name) {
    std::smatch match;
    require(std::regex_search(json, match, std::regex("\"" + name + "\":([0-9]+)")), "snapshot_number_missing");
    return std::stoull(match[1].str());
}
std::uint64_t ticks(const LUID& luid) {
    return (static_cast<std::uint64_t>(static_cast<DWORD>(luid.HighPart)) << 32) | luid.LowPart;
}
std::uint64_t birth(HANDLE process) {
    FILETIME created{}, exited{}, kernel{}, user{};
    require(GetProcessTimes(process, &created, &exited, &kernel, &user) != FALSE, "oracle_process_times_unavailable");
    ULARGE_INTEGER value{}; value.LowPart = created.dwLowDateTime; value.HighPart = created.dwHighDateTime;
    return value.QuadPart;
}
std::vector<BYTE> tokenData(HANDLE token, TOKEN_INFORMATION_CLASS kind) {
    DWORD bytes = 0; GetTokenInformation(token, kind, nullptr, 0, &bytes);
    require(GetLastError() == ERROR_INSUFFICIENT_BUFFER && bytes != 0, "oracle_token_buffer_unavailable");
    std::vector<BYTE> out(bytes);
    require(GetTokenInformation(token, kind, out.data(), bytes, &bytes) != FALSE, "oracle_token_data_unavailable");
    return out;
}
struct Oracle {
    std::wstring sid;
    DWORD session = 0;
    std::uint64_t created = 0, logon = 0;
    bool eligible = false;
};
Oracle oracle() {
    HANDLE raw = nullptr;
    require(OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw) != FALSE, "oracle_process_token_unavailable");
    Handle token(raw);
    const auto user = tokenData(token.value, TokenUser);
    auto* sid = reinterpret_cast<const TOKEN_USER*>(user.data())->User.Sid;
    LPWSTR text = nullptr;
    require(ConvertSidToStringSidW(sid, &text) != FALSE && text, "oracle_sid_unavailable");
    Oracle out; out.sid = text; LocalFree(text);
    out.created = birth(GetCurrentProcess());
    TOKEN_STATISTICS stats{}; TOKEN_ELEVATION elevation{}; DWORD app_container = 1, written = 0;
    require(GetTokenInformation(token.value, TokenStatistics, &stats, sizeof(stats), &written) != FALSE, "oracle_statistics_unavailable");
    require(GetTokenInformation(token.value, TokenElevation, &elevation, sizeof(elevation), &written) != FALSE, "oracle_elevation_unavailable");
    require(GetTokenInformation(token.value, TokenIsAppContainer, &app_container, sizeof(app_container), &written) != FALSE, "oracle_app_container_unavailable");
    require(GetTokenInformation(token.value, TokenSessionId, &out.session, sizeof(out.session), &written) != FALSE, "oracle_session_unavailable");
    out.logon = ticks(stats.AuthenticationId);
    const auto integrity = tokenData(token.value, TokenIntegrityLevel);
    const auto label = reinterpret_cast<const TOKEN_MANDATORY_LABEL*>(integrity.data())->Label.Sid;
    require(IsValidSid(label) && *GetSidSubAuthorityCount(label) != 0, "oracle_integrity_unavailable");
    const auto rid = *GetSidSubAuthority(label, *GetSidSubAuthorityCount(label) - 1);
    const auto group_bytes = tokenData(token.value, TokenGroups);
    const auto* groups = reinterpret_cast<const TOKEN_GROUPS*>(group_bytes.data());
    unsigned logon_groups = 0;
    for (DWORD i = 0; i < groups->GroupCount; ++i)
        if ((groups->Groups[i].Attributes & SE_GROUP_LOGON_ID) == SE_GROUP_LOGON_ID && IsValidSid(groups->Groups[i].Sid)) ++logon_groups;
    DWORD process_session = MAXDWORD;
    require(ProcessIdToSessionId(GetCurrentProcessId(), &process_session) != FALSE, "oracle_process_session_unavailable");
    out.eligible = stats.TokenType == TokenPrimary && out.logon != 0 && !elevation.TokenIsElevated && !app_container &&
        !IsTokenRestricted(token.value) && rid >= SECURITY_MANDATORY_MEDIUM_RID && rid < SECURITY_MANDATORY_HIGH_RID &&
        !IsWellKnownSid(sid, WinLocalSystemSid) && !IsWellKnownSid(sid, WinLocalServiceSid) && !IsWellKnownSid(sid, WinNetworkServiceSid) &&
        out.session != 0 && out.session == process_session && logon_groups == 1;
    return out;
}
void noAuthority(const std::string& json) {
    require(field(json, "source_release_binding") == "UNQUALIFIED" && field(json, "launch_admission") == "UNAVAILABLE" &&
        json.find("\"authority_effect\":false") != std::string::npos, "mechanics_claimed_install_authority");
}
void hidden(GuardianOriginalInstallUser& user) {
    const auto json = user.snapshotJson(); noAuthority(json);
    require(field(json, "state") == "HOLD" && field(json, "identity_binding") == "UNPROVEN", "failed_identity_was_promoted");
    require(number(json, "original_pid") == 0 && number(json, "original_session") == 0 &&
        field(json, "original_creation_time_100ns").empty() && field(json, "original_sid").empty() &&
        field(json, "original_logon_id").empty(), "failed_capture_leaked_stale_identity_facts");
}
void observed(GuardianOriginalInstallUser& user, const Oracle& expected, DWORD pid, std::uint64_t created) {
    require(user.recheck(), "actual_unelevated_original_identity_unavailable");
    const auto json = user.snapshotJson(); noAuthority(json);
    require(field(json, "state") == "SOURCE_ONLY" && field(json, "identity_binding") == "RETAINED", "original_identity_not_retained");
    require(number(json, "original_pid") == pid && field(json, "original_creation_time_100ns") == std::to_string(created), "original_full_birth_or_pid_mismatch");
    require(number(json, "original_session") == expected.session && field(json, "original_logon_id") == std::to_string(expected.logon), "original_logon_or_session_mismatch");
    const auto value = field(json, "original_sid");
    require(std::wstring(value.begin(), value.end()) == expected.sid, "original_sid_mismatch");
}
void interactiveOnly() { if (!oracle().eligible) throw Skip{}; }

std::wstring id() {
    static LONG count = 0;
    return std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(GetTickCount64()) + L"-" + std::to_wstring(InterlockedIncrement(&count));
}
std::wstring pipeName(const std::wstring& value) { return L"\\\\.\\pipe\\METAENGINEOriginalInstallUserTest-" + value; }
Handle client(const std::wstring& name) {
    return Handle(CreateFileW(name.c_str(), FILE_READ_DATA | FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE, 0, nullptr,
        OPEN_EXISTING, FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, nullptr));
}
struct Io {
    HANDLE file; Handle event{CreateEventW(nullptr, TRUE, FALSE, nullptr)}; OVERLAPPED operation{}; bool pending = false;
    explicit Io(HANDLE value) : file(value) { require(event.valid(), "fixture_io_event_failed"); operation.hEvent = event.value; }
    ~Io() { if (pending) { CancelIoEx(file, &operation); DWORD ignored = 0; GetOverlappedResult(file, &operation, &ignored, TRUE); } }
    void started(BOOL immediate) { if (!immediate) { require(GetLastError() == ERROR_IO_PENDING, "fixture_io_not_pending"); pending = true; } }
    DWORD finish() {
        if (pending) require(WaitForSingleObject(event.value, 5'000) == WAIT_OBJECT_0, "fixture_io_timeout");
        DWORD bytes = 0; require(GetOverlappedResult(file, &operation, &bytes, FALSE) != FALSE, "fixture_io_completion_failed"); pending = false; return bytes;
    }
};
struct Pipe {
    std::wstring key = id(); Handle server, connected;
    void create() {
        server.reset(CreateNamedPipeW(pipeName(key).c_str(), PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, 1, 256, 256, 0, nullptr));
        require(server.valid(), "fixture_pipe_create_failed");
    }
    void connect() {
        Io pending(server.value); pending.started(ConnectNamedPipe(server.value, &pending.operation));
        connected = client(pipeName(key)); require(connected.valid(), "fixture_pipe_open_failed"); pending.finish();
    }
    void open() { create(); connect(); }
    void message() {
        constexpr std::array<char, 8> packet{'O','R','I','G','I','N','\0','1'}; std::array<char, 32> buffer{};
        Io read(server.value), write(connected.value); DWORD bytes = 0;
        read.started(ReadFile(server.value, buffer.data(), static_cast<DWORD>(buffer.size()), &bytes, &read.operation));
        write.started(WriteFile(connected.value, packet.data(), static_cast<DWORD>(packet.size()), &bytes, &write.operation));
        require(write.finish() == packet.size() && read.finish() == packet.size() &&
            std::equal(packet.begin(), packet.end(), buffer.begin()), "fixture_original_message_not_completed");
    }
    void disconnect() { require(DisconnectNamedPipe(server.value) != FALSE, "fixture_disconnect_failed"); }
};

struct Revert {
    bool active = false;
    ~Revert() { if (active) RevertToSelf(); }
    void now() { require(RevertToSelf() != FALSE, "fixture_revert_failed"); active = false; }
};
void impersonating(const std::function<void()>& body) {
    HANDLE raw = nullptr; require(OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY | TOKEN_DUPLICATE, &raw) != FALSE, "fixture_token_duplicate_source_failed");
    Handle original(raw); raw = nullptr;
    require(DuplicateTokenEx(original.value, TOKEN_QUERY | TOKEN_IMPERSONATE, nullptr, SecurityImpersonation, TokenImpersonation, &raw) != FALSE,
        "fixture_impersonation_duplicate_failed");
    Handle token(raw); Revert revert;
    require(SetThreadToken(nullptr, token.value) != FALSE, "fixture_thread_token_failed"); revert.active = true;
    body(); revert.now();
}

std::wstring eventName(const std::wstring& key, const wchar_t* suffix) { return L"Local\\METAENGINEOriginalInstallUserTest-" + key + suffix; }
int serverChild(const std::wstring& key) {
    require(!key.empty() && key.size() < 96 && std::all_of(key.begin(), key.end(), [](wchar_t c) {
        return (c >= L'0' && c <= L'9') || c == L'-'; }), "fixture_child_key_invalid");
    Handle ready(OpenEventW(EVENT_MODIFY_STATE, FALSE, eventName(key, L"-ready").c_str()));
    Handle stop(OpenEventW(SYNCHRONIZE, FALSE, eventName(key, L"-stop").c_str()));
    require(ready.valid() && stop.valid(), "fixture_child_events_missing");
    Pipe pipe; pipe.key = key; pipe.create();
    Io connect(pipe.server.value); connect.started(ConnectNamedPipe(pipe.server.value, &connect.operation));
    require(SetEvent(ready.value) != FALSE, "fixture_child_ready_failed");
    HANDLE waits[] = {stop.value, connect.event.value};
    const auto wait = WaitForMultipleObjects(2, waits, FALSE, 15'000);
    if (wait == WAIT_OBJECT_0) return 0;
    require(wait == WAIT_OBJECT_0 + 1, "fixture_child_connect_timeout"); connect.finish();
    constexpr char packet[] = "ORIGINAL";
    Io write(pipe.server.value); DWORD written = 0;
    write.started(WriteFile(pipe.server.value, packet, static_cast<DWORD>(sizeof(packet) - 1), &written, &write.operation));
    require(write.finish() == sizeof(packet) - 1, "fixture_child_message_incomplete");
    require(WaitForSingleObject(stop.value, 15'000) == WAIT_OBJECT_0, "fixture_child_stop_timeout");
    return 0;
}
struct Child {
    std::wstring key = id(); Handle ready, stop, job, process, thread, connected; DWORD pid = 0;
    ~Child() {
        if (stop.valid()) SetEvent(stop.value);
        if (process.valid() && WaitForSingleObject(process.value, 0) != WAIT_OBJECT_0) {
            TerminateProcess(process.value, ERROR_PROCESS_ABORTED); WaitForSingleObject(process.value, 5'000);
        }
    }
    void start() {
        ready.reset(CreateEventW(nullptr, TRUE, FALSE, eventName(key, L"-ready").c_str()));
        stop.reset(CreateEventW(nullptr, TRUE, FALSE, eventName(key, L"-stop").c_str()));
        require(ready.valid() && stop.valid(), "fixture_parent_events_missing");
        std::array<wchar_t, 32768> buffer{};
        const DWORD size = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
        require(size > 0 && size < buffer.size(), "fixture_child_image_missing");
        const std::wstring executable(buffer.data(), size); std::wstring command = L"\"" + executable + L"\" --server " + key;
        job.reset(CreateJobObjectW(nullptr, nullptr)); require(job.valid(), "fixture_child_job_missing");
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{}; limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        require(SetInformationJobObject(job.value, JobObjectExtendedLimitInformation, &limits, sizeof(limits)) != FALSE, "fixture_child_job_limits_failed");
        SIZE_T bytes = 0; InitializeProcThreadAttributeList(nullptr, 1, 0, &bytes);
        require(GetLastError() == ERROR_INSUFFICIENT_BUFFER && bytes != 0, "fixture_child_attributes_missing");
        std::vector<BYTE> storage(bytes); auto* attributes = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
        require(InitializeProcThreadAttributeList(attributes, 1, 0, &bytes) != FALSE, "fixture_child_attributes_failed");
        struct Cleanup { LPPROC_THREAD_ATTRIBUTE_LIST value; ~Cleanup() { DeleteProcThreadAttributeList(value); } } cleanup{attributes};
        require(UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST, &job.value, sizeof(job.value), nullptr, nullptr) != FALSE,
            "fixture_child_atomic_job_failed");
        STARTUPINFOEXW startup{}; startup.StartupInfo.cb = sizeof(startup); startup.lpAttributeList = attributes; PROCESS_INFORMATION info{};
        require(CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, FALSE,
            CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT, nullptr, nullptr, &startup.StartupInfo, &info) != FALSE, "fixture_child_create_failed");
        process.reset(info.hProcess); thread.reset(info.hThread); pid = info.dwProcessId;
        require(WaitForSingleObject(ready.value, 5'000) == WAIT_OBJECT_0, "fixture_child_ready_timeout");
        connected = client(pipeName(key)); require(connected.valid(), "fixture_child_pipe_open_failed");
        Io read(connected.value); std::array<char, 8> message{}; DWORD received = 0;
        read.started(ReadFile(connected.value, message.data(), static_cast<DWORD>(message.size()), &received, &read.operation));
        require(read.finish() == message.size() && std::string_view(message.data(), message.size()) == "ORIGINAL", "fixture_child_message_missing");
    }
    void exit() {
        require(SetEvent(stop.value) != FALSE && WaitForSingleObject(process.value, 5'000) == WAIT_OBJECT_0, "fixture_child_exit_unconfirmed");
        DWORD code = STILL_ACTIVE; require(GetExitCodeProcess(process.value, &code) != FALSE && code == 0, "fixture_child_exit_failed");
    }
};

unsigned passed = 0, failed = 0, skipped = 0;
void run(const char* name, const std::function<void()>& body) {
    try { body(); ++passed; std::cout << "{\"name\":\"" << name << "\",\"state\":\"PASS\"}\n"; }
    catch (const Skip&) { ++skipped; std::cout << "{\"name\":\"" << name << "\",\"state\":\"SKIP\",\"reason\":\"NO_ACTUAL_UNELEVATED_INTERACTIVE_TOKEN\"}\n"; }
    catch (const std::exception& error) { ++failed; std::cout << "{\"name\":\"" << name << "\",\"state\":\"FAIL\",\"reason\":\"" << error.what() << "\",\"win32_error\":" << GetLastError() << "}\n"; }
}
}

int wmain(int argc, wchar_t** argv) {
    if (argc == 3 && std::wstring_view(argv[1]) == L"--server") { try { return serverChild(argv[2]); } catch (...) { return 2; } }
    if (argc != 1) return 2;
    static_assert(!std::is_default_constructible_v<GuardianOriginalInstallUser>);
    static_assert(!std::is_copy_constructible_v<GuardianOriginalInstallUser>);
    static_assert(!std::is_move_constructible_v<GuardianOriginalInstallUser>);
    static_assert(std::is_same_v<decltype(&GuardianOriginalInstallUser::captureCurrentBeforeElevation),
        std::unique_ptr<GuardianOriginalInstallUser>(*)()>);
    run("actual_current_process_and_token_policy_oracle", [] {
        const auto expected = oracle(); auto user = GuardianOriginalInstallUser::captureCurrentBeforeElevation();
        require(user != nullptr, "original_capture_object_missing");
        if (expected.eligible) observed(*user, expected, GetCurrentProcessId(), expected.created);
        else { require(!user->recheck(), "elevated_or_noninteractive_user_was_accepted"); hidden(*user); }
        std::cout << "{\"name\":\"actual_context\",\"state\":\"OBSERVED\",\"eligible_unelevated_interactive\":" <<
            (expected.eligible ? "true" : "false") << ",\"authority_effect\":false}\n";
    });
    run("thread_impersonation_never_falls_back_to_process_identity", [] {
        impersonating([] { auto user = GuardianOriginalInstallUser::captureCurrentBeforeElevation();
            require(user && field(user->snapshotJson(), "reason") == "ORIGINAL_CAPTURE_THREAD_IMPERSONATING", "impersonated_capture_used_process_fallback"); hidden(*user); });
    });
    run("request_cancel_hides_facts_before_recheck", [] {
        auto user = GuardianOriginalInstallUser::captureCurrentBeforeElevation(); user->requestCancel(); hidden(*user);
        require(!user->recheck(), "cancelled_original_user_rechecked");
    });
    run("close_is_idempotent_and_cannot_rearm", [] {
        auto user = GuardianOriginalInstallUser::captureCurrentBeforeElevation(); user->close(); user->close(); user->requestCancel(); hidden(*user);
        require(!user->recheck() && !GuardianOriginalInstallUserTest::matches(*user, GetCurrentProcess()), "closed_original_user_rearmed");
    });
    run("invalid_null_and_nonpipe_handles_are_refused", [] {
        Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr)); require(event.valid(), "fixture_event_missing");
        for (HANDLE handle : {static_cast<HANDLE>(nullptr), INVALID_HANDLE_VALUE, event.value}) {
            auto server = GuardianOriginalInstallUserTest::server(handle), peer = GuardianOriginalInstallUserTest::client(handle);
            require(server && peer && !server->recheck() && !peer->recheck(), "invalid_handle_became_original_user"); hidden(*server); hidden(*peer);
        }
    });
    run("unconnected_pipe_cannot_bind_original_user", [] {
        Pipe pipe; pipe.create(); auto user = GuardianOriginalInstallUserTest::client(pipe.server.value);
        require(user && !user->recheck(), "unconnected_pipe_became_original_user"); hidden(*user);
    });
    run("wrong_pipe_side_cannot_bind_original_user", [] {
        Pipe pipe; pipe.open(); pipe.message();
        auto server = GuardianOriginalInstallUserTest::server(pipe.server.value), peer = GuardianOriginalInstallUserTest::client(pipe.connected.value);
        require(server && peer && !server->recheck() && !peer->recheck(), "wrong_pipe_side_was_accepted"); hidden(*server); hidden(*peer);
    });
    run("actual_connected_server_identity_matches_original_token", [] {
        interactiveOnly(); const auto expected = oracle(); Pipe pipe; pipe.open(); pipe.message();
        auto user = GuardianOriginalInstallUserTest::server(pipe.connected.value); observed(*user, expected, GetCurrentProcessId(), expected.created);
        require(GuardianOriginalInstallUserTest::matches(*user, GetCurrentProcess()), "original_process_handle_mismatch");
        Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr)); require(!GuardianOriginalInstallUserTest::matches(*user, event.value), "foreign_object_became_original_process");
    });
    run("completed_client_message_token_is_original_and_reverted", [] {
        interactiveOnly(); const auto expected = oracle(); Pipe pipe; pipe.open(); pipe.message();
        auto user = GuardianOriginalInstallUserTest::client(pipe.server.value); observed(*user, expected, GetCurrentProcessId(), expected.created);
        HANDLE raw = nullptr; const BOOL opened = OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, TRUE, &raw); const DWORD error = GetLastError(); Handle unexpected(raw);
        require(!opened && error == ERROR_NO_TOKEN, "capture_left_caller_impersonating");
    });
    run("original_client_handle_is_retained_after_caller_close", [] {
        interactiveOnly(); const auto expected = oracle(); Pipe pipe; pipe.open(); pipe.message();
        auto user = GuardianOriginalInstallUserTest::server(pipe.connected.value); pipe.connected.reset();
        observed(*user, expected, GetCurrentProcessId(), expected.created);
    });
    run("disconnected_original_client_never_rechecks", [] {
        interactiveOnly(); Pipe pipe; pipe.open(); pipe.message(); auto user = GuardianOriginalInstallUserTest::server(pipe.connected.value);
        require(user && user->recheck(), "fixture_initial_identity_unavailable"); pipe.disconnect();
        require(!user->recheck(), "disconnected_original_user_accepted"); hidden(*user);
    });
    run("same_name_pid_and_birth_reconnect_cannot_revive_original_client", [] {
        interactiveOnly(); Pipe pipe; pipe.open(); pipe.message(); auto original = GuardianOriginalInstallUserTest::server(pipe.connected.value);
        require(original && original->recheck(), "fixture_original_identity_unavailable"); pipe.disconnect(); pipe.connected.reset(); pipe.connect(); pipe.message();
        auto replacement = GuardianOriginalInstallUserTest::server(pipe.connected.value); require(replacement && replacement->recheck(), "fixture_replacement_unavailable");
        require(!original->recheck(), "same_name_reconnection_revived_original"); hidden(*original);
    });
    run("observed_server_disconnect_is_permanently_latched", [] {
        interactiveOnly(); Pipe pipe; pipe.open(); pipe.message(); auto original = GuardianOriginalInstallUserTest::client(pipe.server.value);
        require(original && original->recheck(), "fixture_server_identity_unavailable"); pipe.disconnect();
        require(!original->recheck(), "server_disconnect_was_not_observed"); pipe.connected.reset(); pipe.connect(); pipe.message();
        require(!original->recheck(), "observed_server_disconnect_was_revived"); hidden(*original);
    });
    run("thread_impersonation_revokes_current_observation", [] {
        interactiveOnly(); auto user = GuardianOriginalInstallUser::captureCurrentBeforeElevation(); require(user && user->recheck(), "fixture_self_identity_unavailable");
        impersonating([&] { require(!user->recheck(), "impersonating_recheck_accepted"); hidden(*user); });
    });
    run("original_child_server_exit_revokes_retained_process", [] {
        interactiveOnly(); const auto expected = oracle(); Child child; child.start(); const auto created = birth(child.process.value);
        auto user = GuardianOriginalInstallUserTest::server(child.connected.value); observed(*user, expected, child.pid, created);
        require(GuardianOriginalInstallUserTest::matches(*user, child.process.value) && !GuardianOriginalInstallUserTest::matches(*user, GetCurrentProcess()),
            "foreign_pid_became_original_child");
        child.connected.reset(); child.exit(); require(!user->recheck(), "dead_original_child_rechecked"); hidden(*user);
    });
    run("concurrent_cancel_leaves_no_current_identity", [] {
        auto user = GuardianOriginalInstallUser::captureCurrentBeforeElevation();
        std::atomic<bool> ready{false}; std::thread worker([&] { ready.store(true); for (unsigned i = 0; i < 64; ++i) user->recheck(); });
        while (!ready.load()) { std::this_thread::yield(); }
        user->requestCancel(); worker.join();
        require(!user->recheck(), "concurrent_cancel_did_not_revoke"); hidden(*user);
    });
    std::cout << "{\"name\":\"summary\",\"schema\":\"metaengine.guardian.original-install-user-mechanics.v1\",\"state\":\""
        << (failed ? "FAIL" : "PASS") << "\",\"tests_passed\":" << passed << ",\"tests_failed\":" << failed << ",\"tests_skipped\":" << skipped
        << ",\"runtime\":\"WINDOWS_NATIVE_PROCESS_TOKEN_PIPE\",\"qualification\":\"MECHANICS_ONLY_NOT_AUTHORIZED_INSTALLATION\",\"authority_effect\":false}"
        << "\n";
    return failed ? 1 : 0;
}
