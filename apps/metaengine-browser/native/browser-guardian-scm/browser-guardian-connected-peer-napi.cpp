// In-process Node-API bridge. The connected pipe is opened by this process,
// never by a sidecar whose pipe-client PID would be a different principal.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#define NAPI_VERSION 9
#include <node_api.h>

#include "browser-guardian-connected-peer.hpp"

#include <atomic>
#include <cstring>
#include <iterator>
#include <memory>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

namespace {

template<class Function>
bool hostFunction(HMODULE host, const char* name, Function* output) {
    const FARPROC address = host ? GetProcAddress(host, name) : nullptr;
    static_assert(sizeof(address) == sizeof(*output));
    if (!address) return false;
    // Avoid incompatible-function-cast diagnostics; these exact exports use the
    // official Node-API declarations and the same Windows host calling ABI.
    std::memcpy(output, &address, sizeof(*output));
    return true;
}

// Resolve only stable Node-API exports in the already running host executable.
// There is no node.lib/Electron DLL-name indirection and no LoadLibrary search.
struct Api {
#define GUARDIAN_NAPI_FUNCTIONS(X) \
    X(napi_get_cb_info) X(napi_get_undefined) X(napi_throw_error) \
    X(napi_create_string_utf8) X(napi_create_error) X(napi_create_promise) \
    X(napi_resolve_deferred) X(napi_reject_deferred) X(napi_create_object) \
    X(napi_create_function) X(napi_set_named_property) X(napi_wrap) X(napi_unwrap) \
    X(napi_type_tag_object) X(napi_check_object_type_tag) \
    X(napi_create_reference) X(napi_delete_reference) \
    X(napi_create_async_work) X(napi_queue_async_work) X(napi_delete_async_work) \
    X(napi_set_instance_data) X(napi_add_env_cleanup_hook)
#define FIELD(name) decltype(&name) name##_fn = nullptr;
    GUARDIAN_NAPI_FUNCTIONS(FIELD)
#undef FIELD
    bool load() {
        const HMODULE host = GetModuleHandleW(nullptr);
        if (!host) return false;
#define LOAD(name) \
        if (!hostFunction(host, #name, &name##_fn)) return false;
        GUARDIAN_NAPI_FUNCTIONS(LOAD)
#undef LOAD
        return true;
    }
};

struct Peer;
struct Addon {
    Api api;
    std::atomic<bool> closing{false};
    std::mutex peers_mutex;
    std::vector<std::weak_ptr<Peer>> peers;
};

struct Peer {
    std::shared_ptr<Addon> addon;
    // The cancellable core is installed before OPEN is queued and never replaced.
    // Shared ownership, not a JS property/JSON object, owns this native scope.
    std::mutex core_mutex;
    std::unique_ptr<metaengine::guardian::GuardianConnectedPeer> core;
    std::mutex cache_mutex;
    std::string completed_snapshot;
    std::atomic<bool> rechecking{false};
    std::atomic<bool> closing{false};

    explicit Peer(std::shared_ptr<Addon> owner) : addon(std::move(owner)) {}
    ~Peer() { if (core) core->close(); }
    metaengine::guardian::GuardianConnectedPeer* get() {
        std::lock_guard<std::mutex> lock(core_mutex);
        return core.get();
    }
    void cache(const std::string& value) {
        std::lock_guard<std::mutex> lock(cache_mutex);
        completed_snapshot = value;
    }
    std::string snapshot() {
        // Never perform a kernel/SCM/hash operation on the JS event-loop thread.
        std::lock_guard<std::mutex> lock(cache_mutex);
        return completed_snapshot;
    }
};

struct WrappedPeer { std::shared_ptr<Peer> peer; };
struct AddonHolder { std::shared_ptr<Addon> addon; };
constexpr napi_type_tag kPeerTag{0x0735b71c9da14fe3ULL, 0xa91f49e60bc252d1ULL};
enum class Operation { Open, Recheck, Close };
struct Work {
    std::shared_ptr<Peer> peer;
    Operation operation = Operation::Open;
    napi_deferred deferred = nullptr;
    napi_async_work work = nullptr;
    napi_ref original_js_peer = nullptr;
    std::string snapshot;
    const char* error = nullptr;
};

napi_value undefined(napi_env env, Api& api) {
    napi_value value = nullptr;
    api.napi_get_undefined_fn(env, &value);
    return value;
}
napi_value fail(napi_env env, Api& api, const char* reason) {
    api.napi_throw_error_fn(env, reason, reason);
    return nullptr;
}
bool noArguments(napi_env env, napi_callback_info info, Api& api, napi_value* receiver, void** data) {
    std::size_t count = 1;
    napi_value argument = nullptr;
    if (api.napi_get_cb_info_fn(env, info, &count, &argument, receiver, data) != napi_ok || count != 0) {
        fail(env, api, "guardian_connected_peer_arguments_forbidden");
        return false;
    }
    return true;
}

void finalizePeer(napi_env /*env*/, void* data, void* /*hint*/) {
    // Work keeps its own shared Peer ownership through native completion, even
    // when environment teardown finalizes the JS wrapper before its completion.
    delete static_cast<WrappedPeer*>(data);
}
void finalizeAddon(napi_env /*env*/, void* data, void* /*hint*/) {
    delete static_cast<AddonHolder*>(data);
}
void cancelPublished(const std::shared_ptr<Addon>& addon) {
    // Revocation only: neither this lock nor requestCancel performs I/O, joins
    // work, or waits for the core's operation mutex. OPEN has already published
    // its cancellable core even when there is no public JS Peer object yet.
    std::lock_guard<std::mutex> lock(addon->peers_mutex);
    for (auto& weak : addon->peers) {
        if (auto peer = weak.lock()) {
            peer->closing.store(true, std::memory_order_release);
            if (auto* core = peer->get()) core->requestCancel();
        }
    }
}
void cleanupAddon(void* data) noexcept {
    // Cleanup registration owns a separate holder from instance-data finalizing;
    // neither callback relies on the ordering of the other one's raw storage.
    // Node may defer this hook until its native async work drains. Explicit
    // owner cancellation is immediate; environment termination time is not
    // qualified by this hook or by the shared-ownership memory-safety guarantee.
    std::unique_ptr<AddonHolder> cleanup_holder(static_cast<AddonHolder*>(data));
    const auto addon = cleanup_holder->addon;
    addon->closing.store(true, std::memory_order_release);
    try {
    cancelPublished(addon);
    std::vector<std::shared_ptr<Peer>> peers;
    {
        std::lock_guard<std::mutex> lock(addon->peers_mutex);
        for (auto& weak : addon->peers) if (auto peer = weak.lock()) peers.push_back(std::move(peer));
    }
    for (auto& peer : peers) if (auto* core = peer->get()) core->close();
    } catch (...) {
        // Existing Work/peer shared owners still retain their native scopes.
        // No exception may cross the Node environment cleanup boundary.
    }
}

napi_value cancelPending(napi_env env, napi_callback_info info) {
    decltype(&napi_get_cb_info) getInfo = nullptr;
    hostFunction(GetModuleHandleW(nullptr), "napi_get_cb_info", &getInfo);
    std::size_t count = 1;
    napi_value argument = nullptr, receiver = nullptr;
    void* data = nullptr;
    if (!getInfo || getInfo(env, info, &count, &argument, &receiver, &data) != napi_ok || !data) return nullptr;
    const auto addon = static_cast<AddonHolder*>(data)->addon;
    if (!noArguments(env, info, addon->api, &receiver, &data)) return nullptr;
    try {
        cancelPublished(addon);
        // Do not mark the Addon closing. New, separately owned observations are
        // allowed after revoking all of the scopes that were already published.
        return undefined(env, addon->api);
    } catch (...) { return fail(env, addon->api, "guardian_connected_peer_native_failure"); }
}

std::shared_ptr<Peer> unwrap(napi_env env, napi_callback_info info, napi_value* receiver) {
    std::size_t count = 1;
    napi_value argument = nullptr;
    void* raw = nullptr;
    // Api's address is bound as native callback data, never accepted from JS.
    // Read it without using any import beyond the fixed host function pointer.
    const HMODULE host = GetModuleHandleW(nullptr);
    decltype(&napi_get_cb_info) getInfo = nullptr;
    hostFunction(host, "napi_get_cb_info", &getInfo);
    if (!getInfo || getInfo(env, info, &count, &argument, receiver, &raw) != napi_ok || !raw) return {};
    auto& api = *static_cast<Api*>(raw);
    if (count != 0) { fail(env, api, "guardian_connected_peer_arguments_forbidden"); return {}; }
    bool matches = false;
    if (api.napi_check_object_type_tag_fn(env, *receiver, &kPeerTag, &matches) != napi_ok || !matches) {
        fail(env, api, "guardian_connected_peer_receiver_invalid"); return {};
    }
    void* wrapped = nullptr;
    if (api.napi_unwrap_fn(env, *receiver, &wrapped) != napi_ok || !wrapped) {
        fail(env, api, "guardian_connected_peer_receiver_invalid"); return {};
    }
    return static_cast<WrappedPeer*>(wrapped)->peer;
}

napi_value snapshot(napi_env env, napi_callback_info info) {
    napi_value receiver = nullptr;
    const auto peer = unwrap(env, info, &receiver);
    if (!peer) return nullptr;
    auto& api = peer->addon->api;
    try {
        const auto cached = peer->snapshot();
        napi_value value = nullptr;
        if (api.napi_create_string_utf8_fn(env, cached.data(), cached.size(), &value) != napi_ok) return nullptr;
        return value;
    } catch (...) { return fail(env, api, "guardian_connected_peer_native_failure"); }
}

void execute(napi_env /*env*/, void* data) {
    auto& work = *static_cast<Work*>(data);
    try {
        if (work.operation == Operation::Open) {
            if (work.peer->addon->closing.load(std::memory_order_acquire)) { work.error = "guardian_connected_peer_environment_closed"; return; }
            auto* core = work.peer->get();
            if (!core) { work.error = "guardian_connected_peer_native_scope_missing"; return; }
            core->connectOriginal();
            work.snapshot = core->snapshotJson();
            if (work.peer->addon->closing.load(std::memory_order_acquire) || work.peer->closing.load(std::memory_order_acquire)) {
                core->close();
                work.error = "guardian_connected_peer_environment_closed";
            }
            return;
        }
        auto* core = work.peer->get();
        if (!core) { work.error = "guardian_connected_peer_native_scope_missing"; return; }
        if (work.operation == Operation::Close) core->close();
        else {
            if (work.peer->closing.load(std::memory_order_acquire)) { work.error = "guardian_connected_peer_closed"; return; }
            core->recheck();
        }
        work.snapshot = core->snapshotJson();
    } catch (...) {
        work.error = "guardian_connected_peer_native_failure";
        // Keep the original core owned, but revoke its live scope after failure.
        if (auto* core = work.peer->get()) core->close();
    }
}

napi_value queue(napi_env env, const std::shared_ptr<Peer>& peer, Operation operation, napi_value receiver);
napi_value recheck(napi_env env, napi_callback_info info) {
    napi_value receiver = nullptr;
    const auto peer = unwrap(env, info, &receiver);
    if (!peer) return nullptr;
    auto& api = peer->addon->api;
    if (peer->addon->closing.load(std::memory_order_acquire) || peer->closing.load(std::memory_order_acquire))
        return fail(env, api, "guardian_connected_peer_closed");
    if (peer->rechecking.exchange(true, std::memory_order_acq_rel)) return fail(env, api, "guardian_connected_peer_recheck_pending");
    return queue(env, peer, Operation::Recheck, receiver);
}
napi_value close(napi_env env, napi_callback_info info) {
    napi_value receiver = nullptr;
    const auto peer = unwrap(env, info, &receiver);
    if (!peer) return nullptr;
    try {
        peer->closing.store(true, std::memory_order_release);
        // Set the cancellation event NOW on the JS thread. Joined close may wait
        // for the pool, but cancellation must not queue behind the work it cancels.
        if (auto* core = peer->get()) core->requestCancel();
        return queue(env, peer, Operation::Close, receiver);
    } catch (...) { return fail(env, peer->addon->api, "guardian_connected_peer_native_failure"); }
}

napi_value wrapPeer(napi_env env, const std::shared_ptr<Peer>& peer) {
    auto& api = peer->addon->api;
    napi_value object = nullptr;
    if (api.napi_create_object_fn(env, &object) != napi_ok) return nullptr;
    auto wrapped = std::make_unique<WrappedPeer>();
    wrapped->peer = peer;
    if (api.napi_wrap_fn(env, object, wrapped.get(), finalizePeer, nullptr, nullptr) != napi_ok) return nullptr;
    wrapped.release();
    if (api.napi_type_tag_object_fn(env, object, &kPeerTag) != napi_ok) return nullptr;
    const struct { const char* name; napi_callback callback; } methods[] = {
        {"snapshot", snapshot}, {"recheck", recheck}, {"close", close}};
    for (const auto& method : methods) {
        napi_value function = nullptr;
        if (api.napi_create_function_fn(env, method.name, NAPI_AUTO_LENGTH, method.callback, &api, &function) != napi_ok ||
            api.napi_set_named_property_fn(env, object, method.name, function) != napi_ok) return nullptr;
    }
    return object;
}

void complete(napi_env env, napi_status status, void* data) {
    std::unique_ptr<Work> work(static_cast<Work*>(data));
    auto& api = work->peer->addon->api;
    if (work->operation == Operation::Recheck) work->peer->rechecking.store(false, std::memory_order_release);
    if (status != napi_ok && !work->error) work->error = "guardian_connected_peer_async_cancelled";
    const bool environmentClosed = work->peer->addon->closing.load(std::memory_order_acquire);
    if (!environmentClosed) {
        try {
            if (work->operation == Operation::Open && work->peer->closing.load(std::memory_order_acquire)) {
                // JS may revoke this published scope after execute(Open)'s last
                // fence but before this completion runs. OPEN has no public
                // wrapper/recheck yet, and its native work is now finished:
                // join/close the ORIGINAL scope and reject before cache/wrap.
                if (auto* core = work->peer->get()) core->close();
                work->error = "guardian_connected_peer_environment_closed";
            }
            if (!work->error) {
                if (work->operation != Operation::Recheck || !work->peer->closing.load(std::memory_order_acquire)) work->peer->cache(work->snapshot);
                napi_value value = work->operation == Operation::Open ? wrapPeer(env, work->peer) : nullptr;
                if (work->operation == Operation::Recheck)
                    api.napi_create_string_utf8_fn(env, work->snapshot.data(), work->snapshot.size(), &value);
                else if (work->operation == Operation::Close) value = undefined(env, api);
                if (value) api.napi_resolve_deferred_fn(env, work->deferred, value);
                else work->error = "guardian_connected_peer_result_unavailable";
            }
            if (work->error) {
                napi_value message = nullptr, error = nullptr;
                if (api.napi_create_string_utf8_fn(env, work->error, NAPI_AUTO_LENGTH, &message) == napi_ok &&
                    api.napi_create_error_fn(env, nullptr, message, &error) == napi_ok)
                    api.napi_reject_deferred_fn(env, work->deferred, error);
            }
        } catch (...) {
            napi_value message = nullptr, error = nullptr;
            if (api.napi_create_string_utf8_fn(env, "guardian_connected_peer_native_failure", NAPI_AUTO_LENGTH, &message) == napi_ok &&
                api.napi_create_error_fn(env, nullptr, message, &error) == napi_ok)
                api.napi_reject_deferred_fn(env, work->deferred, error);
        }
    }
    // Async completion is the terminal owner of this work/context. The original
    // JS object is also retained explicitly for normal GC until this point.
    if (work->original_js_peer) api.napi_delete_reference_fn(env, work->original_js_peer);
    api.napi_delete_async_work_fn(env, work->work);
}

napi_value queue(napi_env env, const std::shared_ptr<Peer>& peer, Operation operation, napi_value receiver) {
    auto& api = peer->addon->api;
    try {
    auto work = std::make_unique<Work>();
    work->peer = peer;
    work->operation = operation;
    napi_value promise = nullptr, label = nullptr;
    const auto rollback = [&]() {
        if (operation == Operation::Recheck) peer->rechecking.store(false, std::memory_order_release);
        if (work->original_js_peer) api.napi_delete_reference_fn(env, work->original_js_peer);
        if (work->work) api.napi_delete_async_work_fn(env, work->work);
    };
    if (api.napi_create_promise_fn(env, &work->deferred, &promise) != napi_ok ||
        api.napi_create_string_utf8_fn(env, "guardian-connected-peer", NAPI_AUTO_LENGTH, &label) != napi_ok ||
        (receiver && api.napi_create_reference_fn(env, receiver, 1, &work->original_js_peer) != napi_ok) ||
        api.napi_create_async_work_fn(env, nullptr, label, execute, complete, work.get(), &work->work) != napi_ok ||
        api.napi_queue_async_work_fn(env, work->work) != napi_ok) {
        rollback();
        return fail(env, api, "guardian_connected_peer_async_start_failed");
    }
    work.release();
    return promise;
    } catch (...) {
        if (operation == Operation::Recheck) peer->rechecking.store(false, std::memory_order_release);
        return fail(env, api, "guardian_connected_peer_native_failure");
    }
}

napi_value open(napi_env env, napi_callback_info info) {
    const HMODULE host = GetModuleHandleW(nullptr);
    decltype(&napi_get_cb_info) getInfo = nullptr;
    hostFunction(host, "napi_get_cb_info", &getInfo);
    std::size_t count = 1;
    napi_value argument = nullptr, receiver = nullptr;
    void* data = nullptr;
    if (!getInfo || getInfo(env, info, &count, &argument, &receiver, &data) != napi_ok || !data) return nullptr;
    const auto addon = static_cast<AddonHolder*>(data)->addon;
    if (!noArguments(env, info, addon->api, &receiver, &data)) return nullptr;
    if (addon->closing.load(std::memory_order_acquire)) return fail(env, addon->api, "guardian_connected_peer_environment_closed");
    try {
        auto peer = std::make_shared<Peer>(addon);
        // create() only allocates native state/cancellation event. Publish the
        // scope before queuing I/O so module-owned revocation can cancel OPEN
        // before its promise has produced a public JS Peer object.
        peer->core = metaengine::guardian::GuardianConnectedPeer::create();
        if (!peer->core) return fail(env, addon->api, "guardian_connected_peer_native_scope_missing");
        {
            std::lock_guard<std::mutex> lock(addon->peers_mutex);
            auto& peers = addon->peers;
            for (auto it = peers.begin(); it != peers.end();) it = it->expired() ? peers.erase(it) : std::next(it);
            peers.push_back(peer);
        }
        return queue(env, peer, Operation::Open, nullptr);
    } catch (...) { return fail(env, addon->api, "guardian_connected_peer_native_failure"); }
}

}  // namespace

NAPI_MODULE_INIT() {
    try {
    auto holder = std::make_unique<AddonHolder>();
    holder->addon = std::make_shared<Addon>();
    auto& api = holder->addon->api;
    if (!api.load()) return nullptr;  // No alternative host/module/DLL provider.
    if (api.napi_set_instance_data_fn(env, holder.get(), finalizeAddon, nullptr) != napi_ok) return nullptr;
    auto* owned = holder.release();
    auto cleanup_holder = std::make_unique<AddonHolder>();
    cleanup_holder->addon = owned->addon;
    if (api.napi_add_env_cleanup_hook_fn(env, cleanupAddon, cleanup_holder.get()) != napi_ok)
        return fail(env, api, "guardian_connected_peer_cleanup_hook_unavailable");
    cleanup_holder.release();
    const struct { const char* name; napi_callback callback; } methods[] = {
        {"openGuardianConnectedPeer", open},
        {"cancelPendingGuardianPeerObservations", cancelPending}};
    for (const auto& method : methods) {
        napi_value function = nullptr;
        if (api.napi_create_function_fn(env, method.name, NAPI_AUTO_LENGTH, method.callback, owned, &function) != napi_ok ||
            api.napi_set_named_property_fn(env, exports, method.name, function) != napi_ok) return nullptr;
    }
    return exports;
    } catch (...) { return nullptr; }
}
