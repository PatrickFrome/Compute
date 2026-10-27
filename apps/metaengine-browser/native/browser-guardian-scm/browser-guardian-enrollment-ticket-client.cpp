#include "browser-guardian-enrollment-ticket-client.hpp"

#include <algorithm>
#include <cctype>
#include <string_view>

namespace metaengine::guardian {
namespace {
constexpr char kContract[] =
    "{\"schema\":\"metaengine.browser-guardian.enrollment-ticket-native-client.v1\","
    "\"version\":\"1.0.0\","
    "\"authenticated_local_owner_bridge_required\":true,"
    "\"hosted_redemption_allowed\":false,"
    "\"network_dispatch_allowed\":false,"
    "\"caller_supplied_url_allowed\":false,"
    "\"caller_supplied_headers_allowed\":false,"
    "\"caller_receipt_is_authority\":false,"
    "\"automatic_retry_allowed\":false,"
    "\"owner_store_effect_allowed\":false,"
    "\"scm_effect_allowed\":false,"
    "\"authority_effect\":false}";

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
}  // namespace

GuardianEnrollmentTicketRedemption redeemBrowserGuardianEnrollmentTicket(
    const std::string& ticket,
    const std::string& keyFingerprintSha256,
    const std::string& ownerSidSha256) {
    GuardianEnrollmentTicketRedemption out;
    if (!base64Url(ticket, 43) || !lowerHex(keyFingerprintSha256, 64) || !lowerHex(ownerSidSha256, 64)) {
        out.reason = "TICKET_REDEMPTION_INPUT_INVALID";
        return out;
    }
    // A local DB receipt, fresh device signature or caller-supplied address is
    // NOT native admission. No accepted path remains while the independently
    // authenticated installed-package/runtime bridge is missing. In particular
    // never send an own-local ticket to the previous hosted authority.
    out.reason = "LOCAL_OWNER_BRIDGE_REQUIRED";
    return out;
}

const char* browserGuardianEnrollmentTicketClientContractJson() noexcept {
    return kContract;
}
}  // namespace metaengine::guardian
