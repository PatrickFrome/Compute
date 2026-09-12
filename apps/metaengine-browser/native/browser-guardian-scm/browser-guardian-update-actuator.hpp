#pragma once

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <cstdint>
#include <string>

#include "browser-guardian-owner-enrollment-observer.hpp"
#include "browser-guardian-owner-enrollment-store.hpp"

namespace metaengine::guardian {

constexpr wchar_t kBrowserGuardianUpdatePipeName[] = L"\\\\.\\pipe\\METAENGINEBrowserGuardianUpdateV1";

struct GuardianUpdateActuatorResult {
    std::string state;
    std::string reason;
    DWORD win32_error = ERROR_SUCCESS;
    DWORD pid = 0;
    DWORD session_id = 0;
    DWORD client_pid = 0;
    std::uint64_t creation_time_100ns = 0;
    std::string process_incarnation_id;
    std::string expected_owner_sid;
    std::string enrollment_evidence_sha256;
    std::string device_key_fingerprint_sha256;
    std::string installed_executable_sha256;
    bool owner_binding_proven = false;
    bool device_binding_proven = false;
    bool effect_absent_proven = false;
    bool exact_ready_binding = false;
    bool physical_dispatch_performed = false;
    bool automatic_retry_allowed = false;
};

// Handles one already-read local pipe request. `client` must come from the
// impersonated named-pipe token and `owner` from the machine-secure durable owner
// store. The wire request cannot provide a path, URL, shell string, owner SID or
// session id. Those values are derived locally and all effectful execution is
// fenced by the native write-ahead effect record.
GuardianUpdateActuatorResult handleGuardianUpdateActuatorRequest(
    const std::string& wire_request,
    const OwnerEnrollmentObservation& client,
    const OwnerEnrollmentStoreResult& owner);

std::string serializeGuardianUpdateActuatorResult(const GuardianUpdateActuatorResult& result);

const char* browserGuardianUpdateActuatorContractJson() noexcept;
bool browserGuardianUpdateActuatorSelfTest() noexcept;

}  // namespace metaengine::guardian
