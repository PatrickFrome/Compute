const SHA256 = /^[0-9a-f]{64}$/;

export const GUARDIAN_SLOT_ACTIONS = Object.freeze({
  HOLD: 'HOLD',
  STAGE_INACTIVE: 'STAGE_INACTIVE',
  HEALTH_CHALLENGE: 'HEALTH_CHALLENGE',
  PROMOTE_POINTER: 'PROMOTE_POINTER',
  ROLLBACK_POINTER: 'ROLLBACK_POINTER',
  NOOP_ACTIVE_EXACT: 'NOOP_ACTIVE_EXACT',
});

function required(value, reason) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(reason);
  return normalized;
}

function digest(value, reason) {
  const normalized = required(value, reason).toLowerCase().replace(/^sha256:/, '');
  if (!SHA256.test(normalized)) throw new Error(reason);
  return normalized;
}

function positive(value, reason) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) throw new Error(reason);
  return normalized;
}

function artifact(value = {}) {
  return Object.freeze({
    release_id: required(value.release_id, 'guardian_release_id_required'),
    source_revision: required(value.source_revision, 'guardian_source_revision_required').toLowerCase(),
    digest_sha256: digest(value.digest_sha256, 'guardian_artifact_digest_invalid'),
    size: positive(value.size, 'guardian_artifact_size_invalid'),
    provenance_digest_sha256: digest(value.provenance_digest_sha256, 'guardian_provenance_digest_invalid'),
    provenance_verified: value.provenance_verified === true,
    signature_verified: value.signature_verified === true,
    transparency_verified: value.transparency_verified === true,
    freshness_verified: value.freshness_verified === true,
    rollback_protected: value.rollback_protected === true,
  });
}

function slot(value, label) {
  if (!value) return null;
  return Object.freeze({
    slot: label,
    release_id: required(value.release_id, `guardian_${label}_release_required`),
    digest_sha256: digest(value.digest_sha256, `guardian_${label}_digest_invalid`),
    healthy: value.healthy === true,
    owner_session_verified: value.owner_session_verified === true,
    control_plane_handshake_verified: value.control_plane_handshake_verified === true,
  });
}

function hold(reason) {
  return Object.freeze({
    action: GUARDIAN_SLOT_ACTIONS.HOLD,
    reason,
    effect_candidate: false,
    authority_effect: false,
    automatic_retry_allowed: false,
  });
}

export function planGuardianAbSlot(input = {}) {
  const desired = artifact(input.desired_artifact);
  if (!desired.provenance_verified || !desired.signature_verified || !desired.transparency_verified
      || !desired.freshness_verified || !desired.rollback_protected) {
    return hold('DESIRED_RELEASE_NOT_FULLY_VERIFIED');
  }

  const activeName = String(input.active_slot ?? '').trim().toUpperCase();
  if (!['A', 'B'].includes(activeName)) return hold('ACTIVE_SLOT_INVALID');
  const active = slot(input[activeName === 'A' ? 'slot_a' : 'slot_b'], activeName);
  const inactiveName = activeName === 'A' ? 'B' : 'A';
  const inactive = slot(input[inactiveName === 'A' ? 'slot_a' : 'slot_b'], inactiveName);

  if (active?.release_id === desired.release_id && active.digest_sha256 === desired.digest_sha256
      && active.healthy && active.owner_session_verified && active.control_plane_handshake_verified) {
    return Object.freeze({
      action: GUARDIAN_SLOT_ACTIONS.NOOP_ACTIVE_EXACT,
      reason: 'ACTIVE_RELEASE_EXACT_HEALTHY',
      active_slot: activeName,
      effect_candidate: false,
      authority_effect: false,
      automatic_retry_allowed: false,
    });
  }

  const inactiveExact = inactive?.release_id === desired.release_id && inactive.digest_sha256 === desired.digest_sha256;
  if (!inactiveExact) {
    return Object.freeze({
      action: GUARDIAN_SLOT_ACTIONS.STAGE_INACTIVE,
      reason: 'VERIFIED_CANDIDATE_NOT_STAGED',
      target_slot: inactiveName,
      artifact: desired,
      overwrite_existing: false,
      exact_digest_size_readback_required: true,
      machine_acl_readback_required: true,
      final_path_readback_required: true,
      effect_candidate: true,
      authority_effect: false,
      automatic_retry_allowed: false,
    });
  }

  if (!inactive.healthy || !inactive.owner_session_verified || !inactive.control_plane_handshake_verified) {
    return Object.freeze({
      action: GUARDIAN_SLOT_ACTIONS.HEALTH_CHALLENGE,
      reason: 'CANDIDATE_STAGED_AWAITING_INDEPENDENT_HEALTH',
      target_slot: inactiveName,
      release_id: desired.release_id,
      effect_candidate: true,
      promotion_allowed: false,
      authority_effect: false,
      automatic_retry_allowed: false,
    });
  }

  if (input.promotion_readback_verified !== true) {
    return Object.freeze({
      action: GUARDIAN_SLOT_ACTIONS.PROMOTE_POINTER,
      reason: 'CANDIDATE_HEALTH_EXACT_PROMOTION_PENDING',
      from_slot: activeName,
      to_slot: inactiveName,
      release_id: desired.release_id,
      atomic_pointer_switch_required: true,
      independent_post_switch_readback_required: true,
      installer_retry_allowed: false,
      effect_candidate: true,
      authority_effect: false,
      automatic_retry_allowed: false,
    });
  }

  if (input.post_promotion_health_failed === true) {
    if (!active?.healthy) return hold('LAST_KNOWN_GOOD_NOT_PROVEN');
    return Object.freeze({
      action: GUARDIAN_SLOT_ACTIONS.ROLLBACK_POINTER,
      reason: 'PROMOTED_RUNTIME_FAILED_BOUNDED_HEALTH',
      from_slot: inactiveName,
      to_slot: activeName,
      effect_candidate: true,
      reinstall_candidate: false,
      authority_effect: false,
      automatic_retry_allowed: false,
    });
  }

  return hold('PROMOTION_STATE_REQUIRES_FRESH_READBACK');
}

export const GUARDIAN_AB_SLOT_CONTRACT = Object.freeze({
  schema: 'metaengine.guardian-ab-slot-contract.v1',
  last_known_good_preserved: true,
  stage_inactive_before_promotion: true,
  signed_provenance_required: true,
  freshness_and_rollback_protection_required: true,
  independent_health_readback_required: true,
  promotion_is_atomic_pointer_switch: true,
  rollback_is_pointer_switch_not_installer_retry: true,
  browser_update_path_owns_guardian_recovery: false,
  authority_effect: false,
});
