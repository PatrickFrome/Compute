// Portable diagnostic of the ACTUAL admission primitive. The forwarded action
// below is a counter, not an OS effect, process launch or Windows qualification.
// Admission-before-stop is an original owned in-flight action under the agreed
// contract; this diagnostic does not exercise that action's terminal ownership.
// The optional physical-start assertion is explicitly a STRONGER contract.
#include "../../native/browser-guardian-scm/browser-guardian-effect-admission.hpp"

#include <future>
#include <iostream>
#include <string_view>
#include <thread>
#include <type_traits>

namespace metaengine::guardian {
// Explicit test-only owner fixture. This is not an authenticated SCM producer.
class GuardianScmEffectOwner final {
public:
    const GuardianEffectAdmission& context() const noexcept { return context_; }
    void requestStop() noexcept { context_.stop(); }
private:
    GuardianEffectAdmission context_;
};
}

int main(int argc, char** argv) {
    using namespace metaengine::guardian;
    static_assert(!std::is_default_constructible_v<GuardianEffectAdmission>);
    static_assert(!std::is_constructible_v<GuardianEffectAdmission, bool>);
    bool require_strong = false;
    if (argc == 2 && std::string_view(argv[1]) == "--require-stop-before-physical-effect") require_strong = true;
    else if (argc != 1) return 64;

    GuardianScmEffectOwner owner;
    std::promise<void> admitted;
    std::promise<void> forward;
    auto admitted_future = admitted.get_future();
    auto forward_future = forward.get_future();
    bool admission_won = false;
    bool forwarded_after_stop = false;
    bool later_admission_refused = false;
    std::thread worker([&] {
        admission_won = owner.context().admit();
        admitted.set_value();
        forward_future.get();
        // Same preemption point as CAS -> CreateProcessAsUserW/ResumeThread.
        // Only a generated fixture counter is forwarded here.
        forwarded_after_stop = admission_won && owner.context().stopped();
        later_admission_refused = !owner.context().admit();
    });
    admitted_future.get();
    owner.requestStop();
    const bool stop_returned_before_forward = owner.context().stopped();
    forward.set_value();
    worker.join();
    const bool reproduced = admission_won && stop_returned_before_forward
        && forwarded_after_stop && later_admission_refused;
    const bool ok = reproduced && !require_strong;
    std::cout << "{\"schema\":\"metaengine.browser-guardian.effect-admission-gap-diagnostic.v1\","
        "\"ok\":" << (ok ? "true" : "false")
        << ",\"diagnostic_only\":true,\"actual_admission_primitive_exercised\":true,"
           "\"authenticated_scm_producer_exercised\":false,\"os_effects_exercised\":false,"
           "\"admission_before_stop_is_owned_in_flight\":true,\"terminal_ownership_exercised\":false,"
           "\"original_admission_order_satisfied\":" << (later_admission_refused ? "true" : "false")
        << ",\"stronger_contract_assertion_requested\":" << (require_strong ? "true" : "false")
        << ",\"gap_reproduced\":" << (reproduced ? "true" : "false")
        << ",\"stronger_physical_start_contract_satisfied\":" << (forwarded_after_stop ? "false" : "true")
        << ",\"later_admission_refused\":" << (later_admission_refused ? "true" : "false")
        << ",\"authority_effect\":false}\n";
    return ok ? 0 : 1;
}
