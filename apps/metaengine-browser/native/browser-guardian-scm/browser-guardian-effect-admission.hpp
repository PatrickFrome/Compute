#pragma once
#include <atomic>
#include <cstdint>
#include <limits>

namespace metaengine::guardian {
class GuardianScmEffectOwner;
class GuardianChildCustody;

// Revocation ONLY, subordinate to every existing Owner/device/ticket check.
// Only the actual SCM owner (defined in its service translation unit) constructs
// this context. No public constructor, reset, caller flag or wire proof exists.
class GuardianEffectAdmission final {
public:
    GuardianEffectAdmission(const GuardianEffectAdmission&) = delete;
    GuardianEffectAdmission& operator=(const GuardianEffectAdmission&) = delete;
    bool stopped() const noexcept { return (state_.load(std::memory_order_acquire) & 1U) != 0; }
    bool admit() const noexcept {
        auto observed=state_.load(std::memory_order_acquire);
        for (;;) {
            if ((observed & 1U) != 0) return false;
            if (observed > (std::numeric_limits<std::uint64_t>::max)()-2) {
                state_.fetch_or(1U,std::memory_order_acq_rel);return false;
            }
            // This CAS and stop's fetch_or form the total admission order. An
            // admitted operation remains owned even if stop wins immediately
            // afterward; each later effect stage must acquire its own admission.
            if (state_.compare_exchange_weak(observed,observed+2,
                std::memory_order_acq_rel,std::memory_order_acquire)) return true;
        }
    }
private:
    GuardianEffectAdmission() noexcept = default;
    explicit GuardianEffectAdmission(GuardianChildCustody& children) noexcept : children_(&children) {}
    void stop() noexcept { state_.fetch_or(1U,std::memory_order_acq_rel); }
    mutable std::atomic<std::uint64_t> state_{0};
    GuardianChildCustody* const children_ = nullptr;
    friend class GuardianScmEffectOwner;
    friend class GuardianChildCustody;
};
}  // namespace metaengine::guardian
