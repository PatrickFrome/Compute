// Runs the ACTUAL portable production framing and cancellation primitive.
// Native Windows identity/pipe/source qualification is deliberately separate.
#include "../../native/browser-guardian-scm/browser-guardian-install-origin-wire.hpp"

#include <atomic>
#include <functional>
#include <future>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>
#include <type_traits>
#include <vector>

using namespace metaengine::guardian::detail;

namespace {
void require(bool value, const char* reason) { if (!value) throw std::runtime_error(reason); }

InstallOriginChallenge challenge() {
    InstallOriginChallenge value{};
    for (std::size_t i = 0; i < value.size(); ++i) value[i] = static_cast<std::uint8_t>(i + 1);
    return value;
}

InstallOriginFrame golden() {
    // Independent wire-contract oracle: fixed domain padded to 32, v1,
    // coordinator role, 14 zero reserved bytes, then the 32 challenge bytes.
    constexpr std::string_view bytes =
        "4d455441454e47494e455f494e5354414c4c5f4f524947494e5f5631000000000101"
        "00000000000000000000000000000102030405060708090a0b0c0d0e0f1011121314"
        "15161718191a1b1c1d1e1f20";
    static_assert(bytes.size() == 160);
    const auto digit = [](char c) { return c <= '9' ? c - '0' : c - 'a' + 10; };
    InstallOriginFrame out{};
    for (std::size_t i = 0; i < out.size(); ++i) out[i] = static_cast<std::uint8_t>(digit(bytes[2 * i]) * 16 + digit(bytes[2 * i + 1]));
    return out;
}

void bind(InstallOriginFence& fence) {
    require(fence.markMessageComplete(), "fixture_message_not_completed");
    require(fence.markPeerBound(), "fixture_peer_not_bound");
}

unsigned passed = 0, failed = 0;
void run(const char* name, const std::function<void()>& body) {
    try {
        body(); ++passed;
        std::cout << "{\"name\":\"" << name << "\",\"state\":\"PASS\"}\n";
    } catch (const std::exception& error) {
        ++failed;
        std::cout << "{\"name\":\"" << name << "\",\"state\":\"FAIL\",\"reason\":\"" << error.what() << "\"}\n";
    }
}
}  // namespace

