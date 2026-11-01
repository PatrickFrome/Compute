#ifndef METAENGINE_GUARDIAN_INSTALL_ORIGIN_TEST
#error This mechanics probe requires the private install-origin test friend.
#endif

#include "browser-guardian-install-origin-link.hpp"
#include "browser-guardian-install-origin-wire.hpp"
#include "browser-guardian-owner-enrollment-observer.hpp"

#include <bcrypt.h>
#include <algorithm>
#include <array>
#include <exception>
#include <functional>
#include <iostream>
#include <memory>
#include <regex>
#include <stdexcept>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <vector>

namespace metaengine::guardian {
struct GuardianInstallOriginLinkTest {
    static std::wstring route(const GuardianInstallOriginLink& link) { return link.routingIdForTest(); }
    static bool connect(GuardianInstallOriginLink& link, HANDLE original) { return link.connectOriginalBootstrap(original); }
    static unsigned pending(const GuardianInstallOriginLink& link) { return link.pendingOperationForTest(); }
    static void wakeEarly(GuardianInstallOriginLink& link) { link.wakePendingEventEarlyForTest(); }
};
}

namespace {
using metaengine::guardian::GuardianInstallOriginLink;
using metaengine::guardian::GuardianInstallOriginLinkTest;
using metaengine::guardian::OwnerEnrollmentPipe;
using metaengine::guardian::detail::InstallOriginChallenge;
using metaengine::guardian::detail::InstallOriginFrame;
using metaengine::guardian::detail::InstallOriginRole;
constexpr DWORD kClientAccess = FILE_READ_DATA | FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | SYNCHRONIZE;

struct Handle {
    HANDLE value = INVALID_HANDLE_VALUE;
    explicit Handle(HANDLE raw = INVALID_HANDLE_VALUE) : value(raw) {}
    ~Handle() { reset(); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    Handle(Handle&& other) noexcept : value(std::exchange(other.value, INVALID_HANDLE_VALUE)) {}
    Handle& operator=(Handle&& other) noexcept {
        if (this != &other) reset(std::exchange(other.value, INVALID_HANDLE_VALUE));
        return *this;
    }
    bool valid() const { return value && value != INVALID_HANDLE_VALUE; }
    void reset(HANDLE next = INVALID_HANDLE_VALUE) { if (valid()) CloseHandle(value); value = next; }
};
struct Skip {};
void require(bool value, const char* reason) { if (!value) throw std::runtime_error(reason); }
std::string field(const std::string& json, const std::string& name) {
    std::smatch match;
    require(std::regex_search(json, match, std::regex("\"" + name + "\":\"([^\"]*)\"")), "snapshot_field_missing");
    return match[1].str();
}
std::uint64_t number(const std::string& json, const std::string& name) {
    std::smatch match;
    require(std::regex_search(json, match, std::regex("\"" + name + "\":([0-9]+)")), "snapshot_number_missing");
    return std::stoull(match[1].str());
}
std::vector<BYTE> tokenData(HANDLE token, TOKEN_INFORMATION_CLASS kind) {
    DWORD bytes = 0; GetTokenInformation(token, kind, nullptr, 0, &bytes);
    require(GetLastError() == ERROR_INSUFFICIENT_BUFFER && bytes, "oracle_token_size_unavailable");
    std::vector<BYTE> out(bytes);
    require(GetTokenInformation(token, kind, out.data(), bytes, &bytes) != FALSE, "oracle_token_data_unavailable");
    return out;
}
bool actualUnelevatedInteractiveUser() {
    HANDLE raw = nullptr; require(OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw) != FALSE, "oracle_primary_token_unavailable");
    Handle token(raw); DWORD written = 0, app_container = 1, session = 0, process_session = MAXDWORD;
    TOKEN_STATISTICS stats{}; TOKEN_ELEVATION elevation{};
    require(GetTokenInformation(token.value, TokenStatistics, &stats, sizeof(stats), &written) != FALSE, "oracle_token_statistics_unavailable");
    require(GetTokenInformation(token.value, TokenElevation, &elevation, sizeof(elevation), &written) != FALSE, "oracle_elevation_unavailable");
    require(GetTokenInformation(token.value, TokenIsAppContainer, &app_container, sizeof(app_container), &written) != FALSE, "oracle_appcontainer_unavailable");
    require(GetTokenInformation(token.value, TokenSessionId, &session, sizeof(session), &written) != FALSE &&
        ProcessIdToSessionId(GetCurrentProcessId(), &process_session), "oracle_session_unavailable");
    const auto user_data = tokenData(token.value, TokenUser);
    const auto user = reinterpret_cast<const TOKEN_USER*>(user_data.data())->User.Sid;
    const auto label_data = tokenData(token.value, TokenIntegrityLevel);
    const auto label = reinterpret_cast<const TOKEN_MANDATORY_LABEL*>(label_data.data())->Label.Sid;
    require(IsValidSid(user) && IsValidSid(label) && *GetSidSubAuthorityCount(label), "oracle_integrity_or_user_invalid");
    const DWORD level = *GetSidSubAuthority(label, *GetSidSubAuthorityCount(label) - 1);
    const auto group_data = tokenData(token.value, TokenGroups);
    const auto* groups = reinterpret_cast<const TOKEN_GROUPS*>(group_data.data());
    unsigned logon_groups = 0;
    for (DWORD i = 0; i < groups->GroupCount; ++i)
        if ((groups->Groups[i].Attributes & SE_GROUP_LOGON_ID) == SE_GROUP_LOGON_ID && IsValidSid(groups->Groups[i].Sid)) ++logon_groups;
    return stats.TokenType == TokenPrimary && (stats.AuthenticationId.LowPart || stats.AuthenticationId.HighPart) &&
        !elevation.TokenIsElevated && !app_container && !IsTokenRestricted(token.value) && session && session == process_session &&
        level >= SECURITY_MANDATORY_MEDIUM_RID && level < SECURITY_MANDATORY_HIGH_RID && logon_groups == 1 &&
        !IsWellKnownSid(user, WinLocalSystemSid) && !IsWellKnownSid(user, WinLocalServiceSid) && !IsWellKnownSid(user, WinNetworkServiceSid);
}
void noAuthority(const std::string& json) {
    require(field(json, "schema") == "metaengine.browser-guardian.install-origin-link.v1" && field(json, "state") == "HOLD",
        "link_diagnostic_promoted");
    require(field(json, "release_binding") == "UNQUALIFIED" && field(json, "purpose") == "INSTALL_ORIGIN_OBSERVATION_ONLY_V1",
        "source_only_became_release_proof");
    for (const char* key : {"uac_requested", "main_launch_implemented", "scm_transfer_implemented", "authority_effect"}) {
        std::smatch match;
        require(std::regex_search(json, match, std::regex(std::string("\"") + key + "\":(true|false)")) && match[1] == "false",
            "link_claimed_effect");
    }
}
InstallOriginChallenge challenge() {
    InstallOriginChallenge out{};
    require(BCryptGenRandom(nullptr, out.data(), static_cast<ULONG>(out.size()), BCRYPT_USE_SYSTEM_PREFERRED_RNG) >= 0,
        "test_cng_nonce_failed");
    require(metaengine::guardian::detail::validInstallOriginChallenge(out), "test_cng_nonce_zero");
    return out;
}
std::wstring encode(const InstallOriginChallenge& bytes) {
    constexpr wchar_t hex[] = L"0123456789abcdef";
    std::wstring out;
    for (auto byte : bytes) { out += hex[byte >> 4]; out += hex[byte & 15]; }
    return out;
}
InstallOriginChallenge decode(std::wstring_view id) {
    require(id.size() == 64, "test_route_size");
    InstallOriginChallenge out{};
    const auto digit = [](wchar_t c) { return c <= L'9' ? c - L'0' : c - L'a' + 10; };
    for (std::size_t i = 0; i < out.size(); ++i) out[i] = static_cast<std::uint8_t>((digit(id[i * 2]) << 4) | digit(id[i * 2 + 1]));
    return out;
}
std::wstring pipeName(const std::wstring& id) { return L"\\\\.\\pipe\\METAENGINEGuardianInstallOriginV1-" + id; }
Handle client(const std::wstring& id) {
    Handle out(CreateFileW(pipeName(id).c_str(), kClientAccess, 0, nullptr, OPEN_EXISTING,
        FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, nullptr));
    require(out.valid(), "test_pipe_client_open_failed");
    return out;
}

struct PendingIo {
    HANDLE pipe;
    Handle event{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
    OVERLAPPED operation{};
    bool pending = false;
    explicit PendingIo(HANDLE value) : pipe(value) {
        require(event.valid(), "test_io_event_failed"); operation.hEvent = event.value;
    }
    ~PendingIo() {
        if (pending) { CancelIoEx(pipe, &operation); DWORD ignored = 0; GetOverlappedResult(pipe, &operation, &ignored, TRUE); }
    }
    DWORD finish(BOOL immediate, bool connected = false) {
        const DWORD error = immediate ? ERROR_SUCCESS : GetLastError();
        if (connected && error == ERROR_PIPE_CONNECTED) return 0;
        if (!immediate) {
            require(error == ERROR_IO_PENDING, "test_io_not_pending"); pending = true;
            require(WaitForSingleObject(event.value, 5'000) == WAIT_OBJECT_0, "test_io_timeout");
        }
        DWORD bytes = 0;
        require(GetOverlappedResult(pipe, &operation, &bytes, FALSE) != FALSE, "test_io_readback_failed");
        pending = false; return bytes;
    }
};
void writePacket(HANDLE pipe, const std::vector<std::uint8_t>& data) {
    PendingIo io(pipe); DWORD bytes = 0;
    const BOOL immediate = WriteFile(pipe, data.data(), static_cast<DWORD>(data.size()), &bytes, &io.operation);
    require(io.finish(immediate) == data.size(), "test_packet_write_short");
}

class ObserverFixture {
public:
    std::unique_ptr<GuardianInstallOriginLink> link = GuardianInstallOriginLink::createBootstrapObserver();
    Handle done{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
    Handle bound{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
    std::thread worker;
    bool result = false;
    bool terminal_close = false;
    std::string bound_snapshot;
    std::exception_ptr failure;
    ~ObserverFixture() { link->requestCancel(); if (worker.joinable()) worker.join(); link->close(); }
    void start(const std::wstring& id, bool retain_until_client_close = false) {
        require(done.valid() && bound.valid(), "test_done_event_failed");
        worker = std::thread([this, id, retain_until_client_close] {
            try {
                result = link->observeOriginalCoordinator(id);
                if (result && retain_until_client_close) {
                    bound_snapshot = link->snapshotJson(); SetEvent(bound.value);
                    terminal_close = link->waitForOriginalCoordinatorClose();
                }
            } catch (...) { failure = std::current_exception(); }
            SetEvent(done.value);
        });
    }
    void waitBound() {
        HANDLE waits[] = {bound.value, done.value};
        require(WaitForMultipleObjects(2, waits, FALSE, 5'000) == WAIT_OBJECT_0, "bound_original_lifetime_not_observed");
    }
    void waitPending(unsigned operation) {
        const auto until = GetTickCount64() + 5'000;
        while (GuardianInstallOriginLinkTest::pending(*link) != operation && GetTickCount64() < until) {
            require(WaitForSingleObject(done.value, 0) == WAIT_TIMEOUT, "observer_finished_before_pending_io");
            Sleep(1);
        }
        require(GuardianInstallOriginLinkTest::pending(*link) == operation, "actual_pending_io_not_observed");
    }
    void join(DWORD timeout = 5'000) {
        const DWORD wait = WaitForSingleObject(done.value, timeout);
        if (wait != WAIT_OBJECT_0) link->requestCancel();
        if (worker.joinable()) worker.join();
        require(wait == WAIT_OBJECT_0, "observer_completion_timeout");
        if (failure) std::rethrow_exception(failure);
        require(GuardianInstallOriginLinkTest::pending(*link) == 0, "native_pending_io_storage_not_joined");
    }
};

std::unique_ptr<GuardianInstallOriginLink> eligibleCoordinator() {
    const bool actual_eligible = actualUnelevatedInteractiveUser();
    auto out = GuardianInstallOriginLink::captureCoordinatorBeforeElevation();
    noAuthority(out->snapshotJson());
    if (GuardianInstallOriginLinkTest::route(*out).empty()) {
        require(!actual_eligible && field(out->snapshotJson(), "reason") == "TARGET_USER_BINDING_REQUIRED", "unexpected_current_user_capture_failure");
        throw Skip{};
    }
    require(actual_eligible, "ineligible_current_user_became_original_coordinator");
    return out;
}
void rejectHello(const std::function<void(std::vector<std::uint8_t>&)>& mutate) {
    const auto nonce = challenge(); const auto id = encode(nonce);
    ObserverFixture observer; observer.start(id); observer.waitPending(1);
    Handle connected = client(id); observer.waitPending(2);
    const auto frame = metaengine::guardian::detail::makeInstallOriginFrame(InstallOriginRole::Coordinator, nonce);
    std::vector<std::uint8_t> bytes(frame.begin(), frame.end()); mutate(bytes);
    writePacket(connected.value, bytes); observer.join();
    require(!observer.result, "invalid_hello_became_bound_origin");
    const auto json = observer.link->snapshotJson(); noAuthority(json);
    require(field(json, "reason") == "INSTALL_ORIGIN_HELLO_INVALID" && json.find("\"original_user\":null") != std::string::npos,
        "invalid_hello_reached_user_capture");
}

// A disposable native server for malicious REPLY fixtures. It stays alive until
// the original coordinator read finishes, so closing the fixture cannot explain
// rejection of an overlong/altered message.
class ReplyFixture {
public:
    OwnerEnrollmentPipe server;
    Handle done{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
    Handle stop{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
    std::thread worker;
    std::exception_ptr failure;
    explicit ReplyFixture(const std::wstring& id, std::vector<std::uint8_t> reply) {
        require(done.valid() && stop.valid() && server.create(pipeName(id)), "reply_fixture_create_failed");
        worker = std::thread([this, id, reply = std::move(reply)] {
            try {
                PendingIo connect(server.handle()); connect.finish(ConnectNamedPipe(server.handle(), &connect.operation), true);
                InstallOriginFrame hello{}; PendingIo read(server.handle()); DWORD bytes = 0;
                const BOOL immediate = ReadFile(server.handle(), hello.data(), static_cast<DWORD>(hello.size()), &bytes, &read.operation);
                require(read.finish(immediate) == hello.size() &&
                    metaengine::guardian::detail::matchesInstallOriginFrame(hello, InstallOriginRole::Coordinator, decode(id)),
                    "reply_fixture_hello_unconfirmed");
                writePacket(server.handle(), reply);
                require(WaitForSingleObject(stop.value, 5'000) == WAIT_OBJECT_0, "reply_fixture_stop_timeout");
            } catch (...) { failure = std::current_exception(); }
            SetEvent(done.value);
        });
    }
    ~ReplyFixture() { SetEvent(stop.value); if (worker.joinable()) worker.join(); }
    void finish() {
        SetEvent(stop.value);
        require(WaitForSingleObject(done.value, 5'000) == WAIT_OBJECT_0, "reply_fixture_completion_timeout");
        if (worker.joinable()) worker.join();
        if (failure) std::rethrow_exception(failure);
    }
};
void rejectReply(const std::function<void(std::vector<std::uint8_t>&)>& mutate) {
    auto coordinator = eligibleCoordinator();
    const auto id = GuardianInstallOriginLinkTest::route(*coordinator);
    const auto frame = metaengine::guardian::detail::makeInstallOriginFrame(InstallOriginRole::Bootstrap, decode(id));
    std::vector<std::uint8_t> reply(frame.begin(), frame.end()); mutate(reply);
    const bool oversized = reply.size() > InstallOriginFrame{}.size();
    ReplyFixture fixture(id, std::move(reply));
    require(WaitNamedPipeW(pipeName(id).c_str(), 5'000) != FALSE, "reply_fixture_pipe_not_ready");
    require(!GuardianInstallOriginLinkTest::connect(*coordinator, GetCurrentProcess()), "invalid_reply_accepted");
    fixture.finish();
    const auto json = coordinator->snapshotJson(); noAuthority(json);
    require(field(json, "kernel_binding") == "UNPROVEN" &&
        field(json, "reason") == (oversized ? "INSTALL_ORIGIN_IO_UNCONFIRMED" : "INSTALL_ORIGIN_REPLY_INVALID"), "invalid_reply_retained_binding");
    require(number(json, "win32_error") == (oversized ? ERROR_MORE_DATA : ERROR_INVALID_DATA), "reply_rejection_lost_exact_kernel_or_frame_error");
    require(!GuardianInstallOriginLinkTest::connect(*coordinator, GetCurrentProcess()), "failed_coordinator_reconnected");
}

unsigned passed = 0, failed = 0, skipped = 0;
void run(const char* name, const std::function<void()>& body) {
    try { body(); ++passed; std::cout << "{\"name\":\"" << name << "\",\"state\":\"PASS\"}\n"; }
    catch (const Skip&) { ++skipped; std::cout << "{\"name\":\"" << name << "\",\"state\":\"SKIP\",\"reason\":\"NO_ACTUAL_UNELEVATED_INTERACTIVE_ORIGIN\"}\n"; }
    catch (const std::exception& error) { ++failed; std::cout << "{\"name\":\"" << name << "\",\"state\":\"FAIL\",\"reason\":\"" << error.what() << "\",\"win32_error\":" << GetLastError() << "}\n"; }
}
}

int wmain(int argc, wchar_t**) {
    if (argc != 1) return 2;
    run("routing_accepts_no_identity_json_path_or_zero_nonce", [] {
        for (const auto& invalid : std::vector<std::wstring>{L"", L"{\"pid\":4,\"sid\":\"S-1-5-18\"}", L"C:\\foreign\\installer.exe",
                std::wstring(64, L'0'), std::wstring(64, L'A'), std::wstring(63, L'1'), std::wstring(65, L'1')}) {
            auto scope = GuardianInstallOriginLink::createBootstrapObserver();
            require(!scope->observeOriginalCoordinator(invalid), "invalid_routing_became_install_identity");
            noAuthority(scope->snapshotJson());
        }
    });
    run("cancel_before_listen_never_opens_route", [] {
        auto scope = GuardianInstallOriginLink::createBootstrapObserver(); const auto id = encode(challenge());
        scope->requestCancel();
        require(!scope->observeOriginalCoordinator(id), "cancelled_observer_opened_pipe");
        require(!WaitNamedPipeW(pipeName(id).c_str(), 0) && GetLastError() == ERROR_FILE_NOT_FOUND, "cancelled_route_exists");
        noAuthority(scope->snapshotJson());
    });
    run("actual_pending_connect_cancel_joins_before_close", [] {
        ObserverFixture observer; observer.start(encode(challenge())); observer.waitPending(1);
        const auto before = GetTickCount64(); observer.link->requestCancel();
        require(GetTickCount64() - before < 2'000, "cancel_waited_for_operation_mutex");
        observer.link->close(); observer.join();
        require(!observer.result, "cancelled_connect_became_binding"); noAuthority(observer.link->snapshotJson());
        observer.link->close();
    });
    run("actual_pending_read_cancel_joins_before_close", [] {
        ObserverFixture observer; const auto id = encode(challenge()); observer.start(id); observer.waitPending(1);
        Handle connected = client(id); observer.waitPending(2); observer.link->requestCancel();
        observer.link->close(); observer.join();
        require(!observer.result, "cancelled_read_became_binding"); noAuthority(observer.link->snapshotJson());
    });
    run("premature_pending_event_wake_still_joins_original_io", [] {
        ObserverFixture observer; GuardianInstallOriginLinkTest::wakeEarly(*observer.link);
        // The production join deliberately retains storage across its 5s poll
        // when a spurious signalled event precedes terminal kernel status.
        observer.start(encode(challenge())); observer.join(12'000);
        require(!observer.result && GuardianInstallOriginLinkTest::pending(*observer.link) == 0,
            "premature_event_escaped_pending_storage");
        noAuthority(observer.link->snapshotJson()); observer.link->close();
    });
    run("peer_close_before_message_is_not_origin_absence_or_binding", [] {
        ObserverFixture observer; const auto id = encode(challenge()); observer.start(id); observer.waitPending(1);
        Handle connected = client(id); observer.waitPending(2); connected.reset(); observer.join();
        require(!observer.result, "closed_peer_became_binding"); noAuthority(observer.link->snapshotJson());
    });
    run("wrong_purpose_hello_refused_before_identity", [] { rejectHello([](auto& bytes) { bytes[0] ^= 1; }); });
    run("wrong_role_hello_refused_before_identity", [] { rejectHello([](auto& bytes) { bytes[33] = 2; }); });
    run("wrong_nonce_hello_refused_before_identity", [] { rejectHello([](auto& bytes) { bytes[48] ^= 1; }); });
    run("oversized_hello_refused_before_identity", [] { rejectHello([](auto& bytes) { bytes.push_back(0); }); });
    run("forged_identity_json_refused_before_identity", [] { rejectHello([](auto& bytes) {
        const std::string forged = "{\"pid\":4,\"sid\":\"S-1-5-18\",\"verified\":true}";
        bytes.assign(80, 0); std::copy(forged.begin(), forged.end(), bytes.begin());
    }); });
    run("failed_observer_cannot_rearm_or_substitute_route", [] {
        ObserverFixture observer; const auto id = encode(challenge()); observer.start(id); observer.waitPending(1);
        observer.link->requestCancel(); observer.join();
        require(!observer.link->observeOriginalCoordinator(encode(challenge())), "cancelled_observer_rearmed");
        noAuthority(observer.link->snapshotJson());
    });
    run("observer_and_source_only_coordinator_cannot_authorize_uac", [] {
        auto observer = GuardianInstallOriginLink::createBootstrapObserver();
        require(!observer->requestElevation(), "observer_requested_uac"); noAuthority(observer->snapshotJson());
        auto coordinator = GuardianInstallOriginLink::captureCoordinatorBeforeElevation();
        require(!coordinator->requestElevation(), "source_only_requested_uac"); noAuthority(coordinator->snapshotJson());
        require(!coordinator->requestElevation(), "release_refusal_retried_uac"); noAuthority(coordinator->snapshotJson());
    });
    run("actual_kernel_binding_retains_original_user_but_never_execution_proof", [] {
        auto coordinator = eligibleCoordinator(); const auto id = GuardianInstallOriginLinkTest::route(*coordinator);
        ObserverFixture observer; observer.start(id, true); observer.waitPending(1);
        require(GuardianInstallOriginLinkTest::connect(*coordinator, GetCurrentProcess()), "actual_link_kernel_binding_failed");
        observer.waitBound(); observer.waitPending(2);
        const auto json = observer.bound_snapshot; noAuthority(json); noAuthority(coordinator->snapshotJson());
        require(field(json, "kernel_binding") == "EXACT" && field(json, "identity_binding") == "RETAINED" &&
            number(json, "original_pid") == GetCurrentProcessId(), "original_user_not_native_current_process");
        FILETIME created{}, exited{}, kernel{}, user{}; require(GetProcessTimes(GetCurrentProcess(), &created, &exited, &kernel, &user) != FALSE, "oracle_birth_failed");
        ULARGE_INTEGER birth{}; birth.LowPart = created.dwLowDateTime; birth.HighPart = created.dwHighDateTime;
        require(field(json, "original_creation_time_100ns") == std::to_string(birth.QuadPart), "original_birth_not_exact");
        std::cout << "{\"name\":\"actual_original_user\",\"snapshot\":" << json << "}\n";
        coordinator->requestCancel();
        require(field(coordinator->snapshotJson(), "kernel_binding") == "UNPROVEN", "cancelled_link_kept_current_binding");
        require(!GuardianInstallOriginLinkTest::connect(*coordinator, GetCurrentProcess()), "completed_original_connection_replaced");
        coordinator->close(); observer.join();
        require(observer.result && observer.terminal_close && field(observer.link->snapshotJson(), "reason") == "ORIGINAL_COORDINATOR_CONNECTION_CLOSED",
            "native_original_eof_lifetime_unconfirmed");
        require(field(observer.link->snapshotJson(), "kernel_binding") == "UNPROVEN", "closed_original_connection_kept_binding");
        noAuthority(observer.link->snapshotJson());
    });
    run("bound_original_pending_close_read_cancel_still_joins", [] {
        auto coordinator = eligibleCoordinator(); const auto id = GuardianInstallOriginLinkTest::route(*coordinator);
        ObserverFixture observer; observer.start(id, true); observer.waitPending(1);
        require(GuardianInstallOriginLinkTest::connect(*coordinator, GetCurrentProcess()), "cancel_fixture_binding_failed");
        observer.waitBound(); observer.waitPending(2); observer.link->requestCancel(); observer.link->close(); observer.join();
        require(observer.result && !observer.terminal_close, "cancelled_terminal_read_became_eof_ack");
        noAuthority(observer.link->snapshotJson()); coordinator->close();
    });
    run("wrong_role_reply_cannot_authenticate_bootstrap", [] { rejectReply([](auto& bytes) { bytes[33] = 1; }); });
    run("wrong_nonce_reply_cannot_authenticate_bootstrap", [] { rejectReply([](auto& bytes) { bytes[79] ^= 1; }); });
    run("oversized_reply_cannot_authenticate_80_byte_prefix", [] { rejectReply([](auto& bytes) { bytes.push_back(0); }); });
    run("nonprocess_original_handle_cannot_become_bootstrap", [] {
        auto coordinator = eligibleCoordinator(); Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
        require(event.valid() && !GuardianInstallOriginLinkTest::connect(*coordinator, event.value), "nonprocess_handle_bound");
        noAuthority(coordinator->snapshotJson());
        require(!GuardianInstallOriginLinkTest::connect(*coordinator, GetCurrentProcess()), "failed_handle_was_replaced");
    });
    std::cout << "{\"name\":\"summary\",\"schema\":\"metaengine.guardian.install-origin-link-mechanics.v1\",\"state\":\"" <<
        (failed ? "FAIL" : "PASS") << "\",\"tests_passed\":" << passed << ",\"tests_failed\":" << failed << ",\"tests_skipped\":" << skipped <<
        ",\"runtime\":\"WINDOWS_NATIVE_PIPE_KERNEL\",\"qualification\":\"MECHANICS_ONLY_NOT_INSTALL_AUTHORITY\",\"release_binding\":\"UNQUALIFIED\","
        "\"uac_exercised\":false,\"scm_exercised\":false,\"main_launch_exercised\":false,\"authority_effect\":false}\n";
    return failed ? 1 : 0;
}
