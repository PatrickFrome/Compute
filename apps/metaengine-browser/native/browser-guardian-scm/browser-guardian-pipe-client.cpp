#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <algorithm>
#include <charconv>
#include <cstdint>
#include <iostream>
#include <string>
#include <string_view>
#include <vector>

namespace {

constexpr wchar_t kPipeName[] = L"\\\\.\\pipe\\METAENGINEBrowserGuardianUpdateV1";
constexpr DWORD kClientAccess =
    FILE_READ_DATA | FILE_WRITE_DATA | FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | SYNCHRONIZE;
constexpr DWORD kDefaultTimeoutMs = 135000;
constexpr DWORD kMinTimeoutMs = 1000;
constexpr DWORD kMaxTimeoutMs = 135000;
constexpr std::size_t kMaxWireBytes = 16 * 1024;

struct Handle {
    HANDLE value = INVALID_HANDLE_VALUE;
    explicit Handle(HANDLE h = INVALID_HANDLE_VALUE) : value(h) {}
    ~Handle() {
        if (value != nullptr && value != INVALID_HANDLE_VALUE) CloseHandle(value);
    }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    bool valid() const noexcept { return value != nullptr && value != INVALID_HANDLE_VALUE; }
};

int fail(const char* stage, DWORD error) {
    std::cerr << "guardian_pipe_client_error:" << stage << ":" << error << "\n";
    return 2;
}

bool exactTimeout(const wchar_t* raw, DWORD* out) {
    if (raw == nullptr || out == nullptr) return false;
    std::wstring_view value(raw);
    if (value.empty() || value.size() > 9) return false;
    std::uint64_t parsed = 0;
    for (wchar_t c : value) {
        if (c < L'0' || c > L'9') return false;
        parsed = parsed * 10 + static_cast<unsigned>(c - L'0');
        if (parsed > kMaxTimeoutMs) return false;
    }
    if (parsed < kMinTimeoutMs) return false;
    *out = static_cast<DWORD>(parsed);
    return true;
}

bool readStdin(std::string* out) {
    if (out == nullptr) return false;
    HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
    if (in == nullptr || in == INVALID_HANDLE_VALUE) return false;
    out->clear();
    std::array<char, 4096> buffer{};
    for (;;) {
        DWORD got = 0;
        if (!ReadFile(in, buffer.data(), static_cast<DWORD>(buffer.size()), &got, nullptr)) {
            if (GetLastError() == ERROR_BROKEN_PIPE) break;
            return false;
        }
        if (got == 0) break;
        if (out->size() + got > kMaxWireBytes) {
            SetLastError(ERROR_BUFFER_OVERFLOW);
            return false;
        }
        out->append(buffer.data(), got);
    }
    return !out->empty() && out->back() == '\n';
}

bool overlappedWrite(HANDLE pipe, std::string_view request, DWORD timeoutMs, DWORD* error) {
    Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!event.valid()) {
        if (error) *error = GetLastError();
        return false;
    }
    OVERLAPPED ov{};
    ov.hEvent = event.value;
    DWORD written = 0;
    BOOL ok = WriteFile(pipe, request.data(), static_cast<DWORD>(request.size()), &written, &ov);
    if (!ok) {
        const DWORD first = GetLastError();
        if (first != ERROR_IO_PENDING) {
            if (error) *error = first;
            return false;
        }
        const DWORD wait = WaitForSingleObject(event.value, timeoutMs);
        if (wait != WAIT_OBJECT_0) {
            CancelIoEx(pipe, &ov);
            if (error) *error = wait == WAIT_TIMEOUT ? ERROR_TIMEOUT : GetLastError();
            return false;
        }
        if (!GetOverlappedResult(pipe, &ov, &written, FALSE)) {
            if (error) *error = GetLastError();
            return false;
        }
    }
    if (written != request.size()) {
        if (error) *error = ERROR_WRITE_FAULT;
        return false;
    }
    if (error) *error = ERROR_SUCCESS;
    return true;
}

