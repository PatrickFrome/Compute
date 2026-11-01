#include "browser-guardian-install-origin-link.hpp"
#include "browser-guardian-original-install-user.hpp"
#include "browser-guardian-install-origin-wire.hpp"
#include "browser-guardian-owner-enrollment-observer.hpp"
#include "browser-guardian-pipe-io-lifetime.hpp"

#include <bcrypt.h>
#include <array>
#include <mutex>
#include <utility>

namespace metaengine::guardian {
namespace {
using detail::InstallOriginChallenge;
using detail::InstallOriginFrame;
using detail::InstallOriginRole;
constexpr wchar_t kPrefix[] = L"\\\\.\\pipe\\METAENGINEGuardianInstallOriginV1-";
constexpr DWORD kTimeoutMs = 15'000;
constexpr DWORD kAvailabilityPollMs = 50;
constexpr DWORD kClientAccess = FILE_READ_DATA | FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | SYNCHRONIZE;
struct Handle {
    HANDLE value = nullptr;
    explicit Handle(HANDLE h = nullptr) : value(h) {}
    ~Handle() { reset(); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    bool valid() const { return value && value != INVALID_HANDLE_VALUE; }
    void reset(HANDLE next = nullptr) { if (valid()) CloseHandle(value); value = next; }
};
std::uint64_t ticks(FILETIME time) {
    ULARGE_INTEGER out{}; out.LowPart = time.dwLowDateTime; out.HighPart = time.dwHighDateTime; return out.QuadPart;
}
std::wstring image(HANDLE process) {
    std::array<wchar_t, 32768> bytes{}; DWORD count = static_cast<DWORD>(bytes.size());
    return QueryFullProcessImageNameW(process, 0, bytes.data(), &count) && count && count < bytes.size()
        ? std::wstring(bytes.data(), count) : std::wstring{};
}
std::wstring encode(const InstallOriginChallenge& bytes) {
    constexpr wchar_t hex[] = L"0123456789abcdef";
    std::wstring out; out.reserve(64);
    for (auto byte : bytes) { out += hex[byte >> 4]; out += hex[byte & 15]; }
    return out;
}
bool decode(std::wstring_view text, InstallOriginChallenge* bytes) {
    if (text.size() != 64) return false;
    const auto digit = [](wchar_t c) -> int { return c >= L'0' && c <= L'9' ? c - L'0' : c >= L'a' && c <= L'f' ? c - L'a' + 10 : -1; };
    for (std::size_t i = 0; i < bytes->size(); ++i) {
        const int a = digit(text[i * 2]), b = digit(text[i * 2 + 1]);
        if (a < 0 || b < 0) return false;
        (*bytes)[i] = static_cast<std::uint8_t>((a << 4) | b);
    }
    return detail::validInstallOriginChallenge(*bytes);
}
}

struct GuardianInstallOriginLink::State {
    mutable std::mutex mutex;
    // Stable through close; requestCancel never races a recycled event handle.
    Handle cancelled{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
    Handle client_pipe;
    std::unique_ptr<OwnerEnrollmentPipe> server_pipe;
    Handle bootstrap_process;
    std::unique_ptr<GuardianOriginalInstallUser> origin;
    detail::InstallOriginFence fence;
    InstallOriginChallenge challenge{};
    std::wstring routing_id;
    DWORD bootstrap_pid = 0;
    std::uint64_t bootstrap_birth = 0;
    std::wstring bootstrap_image;
    bool is_coordinator = false;
    bool closed = false;
    bool attempted = false;
    bool connection_attempted = false;
    bool kernel_bound = false;
    std::string reason = "INSTALL_ORIGIN_NOT_CAPTURED";
    DWORD error = ERROR_SUCCESS;
#ifdef METAENGINE_GUARDIAN_INSTALL_ORIGIN_TEST
    std::atomic<unsigned> pending_for_test{0};
    std::atomic<bool> wake_early_for_test{false};
    // Observation-only latch for a completed real availability wait slice.
    // Stable through close and never consulted by production decisions.
    Handle initial_availability_for_test{CreateEventW(nullptr, TRUE, FALSE, nullptr)};
#endif

    bool fail(const char* why, DWORD code = ERROR_SUCCESS) {
        const DWORD observed_error = code != ERROR_SUCCESS ? code : GetLastError();
        kernel_bound = false; reason = why;
        error = observed_error;
        if (error == ERROR_SUCCESS) error = ERROR_INVALID_DATA;
        return false;
    }
    bool active() const {
        return !closed && cancelled.valid() && !fence.cancelled() && WaitForSingleObject(cancelled.value, 0) == WAIT_TIMEOUT;
    }
    bool completeIo(HANDLE pipe, OVERLAPPED* operation, BOOL immediate, DWORD* bytes) {
        bool was_pending = false;
        if (!immediate) {
            if (GetLastError() != ERROR_IO_PENDING) return false;
            was_pending = true;
#ifdef METAENGINE_GUARDIAN_INSTALL_ORIGIN_TEST
            if (wake_early_for_test.exchange(false, std::memory_order_acq_rel)) SetEvent(operation->hEvent);
#endif
            HANDLE waits[] = {cancelled.value, operation->hEvent};
            const DWORD result = WaitForMultipleObjects(2, waits, FALSE, kTimeoutMs);
            if (result != WAIT_OBJECT_0 + 1) {
                cancelAndJoinGuardianPipeIo(pipe, operation);
                SetLastError(result == WAIT_TIMEOUT ? ERROR_TIMEOUT : ERROR_OPERATION_ABORTED);
                return false;
            }
        }
        if (GetOverlappedResult(pipe, operation, bytes, FALSE)) return true;
        const DWORD completion_error = GetLastError();
        // A signalled event is not a terminal IRP status. Keep its ORIGINAL
        // stack/event/frame storage alive through cancellation and kernel join.
        if (was_pending && !HasOverlappedIoCompleted(operation)) cancelAndJoinGuardianPipeIo(pipe, operation);
        SetLastError(completion_error);
        return false;
    }
    bool packet(HANDLE pipe, InstallOriginFrame* frame, bool write) {
        if (!active()) { SetLastError(ERROR_OPERATION_ABORTED); return false; }
        Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
        if (!event.valid()) return false;
        OVERLAPPED operation{}; operation.hEvent = event.value;
        DWORD count = 0;
        const BOOL immediate = write ? WriteFile(pipe, frame->data(), static_cast<DWORD>(frame->size()), &count, &operation)
            : ReadFile(pipe, frame->data(), static_cast<DWORD>(frame->size()), &count, &operation);
#ifdef METAENGINE_GUARDIAN_INSTALL_ORIGIN_TEST
        if (!immediate && GetLastError() == ERROR_IO_PENDING) pending_for_test.store(write ? 3U : 2U, std::memory_order_release);
#endif
        const bool completed = completeIo(pipe, &operation, immediate, &count);
#ifdef METAENGINE_GUARDIAN_INSTALL_ORIGIN_TEST
        pending_for_test.store(0, std::memory_order_release);
#endif
        if (!completed) return false;
        if (count != frame->size()) { SetLastError(ERROR_INVALID_DATA); return false; }
        if (!active()) { SetLastError(ERROR_OPERATION_ABORTED); return false; }
        return true;
    }
    bool initialBootstrapLive() {
        if (!active()) return fail("ORIGINAL_BOOTSTRAP_PIPE_WAIT_CANCELLED", ERROR_OPERATION_ABORTED);
        const DWORD lifetime = WaitForSingleObject(bootstrap_process.value, 0);
        if (lifetime != WAIT_TIMEOUT) {
            const DWORD observed_error = lifetime == WAIT_FAILED ? GetLastError()
                : lifetime == WAIT_OBJECT_0 ? ERROR_PROCESS_ABORTED : ERROR_INVALID_DATA;
            return fail(lifetime == WAIT_OBJECT_0 ? "ORIGINAL_BOOTSTRAP_PROCESS_EXITED" : "ORIGINAL_BOOTSTRAP_PROCESS_UNAVAILABLE",
                observed_error);
        }
        if (!origin || !origin->recheck()) return fail("ORIGINAL_COORDINATOR_SCOPE_UNAVAILABLE", ERROR_ACCESS_DENIED);
        if (!active()) return fail("ORIGINAL_BOOTSTRAP_PIPE_WAIT_CANCELLED", ERROR_OPERATION_ABORTED);
        return true;
    }
    bool bootstrapExact(HANDLE pipe) {
        ULONG server = 0, client = 0;
        FILETIME born{}, exited{}, kernel{}, user{};
        DWORD flags = 0;
        return active() && bootstrap_process.valid() && GetFileType(pipe) == FILE_TYPE_PIPE &&
            GetNamedPipeInfo(pipe, &flags, nullptr, nullptr, nullptr) && (flags & PIPE_TYPE_MESSAGE) && !(flags & PIPE_SERVER_END) &&
            PeekNamedPipe(pipe, nullptr, 0, nullptr, nullptr, nullptr) && GetNamedPipeClientProcessId(pipe, &client) &&
            client == GetCurrentProcessId() && GetNamedPipeServerProcessId(pipe, &server) && server == bootstrap_pid &&
            GetProcessId(bootstrap_process.value) == bootstrap_pid && WaitForSingleObject(bootstrap_process.value, 0) == WAIT_TIMEOUT &&
            GetProcessTimes(bootstrap_process.value, &born, &exited, &kernel, &user) && ticks(born) == bootstrap_birth &&
            image(bootstrap_process.value) == bootstrap_image && origin && origin->recheck();
    }
};

GuardianInstallOriginLink::GuardianInstallOriginLink() : state_(std::make_unique<State>()) {}
GuardianInstallOriginLink::~GuardianInstallOriginLink() { close(); }

std::unique_ptr<GuardianInstallOriginLink> GuardianInstallOriginLink::captureCoordinatorBeforeElevation() {
    auto out = std::unique_ptr<GuardianInstallOriginLink>(new GuardianInstallOriginLink());
    out->state_->is_coordinator = true;
    out->state_->origin = GuardianOriginalInstallUser::captureCurrentBeforeElevation();
    if (!out->state_->origin->recheck()) { out->state_->fail("TARGET_USER_BINDING_REQUIRED", ERROR_ACCESS_DENIED); return out; }
    const auto random_status = BCryptGenRandom(nullptr, out->state_->challenge.data(),
        static_cast<ULONG>(out->state_->challenge.size()), BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    if (random_status < 0) { out->state_->fail("INSTALL_ORIGIN_CHALLENGE_UNAVAILABLE", ERROR_GEN_FAILURE); return out; }
    if (!detail::validInstallOriginChallenge(out->state_->challenge)) {
        out->state_->fail("INSTALL_ORIGIN_CHALLENGE_INVALID", ERROR_INVALID_DATA); return out;
    }
    out->state_->routing_id = encode(out->state_->challenge);
    out->state_->reason = "ORIGINAL_USER_RETAINED_RELEASE_UNQUALIFIED";
    return out;
}

bool GuardianInstallOriginLink::requestElevation() {
    std::lock_guard<std::mutex> lock(state_->mutex);
    if (!state_->is_coordinator || state_->attempted || !state_->active() || !state_->origin || !state_->origin->recheck()) {
        return state_->fail("TARGET_USER_BINDING_REQUIRED", ERROR_ACCESS_DENIED);
    }
    state_->attempted = true;
    // The inspected existing W77 producer has no real protected-root signer or
    // authenticated final-artifact placement. There is no genuine native release
    // qualification object to consume here. Stop BEFORE UAC, not after launching
    // unknown code. This is not replaceable by a flag, callback or wire receipt.
    return state_->fail("INSTALL_RELEASE_SIGNING_AND_PROVENANCE_UNAVAILABLE", ERROR_NOT_SUPPORTED);
}

bool GuardianInstallOriginLink::connectOriginalBootstrap(HANDLE original_bootstrap_process) {
    std::lock_guard<std::mutex> lock(state_->mutex);
    // Private consumer of an original native-created process handle, never a PID
    // from wire. The production release gate currently prevents UAC creation;
    // mechanics fixtures can exercise this same real transport without UAC.
    if (!state_->is_coordinator || state_->connection_attempted || state_->client_pipe.valid() || !state_->active() || !state_->origin || !state_->origin->recheck())
        return state_->fail("ORIGINAL_COORDINATOR_SCOPE_UNAVAILABLE", ERROR_ACCESS_DENIED);
    state_->connection_attempted = true;
    HANDLE duplicate = nullptr;
    if (!DuplicateHandle(GetCurrentProcess(), original_bootstrap_process, GetCurrentProcess(), &duplicate, 0, FALSE, DUPLICATE_SAME_ACCESS))
        return state_->fail("ORIGINAL_BOOTSTRAP_HANDLE_UNAVAILABLE");
    state_->bootstrap_process.reset(duplicate);
    FILETIME born{}, exited{}, kernel{}, user{};
    state_->bootstrap_pid = GetProcessId(duplicate);
    if (!state_->bootstrap_pid || !GetProcessTimes(duplicate, &born, &exited, &kernel, &user) ||
        (state_->bootstrap_birth = ticks(born)) <= 116444736000000000ULL ||
        (state_->bootstrap_image = image(duplicate)).empty() || WaitForSingleObject(duplicate, 0) != WAIT_TIMEOUT)
        return state_->fail("ORIGINAL_BOOTSTRAP_PROCESS_UNAVAILABLE");
    const std::wstring pipe_name = std::wstring(kPrefix) + state_->routing_id;
    // Only initial absence/busy may be polled, on this same route and retained
    // process. This deadline does NOT bound later I/O or terminal IRP joining.
    const ULONGLONG deadline = GetTickCount64() + kTimeoutMs;
    HANDLE waits[] = {state_->cancelled.value, state_->bootstrap_process.value};
    for (;;) {
        if (!state_->initialBootstrapLive()) return false;
        if (GetTickCount64() >= deadline)
            return state_->fail("ORIGINAL_BOOTSTRAP_PIPE_AVAILABILITY_TIMEOUT", ERROR_TIMEOUT);
        const HANDLE pipe = CreateFileW(pipe_name.c_str(), kClientAccess, 0, nullptr, OPEN_EXISTING,
            FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION, nullptr);
        const DWORD open_error = pipe == INVALID_HANDLE_VALUE ? GetLastError() : ERROR_SUCCESS;
        state_->client_pipe.reset(pipe);
        if (state_->client_pipe.valid()) {
            if (GetTickCount64() >= deadline)
                return state_->fail("ORIGINAL_BOOTSTRAP_PIPE_AVAILABILITY_TIMEOUT", ERROR_TIMEOUT);
            break; // Opening any handle permanently ends availability polling.
        }
        if (open_error != ERROR_FILE_NOT_FOUND && open_error != ERROR_PIPE_BUSY)
            return state_->fail("ORIGINAL_BOOTSTRAP_PIPE_UNAVAILABLE", open_error);
        const ULONGLONG now = GetTickCount64();
        if (now >= deadline)
            return state_->fail("ORIGINAL_BOOTSTRAP_PIPE_AVAILABILITY_TIMEOUT", ERROR_TIMEOUT);
        const ULONGLONG remaining = deadline - now;
        const DWORD interval = static_cast<DWORD>(remaining < kAvailabilityPollMs ? remaining : kAvailabilityPollMs);
        const DWORD wait = WaitForMultipleObjects(2, waits, FALSE, interval);
        const DWORD wait_error = wait == WAIT_FAILED ? GetLastError() : ERROR_OPERATION_ABORTED;
        if (wait == WAIT_TIMEOUT) {
#ifdef METAENGINE_GUARDIAN_INSTALL_ORIGIN_TEST
            if (state_->initial_availability_for_test.valid()) SetEvent(state_->initial_availability_for_test.value);
#endif
            continue;
        }
        if (wait == WAIT_OBJECT_0)
            return state_->fail("ORIGINAL_BOOTSTRAP_PIPE_WAIT_CANCELLED", ERROR_OPERATION_ABORTED);
        if (wait == WAIT_OBJECT_0 + 1)
            return state_->fail("ORIGINAL_BOOTSTRAP_PROCESS_EXITED", ERROR_PROCESS_ABORTED);
        return state_->fail("ORIGINAL_BOOTSTRAP_PIPE_WAIT_UNCONFIRMED", wait_error);
    }
    if (!state_->initialBootstrapLive()) return false;
    DWORD read_mode = PIPE_READMODE_MESSAGE;
    if (!SetNamedPipeHandleState(state_->client_pipe.value, &read_mode, nullptr, nullptr))
        return state_->fail("INSTALL_ORIGIN_MESSAGE_MODE_UNAVAILABLE");
    if (!state_->bootstrapExact(state_->client_pipe.value))
        return state_->fail("ORIGINAL_BOOTSTRAP_PIPE_MISMATCH");
    auto hello = detail::makeInstallOriginFrame(InstallOriginRole::Coordinator, state_->challenge);
    InstallOriginFrame reply{};
    if (!state_->packet(state_->client_pipe.value, &hello, true) || !state_->packet(state_->client_pipe.value, &reply, false))
        return state_->fail("INSTALL_ORIGIN_IO_UNCONFIRMED");
    if (!detail::matchesInstallOriginFrame(reply, InstallOriginRole::Bootstrap, state_->challenge) || !state_->fence.markMessageComplete())
        return state_->fail("INSTALL_ORIGIN_REPLY_INVALID", ERROR_INVALID_DATA);
    if (!state_->bootstrapExact(state_->client_pipe.value))
        return state_->fail("INSTALL_ORIGIN_TRANSCRIPT_OR_POSTCHECK_FAILED");
    if (!state_->fence.markPeerBound() || !state_->fence.claimOnce())
        return state_->fail("INSTALL_ORIGIN_SCOPE_CANCELLED_OR_CONSUMED", ERROR_OPERATION_ABORTED);
    state_->kernel_bound = true;
    state_->reason = "KERNEL_BOUND_RELEASE_UNQUALIFIED";
    state_->error = ERROR_NOT_SUPPORTED;
    return true; // Observation only. No release/installation permission.
}

std::unique_ptr<GuardianInstallOriginLink> GuardianInstallOriginLink::observeBootstrapOrigin(std::wstring_view generated_link_id) {
    auto out = createBootstrapObserver();
    out->observeOriginalCoordinator(generated_link_id);
    return out;
}

std::unique_ptr<GuardianInstallOriginLink> GuardianInstallOriginLink::createBootstrapObserver() {
    return std::unique_ptr<GuardianInstallOriginLink>(new GuardianInstallOriginLink());
}

bool GuardianInstallOriginLink::observeOriginalCoordinator(std::wstring_view generated_link_id) {
    return listenAsBootstrap(generated_link_id);
}

bool GuardianInstallOriginLink::listenAsBootstrap(std::wstring_view generated_link_id) {
    std::lock_guard<std::mutex> lock(state_->mutex);
    if (state_->is_coordinator || state_->attempted || !state_->active() || !decode(generated_link_id, &state_->challenge))
        return state_->fail("INSTALL_ORIGIN_ROUTING_ID_INVALID", ERROR_INVALID_DATA);
    state_->attempted = true;
    state_->routing_id = encode(state_->challenge);
    state_->server_pipe = std::make_unique<OwnerEnrollmentPipe>();
    if (!state_->server_pipe->create(std::wstring(kPrefix) + state_->routing_id)) return state_->fail("INSTALL_ORIGIN_PIPE_UNAVAILABLE");
    Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!event.valid()) return state_->fail("INSTALL_ORIGIN_EVENT_UNAVAILABLE");
    OVERLAPPED operation{}; operation.hEvent = event.value;
    DWORD ignored = 0;
    const BOOL immediate = ConnectNamedPipe(state_->server_pipe->handle(), &operation);
    const DWORD error = immediate ? ERROR_SUCCESS : GetLastError();
#ifdef METAENGINE_GUARDIAN_INSTALL_ORIGIN_TEST
    if (error == ERROR_IO_PENDING) state_->pending_for_test.store(1, std::memory_order_release);
#endif
    const bool connected = error == ERROR_PIPE_CONNECTED || state_->completeIo(state_->server_pipe->handle(), &operation, immediate, &ignored);
#ifdef METAENGINE_GUARDIAN_INSTALL_ORIGIN_TEST
    state_->pending_for_test.store(0, std::memory_order_release);
#endif
    if (!connected)
        return state_->fail("INSTALL_ORIGIN_CONNECT_UNCONFIRMED");
    InstallOriginFrame hello{};
    if (!state_->packet(state_->server_pipe->handle(), &hello, false)) return state_->fail("INSTALL_ORIGIN_HELLO_IO_UNCONFIRMED");
    if (!detail::matchesInstallOriginFrame(hello, InstallOriginRole::Coordinator, state_->challenge) ||
        !state_->fence.markMessageComplete()) return state_->fail("INSTALL_ORIGIN_HELLO_INVALID", ERROR_INVALID_DATA);
    state_->origin = GuardianOriginalInstallUser::captureOriginalPipeClient(state_->server_pipe->handle());
    if (!state_->origin->recheck() || !state_->fence.markPeerBound())
        return state_->fail("ORIGINAL_PRE_UAC_CLIENT_UNPROVEN", ERROR_ACCESS_DENIED);
    auto reply = detail::makeInstallOriginFrame(InstallOriginRole::Bootstrap, state_->challenge);
    if (!state_->packet(state_->server_pipe->handle(), &reply, true) || !state_->origin->recheck() || !state_->fence.claimOnce())
        return state_->fail("INSTALL_ORIGIN_REPLY_OR_POSTCHECK_FAILED");
    state_->kernel_bound = true;
    state_->reason = "KERNEL_BOUND_RELEASE_UNQUALIFIED";
    state_->error = ERROR_NOT_SUPPORTED;
    return true; // No call to installEmbedded, SCM mutation or child creation.
}

bool GuardianInstallOriginLink::waitForOriginalCoordinatorClose() {
    std::lock_guard<std::mutex> lock(state_->mutex);
    if (state_->is_coordinator || !state_->kernel_bound || !state_->active() || !state_->server_pipe || !state_->origin || !state_->origin->recheck())
        return state_->fail("ORIGINAL_COORDINATOR_SCOPE_UNAVAILABLE", ERROR_ACCESS_DENIED);
    // Keep original process/token/pipe custody while the coordinator performs
    // its after-reply checks. EOF is terminal transport observation, never an
    // install/handoff ACK. Deadline/cancel still drains the original read IRP.
    InstallOriginFrame unexpected{};
    const bool message = state_->packet(state_->server_pipe->handle(), &unexpected, false);
    const DWORD error = GetLastError();
    if (!message && (error == ERROR_BROKEN_PIPE || error == ERROR_NO_DATA)) {
        state_->kernel_bound = false;
        state_->reason = "ORIGINAL_COORDINATOR_CONNECTION_CLOSED";
        state_->error = error;
        return true;
    }
    return state_->fail(message ? "INSTALL_ORIGIN_UNEXPECTED_MESSAGE_AFTER_BIND" : "INSTALL_ORIGIN_TERMINAL_CLOSE_UNCONFIRMED",
        message ? ERROR_INVALID_DATA : error);
}

void GuardianInstallOriginLink::requestCancel() noexcept {
    if (!state_) return;
    state_->fence.cancel();
    if (state_->cancelled.valid()) SetEvent(state_->cancelled.value);
    // Do not race a unique_ptr reset; native link owns serialized origin cleanup.
}
void GuardianInstallOriginLink::close() noexcept {
    if (!state_) return;
    requestCancel();
    std::lock_guard<std::mutex> lock(state_->mutex);
    if (state_->closed) return;
    state_->closed = true;
    state_->kernel_bound = false;
    state_->client_pipe.reset();
    state_->server_pipe.reset();
    state_->bootstrap_process.reset();
    if (state_->origin) state_->origin->close();
    state_->reason = "INSTALL_ORIGIN_CLOSED";
    state_->error = ERROR_OPERATION_ABORTED;
}
std::string GuardianInstallOriginLink::snapshotJson() const {
    std::lock_guard<std::mutex> lock(state_->mutex);
    const bool active = state_->active();
    const auto reason = active || state_->closed ? state_->reason : "INSTALL_ORIGIN_CANCELLED";
    return "{\"schema\":\"metaengine.browser-guardian.install-origin-link.v1\",\"state\":\"HOLD\",\"reason\":\"" + reason +
        "\",\"kernel_binding\":\"" + (active && state_->kernel_bound ? "EXACT" : "UNPROVEN") +
        "\",\"purpose\":\"INSTALL_ORIGIN_OBSERVATION_ONLY_V1\",\"release_binding\":\"UNQUALIFIED\",\"uac_requested\":false,"
        "\"main_launch_implemented\":false,\"scm_transfer_implemented\":false,\"authority_effect\":false,\"win32_error\":" +
        std::to_string(state_->error) + ",\"original_user\":" + (state_->origin ? state_->origin->snapshotJson() : "null") + "}";
}
#ifdef METAENGINE_GUARDIAN_INSTALL_ORIGIN_TEST
std::wstring GuardianInstallOriginLink::routingIdForTest() const {
    std::lock_guard<std::mutex> lock(state_->mutex);
    return state_->routing_id;
}
bool GuardianInstallOriginLink::waitForInitialAvailabilityForTest(DWORD timeout_ms) const noexcept {
    return state_->initial_availability_for_test.valid() &&
        WaitForSingleObject(state_->initial_availability_for_test.value, timeout_ms) == WAIT_OBJECT_0;
}
unsigned GuardianInstallOriginLink::pendingOperationForTest() const noexcept {
    return state_->pending_for_test.load(std::memory_order_acquire);
}
void GuardianInstallOriginLink::wakePendingEventEarlyForTest() noexcept {
    state_->wake_early_for_test.store(true, std::memory_order_release);
}
#endif
}
