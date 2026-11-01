#pragma once

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <cstdint>
#include <string>

#include "browser-guardian-owner-enrollment-observer.hpp"
#include "browser-guardian-owner-enrollment-store.hpp"
#include "browser-guardian-effect-admission.hpp"

namespace metaengine::guardian {

// Windows custody, not effect authority. Only the SCM worker reserves slots;
// its owner joins that worker before draining. A subsequent reservation may
// reap terminal predecessors, never a slot still borrowed by a launcher.
// The admission binding is private and cannot be reset.
class GuardianChildCustody final {
public:
    class Child final {
    public:
        Child(const Child&) = delete;
        Child& operator=(const Child&) = delete;
        HANDLE get() const noexcept { return information_.hProcess; }
        PROCESS_INFORMATION& creationResult() noexcept { return information_; }
    private:
        Child() noexcept = default;
        PROCESS_INFORMATION information_{};
        Child* next_ = nullptr;
        friend class GuardianChildCustody;
    };
    GuardianChildCustody() noexcept = default;
    ~GuardianChildCustody() noexcept;
    GuardianChildCustody(const GuardianChildCustody&) = delete;
    GuardianChildCustody& operator=(const GuardianChildCustody&) = delete;
    static Child* reserve(const GuardianEffectAdmission& admission) noexcept;
    void join() noexcept;
private:
    static bool releaseTerminal(Child& child, DWORD timeout) noexcept;
    void reapTerminal() noexcept;
    Child* children_ = nullptr;
};

constexpr wchar_t kBrowserGuardianUpdatePipeName[] = L"\\\\.\\pipe\\METAENGINEBrowserGuardianUpdateV1";

struct GuardianUpdateActuatorResult {
    std::string state;
    std::string reason;
    DWORD win32_error = ERROR_SUCCESS;
    DWORD pid = 0;
    DWORD session_id = 0;
    DWORD client_pid = 0;
    // Separate from installer PID/birth; derived from the authenticated pipe.
    std::string client_creation_time_100ns;
    std::string client_process_incarnation_id;
    bool client_kernel_birth_rechecked = false;
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
// fenced by the native write-ahead effect record. Missing original service
// admission context refuses effects; a caller boolean cannot replace it.
GuardianUpdateActuatorResult handleGuardianUpdateActuatorRequest(
    const std::string& wire_request,
    const OwnerEnrollmentObservation& client,
    const OwnerEnrollmentStoreResult& owner,
    const GuardianEffectAdmission* admission = nullptr);

std::string serializeGuardianUpdateActuatorResult(const GuardianUpdateActuatorResult& result);

const char* browserGuardianUpdateActuatorContractJson() noexcept;
bool browserGuardianUpdateActuatorSelfTest() noexcept;

}  // namespace metaengine::guardian
