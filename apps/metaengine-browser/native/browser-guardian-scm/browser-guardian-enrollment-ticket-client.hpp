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

// Deny-only while independently authenticated installed local broker admission
// is unavailable. No cloud/localhost network, caller receipt, owner-store or SCM
// effect is accepted. Existing durable owner readback is a separate operation.
GuardianEnrollmentTicketRedemption redeemBrowserGuardianEnrollmentTicket(
    const std::string& ticket,
    const std::string& key_fingerprint_sha256,
    const std::string& owner_sid_sha256);

const char* browserGuardianEnrollmentTicketClientContractJson() noexcept;

}  // namespace metaengine::guardian
