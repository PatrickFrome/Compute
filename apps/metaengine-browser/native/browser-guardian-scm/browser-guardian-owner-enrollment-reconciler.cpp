#include "browser-guardian-owner-enrollment-reconciler.hpp"

#include <sddl.h>

#include <algorithm>
#include <cwctype>
#include <string_view>

namespace metaengine::guardian {
namespace {

constexpr char kContractJson[] =
    "{\"schema\":\"metaengine.browser-guardian.owner-enrollment-reconciler.v1\","
    "\"version\":\"1.0.0\","
    "\"level_triggered_readback_required\":true,"
    "\"commit_result_inference_allowed\":false,"
    "\"durable_absence_can_prove_no_effect\":true,"
    "\"exact_owner_readback_can_prove_binding\":true,"
    "\"same_owner_different_provenance_is_immutable_noop\":true,"
    "\"owner_replacement_allowed\":false,"
    "\"ambiguous_readback_retry_allowed\":false,"
    "\"durable_write_allowed\":false,"
    "\"journal_mutation_allowed\":false,"
    "\"wts_execution_allowed\":false,"
    "\"process_effect_allowed\":false,"
    "\"scm_effect_allowed\":false,"
    "\"browser_authority\":false,"
    "\"task_authority\":false,"
    "\"scheduler_authority\":false,"
    "\"automatic_retry_allowed\":false,"
    "\"authority_effect\":false}";

bool hash64(std::string_view value) {
    return value.size() == 64 && std::all_of(value.begin(), value.end(), [](unsigned char ch) {
        return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f');
    });
}

std::wstring canonicalSid(const std::wstring& value) {
    PSID sid = nullptr;
    if (!ConvertStringSidToSidW(value.c_str(), &sid) || sid == nullptr) return {};
    LPWSTR raw = nullptr;
    if (!IsValidSid(sid) || !ConvertSidToStringSidW(sid, &raw) || raw == nullptr) {
        LocalFree(sid);
        return {};
    }
    std::wstring out(raw);
    LocalFree(raw);
    LocalFree(sid);
    return out;
}

bool normalizeRecord(const OwnerEnrollmentDurableRecord& input, OwnerEnrollmentDurableRecord* output) {
    if (output == nullptr || !hash64(input.enrollment_evidence_sha256)
        || !hash64(input.device_key_fingerprint_sha256)) {
        return false;
    }
    const std::wstring sid = canonicalSid(input.expected_owner_sid);
    if (sid.empty()) return false;
    output->expected_owner_sid = sid;
    output->enrollment_evidence_sha256 = input.enrollment_evidence_sha256;
    output->device_key_fingerprint_sha256 = input.device_key_fingerprint_sha256;
    return true;
}

OwnerEnrollmentReconcileResult result(OwnerEnrollmentReconcileState state, const char* reason) {
    OwnerEnrollmentReconcileResult out;
    out.state = state;
    out.reason = reason == nullptr ? "OWNER_ENROLLMENT_RECONCILE_UNKNOWN" : reason;
    return out;
}

}  // namespace

OwnerEnrollmentReconcileResult reconcileOwnerEnrollmentReadback(
    const OwnerEnrollmentStoreResult& readback,
    const OwnerEnrollmentDurableRecord& candidate) {
    OwnerEnrollmentDurableRecord normalizedCandidate;
    if (!normalizeRecord(candidate, &normalizedCandidate)) {
        return result(OwnerEnrollmentReconcileState::Hold, "OWNER_ENROLLMENT_CANDIDATE_INVALID");
    }

    if (!readback.root_trusted) {
        return result(OwnerEnrollmentReconcileState::Hold, "OWNER_ENROLLMENT_ROOT_UNTRUSTED");
    }
    if (readback.corrupt) {
        return result(OwnerEnrollmentReconcileState::Hold, "OWNER_ENROLLMENT_DURABLE_STATE_CORRUPT");
    }

    if (!readback.present) {
        if (readback.win32_error == ERROR_SUCCESS && readback.reason == "OWNER_STORE_RECORD_ABSENT") {
            auto out = result(
                OwnerEnrollmentReconcileState::NoDurableOwnerEffectProven,
                "OWNER_ENROLLMENT_DURABLE_ABSENCE_PROVES_NO_EFFECT");
            out.no_durable_owner_effect_proven = true;
            return out;
        }
        auto out = result(
            OwnerEnrollmentReconcileState::AmbiguousReadback,
            "OWNER_ENROLLMENT_DURABLE_ABSENCE_NOT_PROVEN");
        out.ambiguous = true;
        return out;
    }

    OwnerEnrollmentDurableRecord normalizedDurable;
    if (!normalizeRecord(readback.record, &normalizedDurable)) {
        return result(OwnerEnrollmentReconcileState::Hold, "OWNER_ENROLLMENT_DURABLE_RECORD_INVALID");
    }

    if (_wcsicmp(
            normalizedDurable.expected_owner_sid.c_str(),
            normalizedCandidate.expected_owner_sid.c_str()) != 0) {
        auto out = result(
            OwnerEnrollmentReconcileState::DurableOwnerMismatch,
            "OWNER_ENROLLMENT_DURABLE_OWNER_MISMATCH");
        out.durable_owner_present_proven = true;
        out.owner_mismatch = true;
        out.replacement_protocol_required = true;
        return out;
    }

    const bool provenanceExact =
        normalizedDurable.enrollment_evidence_sha256 == normalizedCandidate.enrollment_evidence_sha256
        && normalizedDurable.device_key_fingerprint_sha256 == normalizedCandidate.device_key_fingerprint_sha256;
    if (!provenanceExact) {
        auto out = result(
            OwnerEnrollmentReconcileState::DurableOwnerExactDifferentProvenance,
            "OWNER_ENROLLMENT_DURABLE_OWNER_EXACT_DIFFERENT_PROVENANCE");
        out.durable_owner_present_proven = true;
        out.provenance_mismatch = true;
        return out;
    }

    auto out = result(
        OwnerEnrollmentReconcileState::DurableOwnerExact,
        "OWNER_ENROLLMENT_DURABLE_CANDIDATE_EXACT");
    out.durable_owner_present_proven = true;
    out.durable_candidate_exact = true;
    return out;
}

const char* browserGuardianOwnerEnrollmentReconcilerContractJson() noexcept {
    return kContractJson;
}

}  // namespace metaengine::guardian
