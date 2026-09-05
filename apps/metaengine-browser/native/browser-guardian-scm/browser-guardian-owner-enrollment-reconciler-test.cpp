#include "browser-guardian-owner-enrollment-reconciler.hpp"

#include <cassert>
#include <cstring>
#include <iostream>
#include <string>

using metaengine::guardian::OwnerEnrollmentDurableRecord;
using metaengine::guardian::OwnerEnrollmentReconcileState;
using metaengine::guardian::OwnerEnrollmentStoreResult;
using metaengine::guardian::browserGuardianOwnerEnrollmentReconcilerContractJson;
using metaengine::guardian::reconcileOwnerEnrollmentReadback;

namespace {

OwnerEnrollmentDurableRecord candidate() {
    return {
        L"S-1-5-21-100-200-300-1001",
        std::string(64, 'a'),
        std::string(64, 'b'),
    };
}

OwnerEnrollmentStoreResult absent() {
    OwnerEnrollmentStoreResult out;
    out.root_trusted = true;
    out.reason = "OWNER_STORE_RECORD_ABSENT";
    out.win32_error = ERROR_SUCCESS;
    return out;
}

OwnerEnrollmentStoreResult presentExact() {
    OwnerEnrollmentStoreResult out;
    out.root_trusted = true;
    out.present = true;
    out.reason = "OWNER_STORE_RECORD_VALID";
    out.record = candidate();
    return out;
}

void proveZeroAuthority(const metaengine::guardian::OwnerEnrollmentReconcileResult& out) {
    assert(!out.durable_write_allowed);
    assert(!out.journal_mutation_allowed);
    assert(!out.wts_execution_allowed);
    assert(!out.process_effect_allowed);
    assert(!out.scm_effect_allowed);
    assert(!out.browser_authority);
    assert(!out.task_authority);
    assert(!out.scheduler_authority);
    assert(!out.automatic_retry_allowed);
    assert(!out.authority_effect);
}

}  // namespace

int main() {
    const auto desired = candidate();

    {
        const auto out = reconcileOwnerEnrollmentReadback(absent(), desired);
        assert(out.state == OwnerEnrollmentReconcileState::NoDurableOwnerEffectProven);
        assert(out.no_durable_owner_effect_proven);
        assert(!out.ambiguous);
        proveZeroAuthority(out);
    }

    {
        const auto out = reconcileOwnerEnrollmentReadback(presentExact(), desired);
        assert(out.state == OwnerEnrollmentReconcileState::DurableOwnerExact);
        assert(out.durable_owner_present_proven);
        assert(out.durable_candidate_exact);
        assert(!out.no_durable_owner_effect_proven);
        proveZeroAuthority(out);
    }

    {
        auto current = presentExact();
        current.record.enrollment_evidence_sha256 = std::string(64, 'c');
        const auto out = reconcileOwnerEnrollmentReadback(current, desired);
        assert(out.state == OwnerEnrollmentReconcileState::DurableOwnerExactDifferentProvenance);
        assert(out.durable_owner_present_proven);
        assert(out.provenance_mismatch);
        assert(!out.durable_candidate_exact);
        proveZeroAuthority(out);
    }

    {
        auto current = presentExact();
        current.record.expected_owner_sid = L"S-1-5-21-999-888-777-1002";
        const auto out = reconcileOwnerEnrollmentReadback(current, desired);
        assert(out.state == OwnerEnrollmentReconcileState::DurableOwnerMismatch);
        assert(out.durable_owner_present_proven);
        assert(out.owner_mismatch);
        assert(out.replacement_protocol_required);
        proveZeroAuthority(out);
    }

    {
        auto current = absent();
        current.reason = "OWNER_STORE_RECORD_OPEN_FAILED";
        current.win32_error = ERROR_ACCESS_DENIED;
        const auto out = reconcileOwnerEnrollmentReadback(current, desired);
        assert(out.state == OwnerEnrollmentReconcileState::AmbiguousReadback);
        assert(out.ambiguous);
        assert(!out.no_durable_owner_effect_proven);
        proveZeroAuthority(out);
    }

    {
        auto current = presentExact();
        current.corrupt = true;
        const auto out = reconcileOwnerEnrollmentReadback(current, desired);
        assert(out.state == OwnerEnrollmentReconcileState::Hold);
        assert(out.reason == "OWNER_ENROLLMENT_DURABLE_STATE_CORRUPT");
        proveZeroAuthority(out);
    }

    {
        auto current = presentExact();
        current.root_trusted = false;
        const auto out = reconcileOwnerEnrollmentReadback(current, desired);
        assert(out.state == OwnerEnrollmentReconcileState::Hold);
        assert(out.reason == "OWNER_ENROLLMENT_ROOT_UNTRUSTED");
        proveZeroAuthority(out);
    }

    {
        auto malformed = desired;
        malformed.expected_owner_sid = L"not-a-sid";
        const auto out = reconcileOwnerEnrollmentReadback(absent(), malformed);
        assert(out.state == OwnerEnrollmentReconcileState::Hold);
        assert(out.reason == "OWNER_ENROLLMENT_CANDIDATE_INVALID");
        proveZeroAuthority(out);
    }

    const std::string contract = browserGuardianOwnerEnrollmentReconcilerContractJson();
    assert(contract.find("\"commit_result_inference_allowed\":false") != std::string::npos);
    assert(contract.find("\"ambiguous_readback_retry_allowed\":false") != std::string::npos);
    assert(contract.find("\"automatic_retry_allowed\":false") != std::string::npos);

    std::cout << "OWNER_ENROLLMENT_RECONCILER_OK\n";
    return 0;
}
