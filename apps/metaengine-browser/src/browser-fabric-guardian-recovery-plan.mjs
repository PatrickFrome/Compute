export const BROWSER_FABRIC_GUARDIAN_RECOVERY_SCHEMA = 'metaengine.browser-fabric.guardian-recovery-plan.v1';
export const BROWSER_FABRIC_GUARDIAN_ACTIVATION_EVIDENCE_SCHEMA = 'metaengine.browser-fabric.guardian-activation-evidence.v1';
export const BROWSER_FABRIC_GUARDIAN_ROLLBACK_EVIDENCE_SCHEMA = 'metaengine.browser-fabric.guardian-rollback-evidence.v1';
export const BROWSER_FABRIC_GUARDIAN_ACTIVATION_EVIDENCE_MAX_AGE_MS = 10 * 60_000;

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const SLOT_IDS = new Set(['A', 'B']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,191}$/;
const SLOT_KEYS = new Set([
  'slot_id', 'source_sha', 'browser_exe_sha256', 'manifest_sha256',
  'bytes_exact', 'machine_secure', 'final_path_exact',
  'health_challenge_passed', 'owner_session_handshake_exact',
  'control_plane_handshake_exact', 'rollback_evidence',
]);
const ROLLBACK_EVIDENCE_KEYS = new Set([
  'schema', 'slot_id', 'source_sha', 'browser_exe_sha256', 'manifest_sha256',
  'platform_signature_verified', 'receipt_sha256', 'verifier_id', 'verified_at',
  'authority_effect',
]);

function plan(action, reason, extra = {}) {
  return Object.freeze({
    schema: BROWSER_FABRIC_GUARDIAN_RECOVERY_SCHEMA,
    action,
    reason,
    task_authority: false,
    prompt_authority: false,
    page_model_text_authority: false,
    send_authority: false,
    release_publication_authority: false,
    policy_authority: false,
    queue_authority: false,
    direct_effect_allowed: false,
    requires_existing_guardian_effect_journal: !['HOLD', 'NOOP_HEALTHY', 'RECONCILE'].includes(action),
    automatic_retry_allowed: false,
    authority_effect: false,
    ...extra,
  });
}

function releaseFromGate(gate) {
  if (!gate
      || gate.schema !== 'metaengine.browser-fabric.release-authority-gate.v1'
      || gate.action !== 'AUTHORITY_ADVANCE_CANDIDATE'
      || gate.authority_advance_candidate !== true
      || gate.requires_separate_journaled_promotion_effect !== true
      || gate.release_authority !== false
      || gate.authority_effect !== false
      || !GIT_SHA.test(String(gate.candidate_sha || ''))
      || !SHA256.test(String(gate.installed_executable_sha256 || ''))
      || !SHA256.test(String(gate.manifest_sha256 || ''))) return null;
  return Object.freeze({
    source_sha: gate.candidate_sha,
    browser_exe_sha256: gate.installed_executable_sha256,
    manifest_sha256: gate.manifest_sha256,
    release_tag: gate.release_tag,
  });
}

function activationEvidenceExact(evidence, release, nowMs) {
  if (!evidence
      || evidence.schema !== BROWSER_FABRIC_GUARDIAN_ACTIVATION_EVIDENCE_SCHEMA
      || evidence.authority_effect !== false
      || evidence.platform_signature_verified !== true
      || evidence.rollback_freshness_verified !== true
      || !SAFE_ID.test(String(evidence.platform_verifier_id || ''))
      || !SAFE_ID.test(String(evidence.freshness_verifier_id || ''))
      || evidence.release_tag !== release.release_tag
      || evidence.source_sha !== release.source_sha
      || evidence.browser_exe_sha256 !== release.browser_exe_sha256
      || evidence.manifest_sha256 !== release.manifest_sha256) return false;
  const verifiedAt = Date.parse(String(evidence.verified_at || ''));
  return Number.isFinite(verifiedAt)
    && verifiedAt <= nowMs
    && nowMs - verifiedAt <= BROWSER_FABRIC_GUARDIAN_ACTIVATION_EVIDENCE_MAX_AGE_MS;
}

function exactKeys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

