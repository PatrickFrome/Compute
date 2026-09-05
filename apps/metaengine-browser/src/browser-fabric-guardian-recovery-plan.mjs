export const BROWSER_FABRIC_GUARDIAN_RECOVERY_SCHEMA = 'metaengine.browser-fabric.guardian-recovery-plan.v1';

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const SLOT_IDS = new Set(['A', 'B']);

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

function exactRelease(release) {
  return release
    && release.verified_immutable_release_exact === true
    && GIT_SHA.test(String(release.source_sha || ''))
    && SHA256.test(String(release.browser_exe_sha256 || ''))
    && SHA256.test(String(release.manifest_sha256 || ''))
    && release.platform_signature_verified === true
    && release.provenance_verified === true
    && release.rollback_freshness_verified === true;
}

function normalizeSlot(row) {
  if (!row || !SLOT_IDS.has(row.slot_id)) return null;
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
  };
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
  release,
  observed = {},
} = {}) {
  if (external_stop || desired_running === false) return plan('HOLD', 'EXTERNAL_STOP_OR_DISABLED');
  if (!exactRelease(release)) return plan('HOLD', 'VERIFIED_IMMUTABLE_RELEASE_REQUIRED');
  if (observed.ambiguous_effect === true) return plan('RECONCILE', 'AMBIGUOUS_EFFECT_REQUIRES_READBACK');
  if (!SLOT_IDS.has(observed.active_slot)) return plan('HOLD', 'ACTIVE_SLOT_INVALID');
  if (!SLOT_IDS.has(observed.last_known_good_slot)) return plan('HOLD', 'LAST_KNOWN_GOOD_SLOT_INVALID');
  if (observed.active_slot === observed.inactive_slot) return plan('HOLD', 'AB_SLOT_IDENTITY_COLLISION');

  const rows = Array.isArray(observed.slots) ? observed.slots.map(normalizeSlot).filter(Boolean) : [];
  if (rows.length !== 2 || new Set(rows.map((row) => row.slot_id)).size !== 2) return plan('HOLD', 'AB_SLOT_CARDINALITY_INVALID');
  const active = rows.find((row) => row.slot_id === observed.active_slot);
  const inactiveId = observed.active_slot === 'A' ? 'B' : 'A';
  const inactive = rows.find((row) => row.slot_id === inactiveId);
  const lastGood = rows.find((row) => row.slot_id === observed.last_known_good_slot);

  if (slotHealthy(active, release)) {
    return plan('NOOP_HEALTHY', 'ACTIVE_SLOT_EXACT_AND_HEALTHY', {
      active_slot: active.slot_id,
      source_sha: release.source_sha,
      browser_exe_sha256: release.browser_exe_sha256,
    });
  }

  if (observed.active_runtime_unhealthy === true && lastGood && lastGood.slot_id !== active.slot_id
      && lastGood.health_challenge_passed && lastGood.machine_secure && lastGood.final_path_exact) {
    return plan('ROLLBACK_POINTER_CANDIDATE', 'ACTIVE_UNHEALTHY_LAST_KNOWN_GOOD_AVAILABLE', {
      from_slot: active.slot_id,
      to_slot: lastGood.slot_id,
      installer_retry_allowed: false,
      pointer_switch_must_be_atomic: true,
      exact_post_switch_readback_required: true,
    });
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
    platform_signature_required: true,
    provenance_required: true,
    rollback_freshness_required: true,
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
