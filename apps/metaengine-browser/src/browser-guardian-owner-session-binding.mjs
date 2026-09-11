import { evaluateGuardianSessionBrokerController } from './browser-guardian-session-broker-controller.mjs';

export const BROWSER_GUARDIAN_OWNER_SESSION_BINDING_SCHEMA = 'metaengine.browser-guardian.owner-session-binding.v1';
export const BROWSER_GUARDIAN_OWNER_READBACK_PROOF_SCHEMA = 'metaengine.browser-guardian.owner-enrollment-readback-proof.v1';
export const BROWSER_GUARDIAN_DEVICE_BINDING_PROOF_SCHEMA = 'metaengine.browser-guardian.device-binding-proof.v1';
export const BROWSER_GUARDIAN_OWNER_READBACK_MAX_AGE_MS = 30_000;
export const BROWSER_GUARDIAN_DEVICE_PROOF_MAX_AGE_MS = 30_000;

const SID_RE = /^S-\d-\d+(?:-\d+)+$/i;
const SHA256 = /^[0-9a-f]{64}$/;

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function hold(reason, extra = {}) {
  return freeze({
    schema: BROWSER_GUARDIAN_OWNER_SESSION_BINDING_SCHEMA,
    step: 'HOLD',
    reason,
    durable_owner_binding_proven: false,
    device_binding_proven: false,
    caller_supplied_owner_sid_allowed: false,
    journal_mutation_allowed: false,
    wts_execution_allowed: false,
    process_effect_allowed: false,
    scm_effect_allowed: false,
    automatic_retry_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    authority_effect: false,
    ...extra,
  });
}

function normalizedSid(value) {
  const sid = String(value || '').trim().toUpperCase();
  return SID_RE.test(sid) ? sid : null;
}

function hash(value) {
  return typeof value === 'string' && SHA256.test(value.toLowerCase());
}

function safeTime(value, nowMs, maxAgeMs) {
  const at = Number(value);
  return Number.isSafeInteger(at)
    && at >= 0
    && at <= nowMs
    && nowMs - at <= maxAgeMs;
}

function exactOwnerReadback(proof, nowMs) {
  if (!proof || proof.schema !== BROWSER_GUARDIAN_OWNER_READBACK_PROOF_SCHEMA) return null;
  if (proof.source !== 'NATIVE_OWNER_STORE_READBACK'
      || proof.root_trusted !== true
      || proof.present !== true
      || proof.corrupt !== false
      || proof.outcome !== 'EFFECT_EXACT'
      || proof.readback_verified !== true
      || proof.authority_effect !== false) return null;
  if (!safeTime(proof.observed_at_ms, nowMs, BROWSER_GUARDIAN_OWNER_READBACK_MAX_AGE_MS)) return null;
  const sid = normalizedSid(proof.record?.expected_owner_sid);
  const evidence = String(proof.record?.enrollment_evidence_sha256 || '').toLowerCase();
  const device = String(proof.record?.device_key_fingerprint_sha256 || '').toLowerCase();
  if (!sid || !hash(evidence) || !hash(device)) return null;
  return freeze({
    expected_owner_sid: sid,
    enrollment_evidence_sha256: evidence,
    device_key_fingerprint_sha256: device,
    observed_at_ms: proof.observed_at_ms,
  });
}

function exactDeviceBinding(proof, owner, nowMs) {
  if (!proof || proof.schema !== BROWSER_GUARDIAN_DEVICE_BINDING_PROOF_SCHEMA) return null;
  if (proof.source !== 'ENROLLED_DEVICE_CHALLENGE'
      || proof.challenge_verified !== true
      || proof.process_binding_verified !== true
      || proof.replay_protection_verified !== true
      || proof.authority_effect !== false) return null;
  if (!safeTime(proof.observed_at_ms, nowMs, BROWSER_GUARDIAN_DEVICE_PROOF_MAX_AGE_MS)) return null;
  const fingerprint = String(proof.device_key_fingerprint_sha256 || '').toLowerCase();
  if (!hash(fingerprint) || fingerprint !== owner.device_key_fingerprint_sha256) return null;
  return freeze({
    device_key_fingerprint_sha256: fingerprint,
    observed_at_ms: proof.observed_at_ms,
  });
}