function normalizeSlot(row) {
  if (!exactKeys(row, SLOT_KEYS) || !SLOT_IDS.has(row.slot_id)) return null;
  return {
    slot_id: row.slot_id,
    source_sha: String(row.source_sha || ''),
    browser_exe_sha256: String(row.browser_exe_sha256 || '').toLowerCase(),
    manifest_sha256: String(row.manifest_sha256 || '').toLowerCase(),
    bytes_exact: row.bytes_exact === true,
    machine_secure: row.machine_secure === true,
    final_path_exact: row.final_path_exact === true,
    health_challenge_passed: row.health_challenge_passed === true,
    owner_session_handshake_exact: row.owner_session_handshake_exact === true,
    control_plane_handshake_exact: row.control_plane_handshake_exact === true,
    rollback_evidence: row.rollback_evidence,
  };
}

function rollbackEvidenceExact(slot, nowMs) {
  const evidence = slot && slot.rollback_evidence;
  if (!exactKeys(evidence, ROLLBACK_EVIDENCE_KEYS)
      || evidence.schema !== BROWSER_FABRIC_GUARDIAN_ROLLBACK_EVIDENCE_SCHEMA
      || evidence.slot_id !== slot.slot_id
      || evidence.source_sha !== slot.source_sha
      || evidence.browser_exe_sha256 !== slot.browser_exe_sha256
      || evidence.manifest_sha256 !== slot.manifest_sha256
      || !GIT_SHA.test(evidence.source_sha)
      || !SHA256.test(evidence.browser_exe_sha256)
      || !SHA256.test(evidence.manifest_sha256)
      || evidence.platform_signature_verified !== true
      || !SHA256.test(String(evidence.receipt_sha256 || ''))
      || !SAFE_ID.test(String(evidence.verifier_id || ''))
      || evidence.authority_effect !== false) return false;
  const verifiedAt = Date.parse(String(evidence.verified_at || ''));
  return Number.isFinite(verifiedAt)
    && verifiedAt <= nowMs
    && nowMs - verifiedAt <= BROWSER_FABRIC_GUARDIAN_ACTIVATION_EVIDENCE_MAX_AGE_MS;
}

function slotExact(slot, release) {
  return slot
    && slot.source_sha === release.source_sha
    && slot.browser_exe_sha256 === release.browser_exe_sha256
    && slot.manifest_sha256 === release.manifest_sha256
    && slot.bytes_exact
    && slot.machine_secure
    && slot.final_path_exact;
}

function slotHealthy(slot, release) {
  return slotExact(slot, release)
    && slot.health_challenge_passed
    && slot.owner_session_handshake_exact
    && slot.control_plane_handshake_exact;
}

/**
 * Recovery-plane planner only. Candidate outputs still require the existing
 * typed Guardian effect journal/actuator. It never chooses a task, reads a
 * prompt, sends page input, publishes a release, or retries an ambiguous effect.
 */
