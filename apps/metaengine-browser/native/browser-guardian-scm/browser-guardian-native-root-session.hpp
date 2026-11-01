#pragma once

#include <memory>
#include <string>

#include "browser-guardian-update-actuator.hpp"

namespace metaengine::guardian {

// Owned by the existing SCM worker, never by a wire request or by the Browser.
// There is deliberately no constructor/factory accepting a path, owner record,
// verification flags, root/token HANDLE, or deserialized identity. The only producer reads
// the connected pipe, durable owner store and exact WTS token itself.
// The service-owned admission context and borrowed stop event only revoke work.
class GuardianNativeRootSession final {
public:
    GuardianNativeRootSession(const GuardianEffectAdmission& admission, HANDLE stop_event);
    ~GuardianNativeRootSession();
    GuardianNativeRootSession(const GuardianNativeRootSession&) = delete;
    GuardianNativeRootSession& operator=(const GuardianNativeRootSession&) = delete;
    GuardianNativeRootSession(GuardianNativeRootSession&&) = delete;
    GuardianNativeRootSession& operator=(GuardianNativeRootSession&&) = delete;

    // Call only after the bounded read on this pipe has completed. PROBE remains
    // read-only: retaining on-disk custody is neither launch permission nor a
    // release-signature/loaded-runtime-code attestation.
    GuardianUpdateActuatorResult handleReadRequest(
        const std::string& wire_request, OwnerEnrollmentPipe& connected_pipe);

private:
    struct State;
    std::unique_ptr<State> state_;
    const GuardianEffectAdmission& admission_;
    HANDLE stop_event_ = nullptr;  // Borrowed from the SCM worker, never exported.
};

}  // namespace metaengine::guardian
