// Explicit synthetic core for exercising the UNMODIFIED production N-API
// wrapper's async ownership, actual Node-API calls and cancellation. No pipe,
// Windows handle, Guardian identity, source proof or launch is qualified here.
#include "browser-guardian-connected-peer.hpp"

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <mutex>
#include <thread>

namespace metaengine::guardian {

struct GuardianConnectedPeer::State {
    std::atomic<bool> cancel{false};
    std::mutex guard;
    bool closed = false;
    unsigned reads = 0;
};
GuardianConnectedPeer::GuardianConnectedPeer() : state_(std::make_unique<State>()) {}
GuardianConnectedPeer::~GuardianConnectedPeer() { close(); }
std::unique_ptr<GuardianConnectedPeer> GuardianConnectedPeer::create() {
    return std::unique_ptr<GuardianConnectedPeer>(new GuardianConnectedPeer());
}
std::unique_ptr<GuardianConnectedPeer> GuardianConnectedPeer::connect() {
    auto peer = create();
    peer->connectOriginal();
    return peer;
}
bool GuardianConnectedPeer::connectOriginal() {
    std::lock_guard<std::mutex> lock(state_->guard);
    if (std::getenv("GUARDIAN_NAPI_SYNTHETIC_SLOW_OPEN")) {
        for (int i = 0; i < 2500 && !state_->cancel.load(); ++i)
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    return !state_->cancel.load();
}
void GuardianConnectedPeer::requestCancel() noexcept { state_->cancel.store(true); }
bool GuardianConnectedPeer::recheck() {
    std::lock_guard<std::mutex> lock(state_->guard);
    for (int i = 0; i < 2500 && !state_->cancel.load(); ++i)
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    ++state_->reads;
    return !state_->cancel.load();
}
std::string GuardianConnectedPeer::snapshotJson() const {
    std::lock_guard<std::mutex> lock(state_->guard);
    return std::string("{\"fixture_classification\":\"SYNTHETIC_CORE_NOT_WINDOWS\",\"closed\":") +
        (state_->closed ? "true" : "false") + ",\"rechecks\":" + std::to_string(state_->reads) + "}";
}
void GuardianConnectedPeer::close() noexcept {
    requestCancel();
    std::lock_guard<std::mutex> lock(state_->guard);
    state_->closed = true;
}

}  // namespace metaengine::guardian
