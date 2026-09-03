#pragma once

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <cstdint>
#include <string>

namespace metaengine::guardian {

enum class BrokerDispatchState {
    NoEffectProven,
    Dispatched,
    Ambiguous,
};

struct BrokerLaunchRequest {
    DWORD session_id = 0;
    std::wstring expected_owner_sid;
    std::wstring broker_executable;
    std::wstring effect_id;
    std::uint64_t effect_generation = 0;
};

struct BrokerLaunchResult {
    BrokerDispatchState state = BrokerDispatchState::Ambiguous;
    DWORD win32_error = ERROR_SUCCESS;
    std::string reason;
    DWORD pid = 0;
    std::uint64_t creation_time_100ns = 0;
    std::wstring process_incarnation_id;
    DWORD session_id = 0;
    std::wstring user_sid;
    bool created_suspended = false;
    bool exact_session_binding = false;
    bool exact_process_binding = false;
    bool kill_on_close_job_binding = false;
    bool resumed = false;
    bool child_never_resumed = false;
    bool exact_created_process_terminated = false;
};

// The Guardian, not the Broker, owns this lease. The Job Object handle is never
// duplicated into the Broker. Destroying the last Guardian-owned lease closes the Job
// handle and therefore terminates the Broker tree through KILL_ON_JOB_CLOSE.
class BrokerLease {
public:
    BrokerLease() = default;
    ~BrokerLease();

    BrokerLease(const BrokerLease&) = delete;
    BrokerLease& operator=(const BrokerLease&) = delete;

    BrokerLease(BrokerLease&& other) noexcept;
    BrokerLease& operator=(BrokerLease&& other) noexcept;

    bool valid() const noexcept;
    DWORD pid() const noexcept;
    HANDLE process_handle() const noexcept;
    HANDLE job_handle() const noexcept;
    void reset() noexcept;

private:
    friend BrokerLaunchResult launchExactSessionBroker(const BrokerLaunchRequest&, BrokerLease*);

    HANDLE process_ = nullptr;
    HANDLE job_ = nullptr;
    DWORD pid_ = 0;
};

// Read-only self-description for the native boundary. The module itself never decides
// when a Broker launch is allowed. Callers must first satisfy the durable Session Broker
// planner + effect journal + effect gate and pass the exact resulting identity.
const char* browserGuardianSessionBrokerWtsExecutorContractJson() noexcept;

// Performs at most one exact START_BROKER OS effect. There is no retry loop.
// On success the caller must retain BrokerLease for the lifetime of the Broker.
BrokerLaunchResult launchExactSessionBroker(
    const BrokerLaunchRequest& request,
    BrokerLease* lease_out);

}  // namespace metaengine::guardian
