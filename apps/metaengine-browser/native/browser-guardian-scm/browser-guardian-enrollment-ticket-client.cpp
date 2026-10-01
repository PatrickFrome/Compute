#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winhttp.h>

#include "browser-guardian-enrollment-ticket-client.hpp"

#include <algorithm>
#include <cctype>
#include <regex>
#include <string>
#include <string_view>
#include <vector>

namespace metaengine::guardian {
namespace {

constexpr wchar_t kHost[] = L"jhriwwsryeqsvvvufkok.supabase.co";
constexpr wchar_t kPath[] = L"/functions/v1/a2-browser-native-supervisor-v1/v1/guardian/enrollment/redeem";
constexpr wchar_t kUserAgent[] = L"METAENGINEBrowserGuardian/1.0";
constexpr std::size_t kMaxResponseBytes = 16 * 1024;

constexpr char kContract[] =
    "{\"schema\":\"metaengine.browser-guardian.enrollment-ticket-native-client.v1\","
    "\"version\":\"1.0.0\","
    "\"fixed_https_host\":\"jhriwwsryeqsvvvufkok.supabase.co\","
    "\"fixed_path\":\"/functions/v1/a2-browser-native-supervisor-v1/v1/guardian/enrollment/redeem\","
    "\"system_tls_validation_required\":true,"
    "\"redirects_allowed\":false,"
    "\"caller_supplied_url_allowed\":false,"
    "\"caller_supplied_headers_allowed\":false,"
    "\"bounded_response_bytes\":16384,"
    "\"automatic_retry_allowed\":false,"
    "\"owner_store_effect_allowed\":false,"
    "\"scm_effect_allowed\":false,"
    "\"authority_effect\":false}";

struct InternetHandle {
    HINTERNET value = nullptr;
    explicit InternetHandle(HINTERNET handle = nullptr) : value(handle) {}
    ~InternetHandle() { if (value != nullptr) WinHttpCloseHandle(value); }
    InternetHandle(const InternetHandle&) = delete;
    InternetHandle& operator=(const InternetHandle&) = delete;
};

bool base64Url(std::string_view value, std::size_t length) {
    return value.size() == length && std::all_of(value.begin(), value.end(), [](unsigned char ch) {
        return std::isalnum(ch) != 0 || ch == '_' || ch == '-';
    });
}

bool lowerHex(std::string_view value, std::size_t length) {
    return value.size() == length && std::all_of(value.begin(), value.end(), [](unsigned char ch) {
        return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f');
    });
}

bool uuid(std::string_view value) {
    if (value.size() != 36) return false;
    for (std::size_t i = 0; i < value.size(); ++i) {
        const unsigned char ch = static_cast<unsigned char>(value[i]);
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (ch != '-') return false;
        } else if (std::isxdigit(ch) == 0) {
            return false;
        }
    }
    return true;
}

std::string jsonEscape(std::string_view value) {
    std::string out;
    out.reserve(value.size());
    for (const unsigned char ch : value) {
        if (ch == '"' || ch == '\\') {
            out.push_back('\\');
            out.push_back(static_cast<char>(ch));
        } else if (ch >= 0x20 && ch <= 0x7e) {
            out.push_back(static_cast<char>(ch));
        }
    }
    return out;
}

bool jsonString(std::string_view body, const char* key, std::string* output) {
    if (key == nullptr || output == nullptr) return false;
    const std::regex pattern(std::string("\\\"") + key + "\\\"\\s*:\\s*\\\"([^\\\"\\\\]*)\\\"");
    std::cmatch match;
    const std::string text(body);
    if (!std::regex_search(text.c_str(), match, pattern) || match.size() != 2) return false;
    *output = match[1].str();
    return true;
}

bool jsonBool(std::string_view body, const char* key, bool* output) {
    if (key == nullptr || output == nullptr) return false;
    const std::regex pattern(std::string("\\\"") + key + "\\\"\\s*:\\s*(true|false)");
    std::cmatch match;
    const std::string text(body);
    if (!std::regex_search(text.c_str(), match, pattern) || match.size() != 2) return false;
    *output = match[1].str() == "true";
    return true;
}

bool jsonU64(std::string_view body, const char* key, std::uint64_t* output) {
    if (key == nullptr || output == nullptr) return false;
    const std::regex pattern(std::string("\\\"") + key + "\\\"\\s*:\\s*([0-9]{1,20})");
    std::cmatch match;
    const std::string text(body);
    if (!std::regex_search(text.c_str(), match, pattern) || match.size() != 2) return false;
    try {
        const unsigned long long value = std::stoull(match[1].str());
        *output = static_cast<std::uint64_t>(value);
        return true;
    } catch (...) {
        return false;
    }
}

bool readResponse(HINTERNET request, std::string* output) {
    if (request == nullptr || output == nullptr) return false;
    output->clear();
    for (;;) {
        DWORD available = 0;
        if (!WinHttpQueryDataAvailable(request, &available)) return false;
        if (available == 0) return true;
        if (output->size() + available > kMaxResponseBytes) return false;
        std::vector<char> buffer(available);
        DWORD read = 0;
        if (!WinHttpReadData(request, buffer.data(), available, &read)) return false;
        if (read == 0) return true;
        output->append(buffer.data(), buffer.data() + read);
    }
}

GuardianEnrollmentTicketRedemption failure(const char* reason, DWORD status = 0) {
    GuardianEnrollmentTicketRedemption out;
    out.reason = reason == nullptr ? "TICKET_REDEMPTION_FAILED" : reason;
    out.http_status = status;
    return out;
}

}  // namespace

