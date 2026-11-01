// Portable deterministic tests of the ACTUAL atomic admission primitive.
// The owner below is a generated native fixture, not an installed SCM producer.
#ifdef NDEBUG
#error Admission tests require assertions enabled
#endif
#include "../../native/browser-guardian-scm/browser-guardian-effect-admission.hpp"
#include <cassert>
#include <future>
#include <iostream>
#include <type_traits>
#include <array>
#include <string_view>
namespace metaengine::guardian {
class GuardianScmEffectOwner final {
public:
    const GuardianEffectAdmission& context() const noexcept { return context_; }
    void requestStop() noexcept { context_.stop(); }
private:
    GuardianEffectAdmission context_;
};
}
using namespace metaengine::guardian;
int main() {
    static_assert(!std::is_default_constructible_v<GuardianEffectAdmission>);
    static_assert(!std::is_copy_constructible_v<GuardianEffectAdmission>);
    static_assert(!std::is_constructible_v<GuardianEffectAdmission,bool>);
    constexpr std::array<std::string_view,10> stages={"request","ticket-redemption","owner-create","candidate-root",
        "effects-root","candidate-slot","candidate-copy","attempted-barrier","suspended-create","resume"};
    for(std::size_t stopAt=0;stopAt<stages.size();++stopAt) {
        GuardianScmEffectOwner owner;std::size_t calls=0;
        for(std::size_t i=0;i<stages.size();++i) {
            if(i==stopAt)owner.requestStop();
            if(owner.context().admit())++calls;
        }
        assert(calls==stopAt);assert(owner.context().stopped());assert(!owner.context().admit());
    }
    // Exact stale-check interleaving: the OLD one-check pattern permits the
    // effect after this point. The actual CAS admission must refuse it.
    {
        GuardianScmEffectOwner owner;const bool oldCheckedOpen=!owner.context().stopped();
        std::promise<void> stopDone;auto stopped=stopDone.get_future();
        auto thread=std::async(std::launch::async,[&]{owner.requestStop();stopDone.set_value();});
        stopped.get();assert(oldCheckedOpen); // replaying this old bool would wrongly admit
        assert(!owner.context().admit());thread.get();
    }
    // Admission wins before stop: that single owned operation may settle, but
    // it is not permission for a subsequent effect (especially resume).
    {
        GuardianScmEffectOwner owner;std::promise<void> admitted,finish;auto admittedFuture=admitted.get_future();auto finishFuture=finish.get_future();
        unsigned operations=0;
        auto thread=std::async(std::launch::async,[&]{assert(owner.context().admit());admitted.set_value();finishFuture.get();++operations;
            assert(!owner.context().admit());});
        admittedFuture.get();owner.requestStop();finish.set_value();thread.get();assert(operations==1);
    }
    // Stop after durable ATTEMPTED cannot undo that admitted barrier or permit
    // another attempt. Post-stop cleanup/readback is not another admission.
    {
        GuardianScmEffectOwner owner;assert(owner.context().admit());bool barrierRetained=true;
        owner.requestStop();assert(!owner.context().admit());assert(barrierRetained);
    }
    std::cout << "guardian_effect_admission_model=PASS; fixture_only=true; windows_effect_execution=UNQUALIFIED\n";
}