export function planBrowserFabricGuardianRecovery({
  desired_running = true,
  external_stop = false,
  release_gate,
  activation_evidence,
  observed = {},
  now = new Date(),
} = {}) {
  if (external_stop || desired_running === false) return plan('HOLD', 'EXTERNAL_STOP_OR_DISABLED');
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) return plan('HOLD', 'RECOVERY_TIME_INVALID');
  const release = releaseFromGate(release_gate);
  if (!release) return plan('HOLD', 'VERIFIED_RELEASE_GATE_REQUIRED');
  if (!activationEvidenceExact(activation_evidence, release, nowMs)) {
    return plan('HOLD', 'PLATFORM_AND_ROLLBACK_EVIDENCE_REQUIRED');
  }
  if (observed.ambiguous_effect === true) return plan('RECONCILE', 'AMBIGUOUS_EFFECT_REQUIRES_READBACK');
  if (!SLOT_IDS.has(observed.active_slot)) return plan('HOLD', 'ACTIVE_SLOT_INVALID');
  if (!SLOT_IDS.has(observed.inactive_slot)) return plan('HOLD', 'INACTIVE_SLOT_INVALID');
  if (!SLOT_IDS.has(observed.last_known_good_slot)) return plan('HOLD', 'LAST_KNOWN_GOOD_SLOT_INVALID');
  if (observed.active_slot === observed.inactive_slot) return plan('HOLD', 'AB_SLOT_IDENTITY_COLLISION');
  const inactiveId = observed.active_slot === 'A' ? 'B' : 'A';
  if (observed.inactive_slot !== inactiveId) return plan('HOLD', 'AB_SLOT_TOPOLOGY_INVALID');

  const rows = Array.isArray(observed.slots) ? observed.slots.map(normalizeSlot).filter(Boolean) : [];
  if (rows.length !== 2 || new Set(rows.map((row) => row.slot_id)).size !== 2) return plan('HOLD', 'AB_SLOT_CARDINALITY_INVALID');
  const active = rows.find((row) => row.slot_id === observed.active_slot);
  const inactive = rows.find((row) => row.slot_id === inactiveId);
  const lastGood = rows.find((row) => row.slot_id === observed.last_known_good_slot);

  if (observed.active_runtime_unhealthy !== true && slotHealthy(active, release)) {
    return plan('NOOP_HEALTHY', 'ACTIVE_SLOT_EXACT_AND_HEALTHY', {
      active_slot: active.slot_id,
      source_sha: release.source_sha,
      browser_exe_sha256: release.browser_exe_sha256,
    });
  }

  if (observed.active_runtime_unhealthy === true && lastGood && lastGood.slot_id !== active.slot_id) {
    if (lastGood.bytes_exact
        && lastGood.health_challenge_passed
        && lastGood.owner_session_handshake_exact
        && lastGood.control_plane_handshake_exact
        && lastGood.machine_secure
        && lastGood.final_path_exact
        && rollbackEvidenceExact(lastGood, nowMs)) {
      return plan('ROLLBACK_POINTER_CANDIDATE', 'ACTIVE_UNHEALTHY_LAST_KNOWN_GOOD_AVAILABLE', {
        from_slot: active.slot_id,
        to_slot: lastGood.slot_id,
        installer_retry_allowed: false,
        pointer_switch_must_be_atomic: true,
        exact_post_switch_readback_required: true,
      });
    }
    return plan('HOLD', 'LAST_KNOWN_GOOD_ROLLBACK_EVIDENCE_REQUIRED');
  }
  if (observed.active_runtime_unhealthy === true) {
    return plan('HOLD', 'NO_HEALTHY_ROLLBACK_SLOT_AVAILABLE');
  }

  if (!slotExact(inactive, release)) {
    return plan('STAGE_INACTIVE_SLOT_CANDIDATE', 'INACTIVE_SLOT_NOT_EXACT', {
      target_slot: inactive.slot_id,
      source_sha: release.source_sha,
      browser_exe_sha256: release.browser_exe_sha256,
      manifest_sha256: release.manifest_sha256,
      active_pointer_must_not_change: true,
      installer_retry_allowed: false,
      machine_secure_copy_required: true,
    });
  }

  if (!inactive.health_challenge_passed
      || !inactive.owner_session_handshake_exact
      || !inactive.control_plane_handshake_exact) {
    return plan('HEALTH_CHALLENGE_CANDIDATE', 'INACTIVE_SLOT_NEEDS_INDEPENDENT_HEALTH_PROOF', {
      target_slot: inactive.slot_id,
      no_user_data: true,
      prompt_access_allowed: false,
      send_allowed: false,
      bounded_health_window_required: true,
    });
  }

  if (!rollbackEvidenceExact(active, nowMs)) {
    return plan('HOLD', 'PRIOR_SLOT_ROLLBACK_EVIDENCE_REQUIRED');
  }

  return plan('PROMOTE_POINTER_CANDIDATE', 'INACTIVE_SLOT_EXACT_AND_HEALTHY', {
    from_slot: active.slot_id,
    to_slot: inactive.slot_id,
    source_sha: release.source_sha,
    pointer_switch_must_be_atomic: true,
    exact_post_switch_readback_required: true,
    prior_slot_retained_as_rollback: true,
    installer_retry_allowed: false,
  });
}

export function browserFabricGuardianRecoveryContract() {
  return Object.freeze({
    schema: BROWSER_FABRIC_GUARDIAN_RECOVERY_SCHEMA,
    recovery_plane_independent_of_browser_lifecycle: true,
    verified_immutable_release_required: true,
    typed_release_gate_required: true,
    platform_signature_required: true,
    provenance_required: true,
    rollback_freshness_required: true,
    rollback_slot_receipt_required: true,
    rollback_slot_identity_exact: true,
    activation_evidence_max_age_ms: BROWSER_FABRIC_GUARDIAN_ACTIVATION_EVIDENCE_MAX_AGE_MS,
    ab_slots_required: true,
    inactive_stage_before_promotion: true,
    independent_health_challenge_required: true,
    owner_session_handshake_required: true,
    control_plane_handshake_required: true,
    atomic_pointer_switch_required: true,
    installer_retry_allowed: false,
    task_authority: false,
    prompt_authority: false,
    send_authority: false,
    release_publication_authority: false,
    policy_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
