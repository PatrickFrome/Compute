#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <span>
#include <string_view>

namespace metaengine::guardian::detail {

// Bounded protocol correlation only. These bytes/state never assert SID, PID,
// release provenance, installation consent or permission to execute an effect.
using InstallOriginChallenge = std::array<std::uint8_t, 32>;
using InstallOriginFrame = std::array<std::uint8_t, 80>;
enum class InstallOriginRole : std::uint8_t { Coordinator = 1, Bootstrap = 2 };

inline bool validInstallOriginChallenge(const InstallOriginChallenge& challenge) {
    for (auto byte : challenge) if (byte != 0) return true;
    return false;
}

inline InstallOriginFrame makeInstallOriginFrame(InstallOriginRole sender,
    const InstallOriginChallenge& challenge) {
    InstallOriginFrame out{};
    constexpr std::string_view domain = "METAENGINE_INSTALL_ORIGIN_V1";
    static_assert(domain.size() <= 32);
    for (std::size_t i = 0; i < domain.size(); ++i) out[i] = static_cast<std::uint8_t>(domain[i]);
    out[32] = 1;
    out[33] = static_cast<std::uint8_t>(sender);
    for (std::size_t i = 0; i < challenge.size(); ++i) out[48 + i] = challenge[i];
    return out;
}

inline bool matchesInstallOriginFrame(std::span<const std::uint8_t> bytes,
    InstallOriginRole expectedSender, const InstallOriginChallenge& challenge) {
    if (bytes.size() != InstallOriginFrame{}.size() || !validInstallOriginChallenge(challenge) ||
        (expectedSender != InstallOriginRole::Coordinator && expectedSender != InstallOriginRole::Bootstrap)) return false;
    const auto exact = makeInstallOriginFrame(expectedSender, challenge);
    for (std::size_t i = 0; i < exact.size(); ++i) if (bytes[i] != exact[i]) return false;
    return true;
}

// Actual native transport ordering/cancellation, not an authority object. A
// kernel peer and its original process/token must be checked independently.
class InstallOriginFence final {
public:
    bool markMessageComplete() noexcept { return advance(0, 1); }
    bool markPeerBound() noexcept { return advance(1, 2); }
    bool claimOnce() noexcept { return advance(2, 3); }
    bool live() const noexcept { return state_.load(std::memory_order_acquire) == 2; }
    void cancel() noexcept { state_.store(4, std::memory_order_release); }
    bool cancelled() const noexcept { return state_.load(std::memory_order_acquire) == 4; }
private:
    std::atomic<unsigned char> state_{0};
    bool advance(unsigned char expected, unsigned char desired) noexcept {
        return state_.compare_exchange_strong(expected, desired, std::memory_order_acq_rel, std::memory_order_acquire);
    }
};

}  // namespace metaengine::guardian::detail