bool overlappedRead(HANDLE pipe, std::string* response, DWORD timeoutMs, DWORD* error) {
    if (response == nullptr) {
        if (error) *error = ERROR_INVALID_PARAMETER;
        return false;
    }
    std::vector<char> buffer(kMaxWireBytes + 1, '\0');
    Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!event.valid()) {
        if (error) *error = GetLastError();
        return false;
    }
    OVERLAPPED ov{};
    ov.hEvent = event.value;
    DWORD got = 0;
    BOOL ok = ReadFile(pipe, buffer.data(), static_cast<DWORD>(kMaxWireBytes), &got, &ov);
    if (!ok) {
        const DWORD first = GetLastError();
        if (first == ERROR_MORE_DATA) {
            if (error) *error = ERROR_BUFFER_OVERFLOW;
            return false;
        }
        if (first != ERROR_IO_PENDING) {
            if (error) *error = first;
            return false;
        }
        const DWORD wait = WaitForSingleObject(event.value, timeoutMs);
        if (wait != WAIT_OBJECT_0) {
            CancelIoEx(pipe, &ov);
            if (error) *error = wait == WAIT_TIMEOUT ? ERROR_TIMEOUT : GetLastError();
            return false;
        }
        if (!GetOverlappedResult(pipe, &ov, &got, FALSE)) {
            const DWORD finalError = GetLastError();
            if (finalError == ERROR_MORE_DATA) {
                if (error) *error = ERROR_BUFFER_OVERFLOW;
                return false;
            }
            if (error) *error = finalError;
            return false;
        }
    }
    if (got == 0 || got > kMaxWireBytes) {
        if (error) *error = ERROR_INVALID_DATA;
        return false;
    }
    response->assign(buffer.data(), got);
    const auto newline = response->find('\n');
    if (newline == std::string::npos) {
        if (error) *error = ERROR_INVALID_DATA;
        return false;
    }
    for (std::size_t i = newline + 1; i < response->size(); ++i) {
        const unsigned char c = static_cast<unsigned char>((*response)[i]);
        if (c != ' ' && c != '\t' && c != '\r' && c != '\n') {
            if (error) *error = ERROR_INVALID_DATA;
            return false;
        }
    }
    response->resize(newline + 1);
    if (error) *error = ERROR_SUCCESS;
    return true;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
    if (argc == 2 && std::wstring_view(argv[1]) == L"--contract-json") {
        std::cout
            << "{\"schema\":\"metaengine.browser-guardian.pipe-client.v1\","
            << "\"fixed_pipe\":\"\\\\\\\\.\\\\pipe\\\\METAENGINEBrowserGuardianUpdateV1\","
            << "\"exact_access_mask\":" << kClientAccess << ","
            << "\"generic_read_requested\":false,"
            << "\"generic_write_requested\":false,"
            << "\"client_create_pipe_instance_allowed\":false,"
            << "\"caller_supplied_pipe_allowed\":false,"
            << "\"caller_supplied_shell_allowed\":false,"
            << "\"max_wire_bytes\":" << kMaxWireBytes << ","
            << "\"automatic_retry_allowed\":false,"
            << "\"authority_effect\":false}\n";
        return 0;
    }

    DWORD timeoutMs = kDefaultTimeoutMs;
    if (argc == 3 && std::wstring_view(argv[1]) == L"--timeout-ms") {
        if (!exactTimeout(argv[2], &timeoutMs)) return fail("timeout_invalid", ERROR_INVALID_PARAMETER);
    } else if (argc != 1) {
        return fail("arguments_invalid", ERROR_INVALID_PARAMETER);
    }

    std::string request;
    if (!readStdin(&request)) return fail("stdin_invalid", GetLastError());

    if (!WaitNamedPipeW(kPipeName, timeoutMs)) return fail("wait", GetLastError());

    Handle pipe(CreateFileW(
        kPipeName,
        kClientAccess,
        0,
        nullptr,
        OPEN_EXISTING,
        FILE_FLAG_OVERLAPPED,
        nullptr));
    if (!pipe.valid()) return fail("connect", GetLastError());

    DWORD mode = PIPE_READMODE_MESSAGE;
    if (!SetNamedPipeHandleState(pipe.value, &mode, nullptr, nullptr)) {
        return fail("read_mode", GetLastError());
    }

    DWORD error = ERROR_SUCCESS;
    if (!overlappedWrite(pipe.value, request, timeoutMs, &error)) return fail("write", error);

    std::string response;
    if (!overlappedRead(pipe.value, &response, timeoutMs, &error)) return fail("read", error);

    DWORD written = 0;
    HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
    if (out == nullptr || out == INVALID_HANDLE_VALUE
        || !WriteFile(out, response.data(), static_cast<DWORD>(response.size()), &written, nullptr)
        || written != response.size()) {
        return fail("stdout", GetLastError());
    }
    return 0;
}
