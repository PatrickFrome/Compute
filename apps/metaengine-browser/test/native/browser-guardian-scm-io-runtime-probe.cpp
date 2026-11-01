// Windows-only runtime probe. The runner links the production actuator, observer,
// store, reconciler and ticket-client sources, but not the service source again.
// No service is registered and no actuator request or installer is dispatched.
// The included production pipe functions run against real local named pipes.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <cstdlib>
#include <iostream>
#include <mutex>
#include <string>
#include <vector>

#include "../../native/browser-guardian-scm/browser-guardian-owner-enrollment-observer.hpp"
#include "../../native/browser-guardian-scm/browser-guardian-owner-enrollment-store.hpp"
#include "../../native/browser-guardian-scm/browser-guardian-update-actuator.hpp"

namespace guardian_io_probe {

constexpr DWORD kWaitMs = 5'000;
constexpr DWORD kSuiteWaitMs = 60'000;

[[noreturn]] void failFast(const char* reason) {
    std::cerr << "guardian_io_probe_fatal:" << reason << ":win32=" << GetLastError() << '\n';
    std::cerr.flush();
    // Do not unwind an OVERLAPPED/buffer stack if a real driver has not completed.
    ExitProcess(90);
}

class Handle {
public:
    explicit Handle(HANDLE value = nullptr) : value_(value) {}
    ~Handle() { if (valid()) CloseHandle(value_); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    bool valid() const { return value_ != nullptr && value_ != INVALID_HANDLE_VALUE; }
    HANDLE get() const { return value_; }
private:
    HANDLE value_;
};

HANDLE event() {
    HANDLE value = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (value == nullptr) failFast("event_create_failed");
    return value;
}

struct Snapshot {
    unsigned pending = 0;
    unsigned cancellation_requests = 0;
    unsigned terminal_readbacks = 0;
    unsigned terminal_readbacks_after_cancel = 0;
    unsigned event_closes = 0;
    unsigned harness_safety_drains = 0;
    unsigned injected_wait_failures = 0;
    DWORD cancellation_error = ERROR_SUCCESS;
    bool early_event_close = false;
};

struct Telemetry {
    Handle stop{event()};
    Handle pending{event()};
    Handle wait_entered{event()};
    Handle release_wait{event()};
    bool hold_wait = false;
    bool inject_wait_failure = false;
    std::mutex mutex;
    OVERLAPPED* operation = nullptr;
    HANDLE pipe = nullptr;
    HANDLE operation_event = nullptr;
    Snapshot snapshot;
};

// Set before creating a worker and cleared only after joining it. No concurrent
// mutation of this pointer is possible while a production wrapper is running.
Telemetry* current = nullptr;

void pending(HANDLE pipe, OVERLAPPED* operation, BOOL ok, DWORD error) {
    if (current == nullptr || operation == nullptr || ok || error != ERROR_IO_PENDING) return;
    {
        std::lock_guard<std::mutex> lock(current->mutex);
        current->pipe = pipe;
        current->operation = operation;
        current->operation_event = operation->hEvent;
        ++current->snapshot.pending;
    }
    if (!SetEvent(current->pending.get())) failFast("pending_signal_failed");
}

bool terminal(OVERLAPPED* operation, BOOL ok, DWORD error) {
    // An API argument/handle error alone cannot prove that the submitted kernel
    // operation completed. Also inspect the still-live original OVERLAPPED.
    return HasOverlappedIoCompleted(operation)
        && (ok || (error != ERROR_IO_INCOMPLETE && error != WAIT_TIMEOUT && error != ERROR_IO_PENDING));
}

void boundedDrain(HANDLE pipe, OVERLAPPED* operation) {
    DWORD transferred = 0;
    const BOOL ok = GetOverlappedResultEx(pipe, operation, &transferred, kWaitMs, FALSE);
    if (!terminal(operation, ok, ok ? ERROR_SUCCESS : GetLastError())) failFast("completion_drain_timeout");
}

void recordReadback(OVERLAPPED* operation, BOOL ok, DWORD error) {
    if (current == nullptr || !terminal(operation, ok, error)) return;
    std::lock_guard<std::mutex> lock(current->mutex);
    if (current->operation != operation) return;
    ++current->snapshot.terminal_readbacks;
    if (current->snapshot.cancellation_requests != 0) {
        ++current->snapshot.terminal_readbacks_after_cancel;
    }
}

BOOL WINAPI observedConnectNamedPipe(HANDLE pipe, LPOVERLAPPED operation) {
    const BOOL ok = ConnectNamedPipe(pipe, operation);
    const DWORD error = ok ? ERROR_SUCCESS : GetLastError();
    pending(pipe, operation, ok, error);
    SetLastError(error);
    return ok;
}

BOOL WINAPI observedReadFile(HANDLE pipe, LPVOID buffer, DWORD size, LPDWORD transferred, LPOVERLAPPED operation) {
    const BOOL ok = ReadFile(pipe, buffer, size, transferred, operation);
    const DWORD error = ok ? ERROR_SUCCESS : GetLastError();
    pending(pipe, operation, ok, error);
    SetLastError(error);
    return ok;
}

BOOL WINAPI observedWriteFile(HANDLE pipe, LPCVOID buffer, DWORD size, LPDWORD transferred, LPOVERLAPPED operation) {
    const BOOL ok = WriteFile(pipe, buffer, size, transferred, operation);
    const DWORD error = ok ? ERROR_SUCCESS : GetLastError();
    pending(pipe, operation, ok, error);
    SetLastError(error);
    return ok;
}

BOOL WINAPI observedCancelIoEx(HANDLE pipe, LPOVERLAPPED operation) {
    const BOOL ok = CancelIoEx(pipe, operation);
    const DWORD error = ok ? ERROR_SUCCESS : GetLastError();
    if (current != nullptr && operation != nullptr) {
        {
            std::lock_guard<std::mutex> lock(current->mutex);
            ++current->snapshot.cancellation_requests;
            current->snapshot.cancellation_error = error;
        }
    }
    // Preserve the kernel's actual cancellation/completion timing. If old source
    // skips completion readback, observedCloseHandle rescues the still-live I/O
    // immediately before the event and its enclosing stack can be released.
    SetLastError(error);
    return ok;
}

BOOL WINAPI observedGetOverlappedResult(HANDLE pipe, LPOVERLAPPED operation, LPDWORD transferred, BOOL wait) {
    if (wait && WaitForSingleObject(operation->hEvent, kWaitMs) != WAIT_OBJECT_0) {
        failFast("production_completion_wait_timeout");
    }
    const BOOL ok = GetOverlappedResult(pipe, operation, transferred, wait);
    const DWORD error = ok ? ERROR_SUCCESS : GetLastError();
    recordReadback(operation, ok, error);
    SetLastError(error);
    return ok;
}

BOOL WINAPI observedGetOverlappedResultEx(
    HANDLE pipe, LPOVERLAPPED operation, LPDWORD transferred, DWORD timeout, BOOL alertable) {
    const BOOL ok = GetOverlappedResultEx(pipe, operation, transferred,
        timeout == INFINITE || timeout > kWaitMs ? kWaitMs : timeout, alertable);
    const DWORD error = ok ? ERROR_SUCCESS : GetLastError();
    recordReadback(operation, ok, error);
    SetLastError(error);
    return ok;
}

DWORD WINAPI observedWaitForMultipleObjects(DWORD count, const HANDLE* handles, BOOL all, DWORD timeout) {
    if (current != nullptr && count == 2 && handles[0] == current->stop.get()) {
        if (!SetEvent(current->wait_entered.get())) failFast("wait_entered_signal_failed");
        if (current->inject_wait_failure) {
            // Deliberate wait-failure injection, following a real pending kernel
            // operation. Cancellation and completion remain real Windows I/O.
            DWORD transferred = 0;
            const BOOL complete = GetOverlappedResult(current->pipe, current->operation, &transferred, FALSE);
            if (complete || GetLastError() != ERROR_IO_INCOMPLETE) failFast("injected_wait_not_pending");
            {
                std::lock_guard<std::mutex> lock(current->mutex);
                ++current->snapshot.injected_wait_failures;
            }
            SetLastError(ERROR_INVALID_HANDLE);
            return WAIT_FAILED;
        }
        if (current->hold_wait && WaitForSingleObject(current->release_wait.get(), kWaitMs) != WAIT_OBJECT_0) {
            failFast("simultaneous_wait_release_timeout");
        }
    }
    return WaitForMultipleObjects(count, handles, all,
        timeout == INFINITE || timeout > kWaitMs ? kWaitMs : timeout);
}

BOOL WINAPI observedCloseHandle(HANDLE handle) {
    if (current != nullptr) {
        std::lock_guard<std::mutex> lock(current->mutex);
        if (handle == current->operation_event) {
            ++current->snapshot.event_closes;
            if (current->snapshot.terminal_readbacks == 0
                || (current->snapshot.cancellation_requests != 0
                    && current->snapshot.terminal_readbacks_after_cancel == 0)) {
                current->snapshot.early_event_close = true;
            }
            DWORD transferred = 0;
            const BOOL ok = GetOverlappedResult(current->pipe, current->operation, &transferred, FALSE);
            if (!terminal(current->operation, ok, ok ? ERROR_SUCCESS : GetLastError())) {
                // Also protect the stack if production exits an unexpected wait
                // failure without requesting cancellation at all.
                current->snapshot.early_event_close = true;
                ++current->snapshot.harness_safety_drains;
                CancelIoEx(current->pipe, current->operation);
                boundedDrain(current->pipe, current->operation);
            }
        }
    }
    return CloseHandle(handle);
}

}  // namespace guardian_io_probe

// Telemetry/scheduling wrappers call real Windows APIs. They neither fabricate
// ERROR_IO_PENDING nor fabricate cancellation/completion results. The safety
// drains above are explicitly excluded from the production-readback assertions.
#define ConnectNamedPipe guardian_io_probe::observedConnectNamedPipe
#define ReadFile guardian_io_probe::observedReadFile
#define WriteFile guardian_io_probe::observedWriteFile
#define CancelIoEx guardian_io_probe::observedCancelIoEx
#define GetOverlappedResult guardian_io_probe::observedGetOverlappedResult
#define GetOverlappedResultEx guardian_io_probe::observedGetOverlappedResultEx
#define WaitForMultipleObjects guardian_io_probe::observedWaitForMultipleObjects
#define CloseHandle guardian_io_probe::observedCloseHandle
#define wmain guardianServiceEntryForIoProbe
#include "../../native/browser-guardian-scm/browser-guardian-scm-service.cpp"
#undef wmain
#undef CloseHandle
#undef WaitForMultipleObjects
#undef GetOverlappedResultEx
#undef GetOverlappedResult
#undef CancelIoEx
#undef WriteFile
#undef ReadFile
#undef ConnectNamedPipe

namespace guardian_io_probe {

enum class Operation { Connect, Read, Write };

struct Worker {
    Operation operation;
    metaengine::guardian::OwnerEnrollmentPipe* server;
    std::string payload;
    std::string readback;
    bool result = false;
};

DWORD WINAPI runWorker(void* context) {
    auto* worker = static_cast<Worker*>(context);
    switch (worker->operation) {
        case Operation::Connect: worker->result = connectPipe(worker->server); break;
        case Operation::Read: worker->result = readRequest(worker->server->handle(), &worker->readback); break;
        case Operation::Write: worker->result = writeResponse(worker->server->handle(), worker->payload); break;
    }
    return 0;
}

void wait(HANDLE handle, const char* reason) {
    if (WaitForSingleObject(handle, kWaitMs) != WAIT_OBJECT_0) failFast(reason);
}

HANDLE openClient(const std::wstring& name) {
    HANDLE value = CreateFileW(name.c_str(), metaengine::guardian::browserGuardianOwnerEnrollmentClientAccessMask(), 0, nullptr,
        OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr);
    if (value == INVALID_HANDLE_VALUE) failFast("client_open_failed");
    return value;
}

void transfer(HANDLE pipe, bool write, std::string* buffer) {
    Handle completed(event());
    OVERLAPPED operation{};
    operation.hEvent = completed.get();
    DWORD transferred = 0;
    const DWORD bytes = static_cast<DWORD>(buffer->size());
    BOOL ok = write
        ? WriteFile(pipe, buffer->data(), bytes, &transferred, &operation)
        : ReadFile(pipe, buffer->data(), bytes, &transferred, &operation);
    if (!ok && GetLastError() == ERROR_IO_PENDING) {
        ok = GetOverlappedResultEx(pipe, &operation, &transferred, kWaitMs, FALSE);
    }
    if (!ok || transferred != bytes) {
        // ExitProcess keeps this buffer/OVERLAPPED alive until process teardown.
        failFast("client_transfer_failed_or_incomplete");
    }
}

HANDLE connectedClient(metaengine::guardian::OwnerEnrollmentPipe& server, const std::wstring& name) {
    Handle completed(event());
    OVERLAPPED operation{};
    operation.hEvent = completed.get();
    const BOOL connected = ConnectNamedPipe(server.handle(), &operation);
    const DWORD error = connected ? ERROR_SUCCESS : GetLastError();
    if (!connected && error != ERROR_IO_PENDING) failFast("fixture_connect_not_pending");
    HANDLE client = openClient(name);
    if (!connected) {
        DWORD transferred = 0;
        if (!GetOverlappedResultEx(server.handle(), &operation, &transferred, kWaitMs, FALSE)) {
            failFast("fixture_connect_completion_failed");
        }
    }
    return client;
}

struct CaseResult {
    const char* name;
    bool ok;
    bool result;
    bool both_signaled;
    Snapshot snapshot;
};

CaseResult runCase(
    const char* label, unsigned index, Operation operation, bool stop, bool simultaneous, bool wait_failure = false) {
    Telemetry telemetry;
    telemetry.hold_wait = simultaneous;
    telemetry.inject_wait_failure = wait_failure;
    const std::wstring name = L"\\\\.\\pipe\\METAENGINEGuardianIoProbe-"
        + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(index);
    metaengine::guardian::OwnerEnrollmentPipe server;
    if (!server.create(name)) failFast("fixture_pipe_create_failed");
    Handle client(operation == Operation::Connect ? nullptr : connectedClient(server, name));
    Worker context{operation, &server, std::string(kMaxRequestBytes, 'x'), {}, false};
    current = &telemetry;
    g_stop_event = telemetry.stop.get();
    Handle worker(CreateThread(nullptr, 0, runWorker, &context, 0, nullptr));
    if (!worker.valid()) failFast("worker_create_failed");

    HANDLE pending_or_done[] = {telemetry.pending.get(), worker.get()};
    const DWORD pending_wait = WaitForMultipleObjects(2, pending_or_done, FALSE, kWaitMs);
    if (pending_wait != WAIT_OBJECT_0 && pending_wait != WAIT_OBJECT_0 + 1) failFast("pending_io_timeout");
    const bool pending_exercised = pending_wait == WAIT_OBJECT_0;
    bool both_signaled = false;
    std::string incoming;
    HANDLE connect_client = nullptr;
    if (pending_exercised) {
        wait(telemetry.wait_entered.get(), "production_wait_not_entered");
        if ((!stop && !wait_failure) || simultaneous) {
            if (operation == Operation::Connect) connect_client = openClient(name);
            else if (operation == Operation::Read) {
                std::string message = "real-pipe-runtime-probe\n";
                transfer(client.get(), true, &message);
            } else {
                incoming.resize(context.payload.size());
                transfer(client.get(), false, &incoming);
            }
        }
        if (simultaneous) {
            HANDLE operation_event = nullptr;
            {
                std::lock_guard<std::mutex> lock(telemetry.mutex);
                operation_event = telemetry.operation_event;
            }
            wait(operation_event, "simultaneous_io_completion_timeout");
            if (!SetEvent(telemetry.stop.get())) failFast("stop_signal_failed");
            both_signaled = WaitForSingleObject(operation_event, 0) == WAIT_OBJECT_0
                && WaitForSingleObject(telemetry.stop.get(), 0) == WAIT_OBJECT_0;
            if (!SetEvent(telemetry.release_wait.get())) failFast("wait_release_signal_failed");
        } else if (stop && !SetEvent(telemetry.stop.get())) {
            failFast("stop_signal_failed");
        }
    }
    Handle completed_client(connect_client);
    wait(worker.get(), "worker_join_timeout");
    current = nullptr;
    g_stop_event = nullptr;
    const Snapshot row = telemetry.snapshot;
    const bool successful_payload = operation == Operation::Read
        ? context.readback == "real-pipe-runtime-probe\n"
        : operation != Operation::Write || incoming == context.payload;
    const bool ok = pending_exercised && row.pending == 1 && row.event_closes == 1
        && row.terminal_readbacks != 0 && !row.early_event_close
        && row.injected_wait_failures == (wait_failure ? 1U : 0U)
        && (stop || wait_failure
            ? !context.result && row.cancellation_requests == 1 && row.terminal_readbacks_after_cancel != 0
            : context.result && row.cancellation_requests == 0 && successful_payload)
        && (!simultaneous || (both_signaled && row.cancellation_error == ERROR_NOT_FOUND));
    return {label, ok, context.result, both_signaled, row};
}

DWORD WINAPI watchdog(void* context) {
    if (WaitForSingleObject(static_cast<HANDLE>(context), kSuiteWaitMs) != WAIT_OBJECT_0) {
        failFast("suite_watchdog_timeout");
    }
    return 0;
}

}  // namespace guardian_io_probe

int wmain() {
    using namespace guardian_io_probe;
    Handle done(event());
    Handle guard(CreateThread(nullptr, 0, watchdog, done.get(), 0, nullptr));
    if (!guard.valid()) failFast("watchdog_create_failed");
    std::vector<CaseResult> cases;
    unsigned index = 0;
    for (const Operation operation : {Operation::Connect, Operation::Read, Operation::Write}) {
        const char* stop_label = operation == Operation::Connect ? "pending_connect_stop"
            : operation == Operation::Read ? "pending_read_stop" : "blocked_write_stop";
        const char* success_label = operation == Operation::Connect ? "pending_connect_success"
            : operation == Operation::Read ? "pending_read_success" : "blocked_write_success";
        const char* race_label = operation == Operation::Connect ? "connect_completion_and_stop"
            : operation == Operation::Read ? "read_completion_and_stop" : "write_completion_and_stop";
        const char* failure_label = operation == Operation::Connect ? "pending_connect_wait_failed"
            : operation == Operation::Read ? "pending_read_wait_failed" : "blocked_write_wait_failed";
        cases.push_back(runCase(stop_label, ++index, operation, true, false));
        cases.push_back(runCase(success_label, ++index, operation, false, false));
        cases.push_back(runCase(race_label, ++index, operation, true, true));
        cases.push_back(runCase(failure_label, ++index, operation, false, false, true));
    }
    bool ok = true;
    for (const auto& result : cases) ok = ok && result.ok;
    std::cout << "{\"schema\":\"metaengine.browser-guardian.scm-io-runtime-proof.v1\",\"ok\":"
        << (ok ? "true" : "false")
        << ",\"real_named_pipe_io\":true,\"installer_dispatch_exercised\":false,"
           "\"scm_installation_exercised\":false,\"effect_admission_exercised\":false,\"cases\":[";
    bool first = true;
    for (const auto& result : cases) {
        if (!first) std::cout << ',';
        first = false;
        const Snapshot& row = result.snapshot;
        std::cout << "{\"name\":\"" << result.name << "\",\"ok\":" << (result.ok ? "true" : "false")
            << ",\"function_result\":" << (result.result ? "true" : "false")
            << ",\"pending_operations\":" << row.pending
            << ",\"cancel_requests\":" << row.cancellation_requests
            << ",\"cancel_error\":" << row.cancellation_error
            << ",\"production_terminal_readbacks\":" << row.terminal_readbacks
            << ",\"production_terminal_readbacks_after_cancel\":" << row.terminal_readbacks_after_cancel
            << ",\"event_closes\":" << row.event_closes
            << ",\"early_event_close\":" << (row.early_event_close ? "true" : "false")
            << ",\"both_events_signaled_before_wait\":" << (result.both_signaled ? "true" : "false")
            << ",\"harness_safety_drains\":" << row.harness_safety_drains
            << ",\"injected_wait_failures\":" << row.injected_wait_failures << '}';
    }
    std::cout << "],\"authority_effect\":false}\n";
    if (!SetEvent(done.get())) failFast("watchdog_done_signal_failed");
    wait(guard.get(), "watchdog_join_timeout");
    return ok ? 0 : 1;
}
