#pragma once

#include "browser-guardian-owner-enrollment-store.hpp"

#include <string>

namespace metaengine::guardian {

enum class OwnerEnrollmentReconcileState {
    Hold,
    NoDurableOwnerEffectProven,
    DurableOwnerExact,
    DurableOwnerExactDifferentProvenance,
    DurableOwnerMismatch,
    AmbiguousReadback,
};

struct OwnerEnrollmentReconcileResult {
    OwnerEnrollmentReconcileState state = OwnerEnrollmentReconcileState::Hold;
    bool durable_owner_present_proven = false;
    bool durable_candidate_exact = false;
    bool no_durable_owner_effect_proven = false;
    bool owner_mismatch = false;
    bool provenance_mismatch = false;
    bool ambiguous = false;
    bool replacement_protocol_required = false;
    bool durable_write_allowed = false;
    bool journal_mutation_allowed = false;
    bool wts_execution_allowed = false;
    bool process_effect_allowed = false;
    bool scm_effect_allowed = false;
    bool browser_authority = false;
    bool task_authority = false;
    bool scheduler_authority = false;
    bool automatic_retry_allowed = false;
    bool authority_effect = false;
    std::string reason;
};

// Level-triggered interpretation of one fresh durable-store readback. This helper
// never infers persistence success from the preceding API call. Callers reconcile
// after any commit-boundary uncertainty and only proceed from exact current state.
OwnerEnrollmentReconcileResult reconcileOwnerEnrollmentReadback(
    const OwnerEnrollmentStoreResult& readback,
    const OwnerEnrollmentDurableRecord& candidate);

// Read-only contract probe. This classifier grants no write, journal, WTS,
// process, SCM, Browser/task, retry, or scheduler authority.
const char* browserGuardianOwnerEnrollmentReconcilerContractJson() noexcept;

}  // namespace metaengine::guardian