/**
 * Final P0 bridge for the old Session Broker model.
 *
 * expected_owner_sid cannot enter from desired state or effect binding. It is
 * derived only from a fresh trusted native durable-store readback. The durable
 * record's enrolled device fingerprint must independently match a fresh device
 * challenge proof. Only then is the existing pure Session Broker controller
 * evaluated, which still cannot execute WTS/process/SCM effects itself.
 */
export function evaluateGuardianOwnerBoundSessionBrokerController({
  desired = {},
  observed = {},
  journal_snapshot = null,
  binding = {},
  durable_owner_readback = null,
  device_binding_proof = null,
  now_ms = Date.now(),
} = {}) {
  const nowMs = Number(now_ms);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return hold('CLOCK_INVALID');

  if (Object.prototype.hasOwnProperty.call(desired, 'expected_owner_sid')) {
    return hold('CALLER_SUPPLIED_OWNER_SID_FORBIDDEN');
  }
  if (Object.prototype.hasOwnProperty.call(binding, 'expected_owner_sid')) {
    return hold('CALLER_SUPPLIED_BINDING_OWNER_SID_FORBIDDEN');
  }

  const owner = exactOwnerReadback(durable_owner_readback, nowMs);
  if (!owner) return hold('DURABLE_OWNER_READBACK_NOT_EXACT');
  const device = exactDeviceBinding(device_binding_proof, owner, nowMs);
  if (!device) return hold('ENROLLED_DEVICE_BINDING_NOT_EXACT', {
    durable_owner_binding_proven: true,
  });

  const serviceName = String(binding.service_name || '').trim();
  const brokerExecutable = String(binding.broker_executable || '').trim();
  if (!serviceName || !brokerExecutable) return hold('SESSION_BROKER_BINDING_INCOMPLETE', {
    durable_owner_binding_proven: true,
    device_binding_proven: true,
  });

  const exactDesired = freeze({
    ...desired,
    expected_owner_sid: owner.expected_owner_sid,
  });
  const exactBinding = freeze({
    service_name: serviceName,
    broker_executable: brokerExecutable,
    expected_owner_sid: owner.expected_owner_sid,
  });

  const controller = evaluateGuardianSessionBrokerController({
    desired: exactDesired,
    observed,
    journal_snapshot,
    binding: exactBinding,
    now_ms: nowMs,
  });

  return freeze({
    schema: BROWSER_GUARDIAN_OWNER_SESSION_BINDING_SCHEMA,
    step: controller.step,
    reason: controller.reason,
    controller,
    expected_owner_sid: owner.expected_owner_sid,
    enrollment_evidence_sha256: owner.enrollment_evidence_sha256,
    device_key_fingerprint_sha256: owner.device_key_fingerprint_sha256,
    durable_owner_binding_proven: true,
    device_binding_proven: true,
    caller_supplied_owner_sid_allowed: false,
    active_session_must_match_durable_owner: true,
    effect_id: controller.effect_id || null,
    effect_generation: controller.effect_generation || null,
    selected_session: controller.selected_session || null,
    record_intent_candidate: controller.record_intent_candidate === true,
    one_attempt_candidate: controller.one_attempt_candidate === true,
    reconcile_required: controller.reconcile_required === true,
    journal_mutation_allowed: false,
    wts_execution_allowed: false,
    process_effect_allowed: false,
    scm_effect_allowed: false,
    automatic_retry_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    authority_effect: false,
  });
}

export function browserGuardianOwnerSessionBindingContract() {
  return freeze({
    schema: BROWSER_GUARDIAN_OWNER_SESSION_BINDING_SCHEMA,
    durable_owner_readback_required: true,
    durable_owner_readback_freshness_ms: BROWSER_GUARDIAN_OWNER_READBACK_MAX_AGE_MS,
    caller_supplied_owner_sid_allowed: false,
    enrolled_device_challenge_required: true,
    device_fingerprint_must_match_durable_record: true,
    active_wts_session_must_match_durable_owner: true,
    existing_one_attempt_journal_required: true,
    direct_wts_execution_allowed: false,
    journal_mutation_allowed: false,
    process_effect_allowed: false,
    scm_effect_allowed: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