int main() {
    static_assert(!std::is_copy_constructible_v<InstallOriginFence>);
    static_assert(!std::is_move_constructible_v<InstallOriginFence>);
    run("fixed_independent_binary_contract", [] {
        const auto nonce = challenge();
        const auto coordinator = makeInstallOriginFrame(InstallOriginRole::Coordinator, nonce);
        require(coordinator == golden(), "coordinator_wire_differs_from_fixed_contract");
        auto expected_bootstrap = golden(); expected_bootstrap[33] = 2;
        require(makeInstallOriginFrame(InstallOriginRole::Bootstrap, nonce) == expected_bootstrap, "bootstrap_wire_differs_from_fixed_contract");
        require(matchesInstallOriginFrame(coordinator, InstallOriginRole::Coordinator, nonce), "valid_coordinator_frame_refused");
        require(matchesInstallOriginFrame(expected_bootstrap, InstallOriginRole::Bootstrap, nonce), "valid_bootstrap_frame_refused");
    });
    run("all_zero_challenge_cannot_be_used", [] {
        const InstallOriginChallenge empty{};
        require(!validInstallOriginChallenge(empty), "zero_challenge_became_valid");
        const auto frame = makeInstallOriginFrame(InstallOriginRole::Coordinator, empty);
        require(!matchesInstallOriginFrame(frame, InstallOriginRole::Coordinator, empty), "zero_challenge_matched");
    });
    run("every_single_bit_mutation_is_refused", [] {
        const auto nonce = challenge();
        for (std::size_t i = 0; i < InstallOriginFrame{}.size(); ++i) {
            for (unsigned bit = 0; bit < 8; ++bit) {
                auto changed = golden(); changed[i] ^= static_cast<std::uint8_t>(1U << bit);
                require(!matchesInstallOriginFrame(changed, InstallOriginRole::Coordinator, nonce), "mutated_frame_matched");
            }
        }
    });
    run("partial_concatenated_and_trailing_frames_are_refused", [] {
        const auto value = golden(); const auto nonce = challenge();
        for (std::size_t size = 0; size < value.size(); ++size)
            require(!matchesInstallOriginFrame(std::span(value.data(), size), InstallOriginRole::Coordinator, nonce), "partial_frame_matched");
        std::vector<std::uint8_t> extended(value.begin(), value.end());
        for (unsigned i = 0; i < 80; ++i) {
            extended.push_back(0);
            require(!matchesInstallOriginFrame(extended, InstallOriginRole::Coordinator, nonce), "trailing_frame_matched");
        }
        extended.assign(value.begin(), value.end()); extended.insert(extended.end(), value.begin(), value.end());
        require(!matchesInstallOriginFrame(extended, InstallOriginRole::Coordinator, nonce), "concatenated_frame_matched");
    });
    run("wrong_challenge_and_role_are_refused", [] {
        const auto value = golden(); const auto nonce = challenge();
        require(!matchesInstallOriginFrame(value, InstallOriginRole::Bootstrap, nonce), "reflected_coordinator_frame_matched");
        for (std::size_t i = 0; i < nonce.size(); ++i) {
            auto changed = nonce; changed[i] ^= 0x80;
            require(!matchesInstallOriginFrame(value, InstallOriginRole::Coordinator, changed), "foreign_challenge_matched");
        }
        for (unsigned role : {0U, 3U, 255U}) {
            const auto invalid = static_cast<InstallOriginRole>(role);
            require(!matchesInstallOriginFrame(makeInstallOriginFrame(invalid, nonce), invalid, nonce), "invalid_role_matched");
        }
    });
    run("caller_identity_json_and_other_purposes_are_refused", [] {
        const auto nonce = challenge();
        for (const std::string message : {
                "{\"sid\":\"S-1-5-18\",\"pid\":1,\"verified\":true}",
                "METAENGINE_GUARDIAN_MAIN_RECOVERY_LAUNCH_V1",
                "METAENGINE_GUARDIAN_OWNER_ENROLLMENT_V1"}) {
            InstallOriginFrame padded{};
            require(message.size() < padded.size(), "fixture_foreign_message_too_long");
            for (std::size_t i = 0; i < message.size(); ++i) padded[i] = static_cast<std::uint8_t>(message[i]);
            require(!matchesInstallOriginFrame(padded, InstallOriginRole::Coordinator, nonce), "foreign_purpose_or_identity_json_matched");
        }
    });
    run("transport_order_is_required_before_one_claim", [] {
        InstallOriginFence fence;
        require(!fence.live() && !fence.claimOnce() && !fence.markPeerBound(), "unread_or_unbound_scope_claimed");
        require(fence.markMessageComplete() && !fence.markMessageComplete(), "message_was_replayable");
        require(!fence.claimOnce() && !fence.live(), "unbound_scope_claimed");
        require(fence.markPeerBound() && fence.live() && !fence.markPeerBound(), "peer_binding_order_failed");
        require(fence.claimOnce() && !fence.live(), "one_claim_not_consumed");
        require(!fence.claimOnce() && !fence.markMessageComplete() && !fence.markPeerBound(), "consumed_scope_replayed");
    });
    run("cancel_is_terminal_at_every_stage", [] {
        for (unsigned stage = 0; stage < 4; ++stage) {
            InstallOriginFence fence;
            if (stage >= 1) require(fence.markMessageComplete(), "fixture_message_step_failed");
            if (stage >= 2) require(fence.markPeerBound(), "fixture_peer_step_failed");
            if (stage >= 3) require(fence.claimOnce(), "fixture_claim_step_failed");
            fence.cancel(); fence.cancel();
            require(fence.cancelled() && !fence.live(), "cancel_was_not_terminal");
            require(!fence.markMessageComplete() && !fence.markPeerBound() && !fence.claimOnce(), "cancelled_scope_rearmed");
        }
    });
    run("concurrent_claim_has_exactly_one_winner", [] {
        InstallOriginFence fence; bind(fence);
        std::atomic<unsigned> wins{0}; std::promise<void> start; auto ready = start.get_future().share();
        std::vector<std::thread> threads;
        for (unsigned i = 0; i < 32; ++i) threads.emplace_back([&] { ready.wait(); if (fence.claimOnce()) wins.fetch_add(1); });
        start.set_value(); for (auto& thread : threads) thread.join();
        require(wins.load() == 1 && !fence.live(), "one_use_claim_had_multiple_or_no_winners");
        require(!fence.claimOnce(), "winner_left_replayable_scope");
    });
    run("cancel_before_claim_deterministically_wins", [] {
        InstallOriginFence fence; bind(fence);
        std::promise<void> release; auto ready = release.get_future(); bool accepted = true;
        std::thread thread([&] { ready.wait(); accepted = fence.claimOnce(); });
        fence.cancel(); release.set_value(); thread.join();
        require(!accepted && fence.cancelled() && !fence.live(), "claim_ignored_prior_cancel");
    });
    run("claim_before_cancel_never_authorizes_a_later_stage", [] {
        InstallOriginFence fence; bind(fence);
        std::promise<void> claimed, finish; auto claimed_future = claimed.get_future(); auto finish_future = finish.get_future();
        bool first = false, second = true;
        std::thread thread([&] { first = fence.claimOnce(); claimed.set_value(); finish_future.wait(); second = fence.claimOnce(); });
        claimed_future.wait(); fence.cancel(); finish.set_value(); thread.join();
        require(first && !second && fence.cancelled() && !fence.live(), "cancelled_claim_authorized_another_stage");
    });
    run("cancel_vs_claim_race_cannot_revive_scope", [] {
        for (unsigned iteration = 0; iteration < 64; ++iteration) {
            InstallOriginFence fence; bind(fence);
            std::promise<void> start; auto ready = start.get_future().share();
            std::atomic<unsigned> wins{0};
            std::thread claimant([&] { ready.wait(); if (fence.claimOnce()) wins.fetch_add(1); });
            std::thread cancel([&] { ready.wait(); fence.cancel(); });
            start.set_value(); claimant.join(); cancel.join();
            require(wins.load() <= 1 && fence.cancelled() && !fence.live() && !fence.claimOnce(), "race_revived_or_replayed_scope");
        }
    });
    std::cout << "{\"name\":\"summary\",\"schema\":\"metaengine.guardian.install-origin-portable-tests.v1\",\"state\":\""
        << (failed == 0 ? "PASS" : "FAIL") << "\",\"tests_passed\":" << passed << ",\"tests_failed\":" << failed
        << ",\"authority_effect\":false,\"windows_identity_execution\":\"UNQUALIFIED\","
        << "\"classification\":\"ACTUAL_PRODUCTION_PORTABLE_PROTOCOL_NOT_INSTALL_SCOPE\"}\n";
    return failed == 0 ? 0 : 1;
}