GuardianEnrollmentTicketRedemption redeemBrowserGuardianEnrollmentTicket(
    const std::string& ticket,
    const std::string& keyFingerprintSha256,
    const std::string& ownerSidSha256) {
    if (!base64Url(ticket, 43)
        || !lowerHex(keyFingerprintSha256, 64)
        || !lowerHex(ownerSidSha256, 64)) {
        return failure("TICKET_REDEMPTION_INPUT_INVALID");
    }

    const std::string body =
        std::string("{\"ticket\":\"") + jsonEscape(ticket)
        + "\",\"key_fingerprint_sha256\":\"" + keyFingerprintSha256
        + "\",\"owner_sid_sha256\":\"" + ownerSidSha256 + "\"}";

    InternetHandle session(WinHttpOpen(
        kUserAgent,
        WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
        WINHTTP_NO_PROXY_NAME,
        WINHTTP_NO_PROXY_BYPASS,
        0));
    if (session.value == nullptr) return failure("WINHTTP_OPEN_FAILED");
    if (!WinHttpSetTimeouts(session.value, 3'000, 3'000, 5'000, 5'000)) {
        return failure("WINHTTP_TIMEOUT_CONFIG_FAILED");
    }

    InternetHandle connection(WinHttpConnect(session.value, kHost, INTERNET_DEFAULT_HTTPS_PORT, 0));
    if (connection.value == nullptr) return failure("WINHTTP_CONNECT_FAILED");

    InternetHandle request(WinHttpOpenRequest(
        connection.value,
        L"POST",
        kPath,
        nullptr,
        WINHTTP_NO_REFERER,
        WINHTTP_DEFAULT_ACCEPT_TYPES,
        WINHTTP_FLAG_SECURE));
    if (request.value == nullptr) return failure("WINHTTP_REQUEST_FAILED");

    DWORD disabled = WINHTTP_DISABLE_REDIRECTS;
    if (!WinHttpSetOption(request.value, WINHTTP_OPTION_DISABLE_FEATURE, &disabled, sizeof(disabled))) {
        return failure("WINHTTP_REDIRECT_FENCE_FAILED");
    }

    static constexpr wchar_t kHeaders[] = L"Content-Type: application/json\r\nAccept: application/json\r\n";
    if (!WinHttpSendRequest(
            request.value,
            kHeaders,
            static_cast<DWORD>(-1L),
            const_cast<char*>(body.data()),
            static_cast<DWORD>(body.size()),
            static_cast<DWORD>(body.size()),
            0)) {
        return failure("WINHTTP_SEND_FAILED");
    }
    if (!WinHttpReceiveResponse(request.value, nullptr)) return failure("WINHTTP_RECEIVE_FAILED");

    DWORD status = 0;
    DWORD statusBytes = sizeof(status);
    if (!WinHttpQueryHeaders(
            request.value,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            WINHTTP_HEADER_NAME_BY_INDEX,
            &status,
            &statusBytes,
            WINHTTP_NO_HEADER_INDEX)) {
        return failure("WINHTTP_STATUS_READ_FAILED");
    }

    std::string response;
    if (!readResponse(request.value, &response)) return failure("WINHTTP_RESPONSE_INVALID", status);

    GuardianEnrollmentTicketRedemption out;
    out.http_status = status;
    out.transport_proven = true;
    bool accepted = false;
    bool revalidated = false;
    bool authorityEffect = true;
    bool automaticRetry = true;
    jsonBool(response, "accepted", &accepted);
    jsonString(response, "reason", &out.reason);
    if (status != 200 || !accepted) {
        out.accepted = false;
        if (out.reason.empty()) out.reason = "TICKET_NOT_ACCEPTED";
        return out;
    }

    if (!jsonString(response, "ticket_id", &out.ticket_id)
        || !jsonString(response, "client_id", &out.client_id)
        || !jsonString(response, "device_id", &out.device_id)
        || !jsonString(response, "key_fingerprint_sha256", &out.key_fingerprint_sha256)
        || !jsonString(response, "consumer_owner_sid_sha256", &out.consumer_owner_sid_sha256)
        || !jsonU64(response, "admin_grant_epoch", &out.admin_grant_epoch)
        || !jsonBool(response, "device_grant_revalidated", &revalidated)
        || !jsonBool(response, "automatic_retry_allowed", &automaticRetry)
        || !jsonBool(response, "authority_effect", &authorityEffect)) {
        return failure("TICKET_REDEMPTION_READBACK_INVALID", status);
    }
    if (!uuid(out.ticket_id)
        || !uuid(out.device_id)
        || out.client_id.empty() || out.client_id.size() > 160
        || !lowerHex(out.key_fingerprint_sha256, 64)
        || !lowerHex(out.consumer_owner_sid_sha256, 64)
        || out.key_fingerprint_sha256 != keyFingerprintSha256
        || out.consumer_owner_sid_sha256 != ownerSidSha256
        || out.admin_grant_epoch < 1
        || !revalidated
        || automaticRetry
        || authorityEffect) {
        return failure("TICKET_REDEMPTION_BINDING_INVALID", status);
    }

    out.accepted = true;
    out.device_grant_revalidated = true;
    out.automatic_retry_allowed = false;
    out.authority_effect = false;
    out.reason = "ADMIN_DEVICE_TICKET_REDEEMED";
    return out;
}

const char* browserGuardianEnrollmentTicketClientContractJson() noexcept {
    return kContract;
}

}  // namespace metaengine::guardian
