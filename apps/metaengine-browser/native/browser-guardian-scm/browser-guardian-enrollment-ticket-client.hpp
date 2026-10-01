#pragma once

#include <cstdint>
#include <string>

namespace metaengine::guardian {

struct GuardianEnrollmentTicketRedemption {
    bool transport_proven = false;
    bool accepted = false;
    bool device_grant_revalidated = false;
    bool automatic_retry_allowed = false;
    bool authority_effect = false;
    unsigned long http_status = 0;
    std::uint64_t admin_grant_epoch = 0;
    std::string reason;
    std::string ticket_id;
    std::string client_id;
    std::string device_id;
    std::string key_fingerprint_sha256;
    std::string consumer_owner_sid_sha256;
};

// Redeems one already-issued short-lived ticket at a fixed METAENGINE Edge route.
// The caller cannot supply host/path/headers. Windows WinHTTP performs ordinary TLS
// validation and redirects are disabled. This adapter owns no owner-store or SCM effect.
GuardianEnrollmentTicketRedemption redeemBrowserGuardianEnrollmentTicket(
    const std::string& ticket,
    const std::string& key_fingerprint_sha256,
    const std::string& owner_sid_sha256);

const char* browserGuardianEnrollmentTicketClientContractJson() noexcept;

}  // namespace metaengine::guardian
