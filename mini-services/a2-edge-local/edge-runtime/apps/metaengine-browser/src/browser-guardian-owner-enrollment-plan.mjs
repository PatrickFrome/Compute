export const BROWSER_GUARDIAN_OWNER_ENROLLMENT_PLAN_SCHEMA = 'metaengine.browser-guardian.owner-enrollment-plan.v1';
export const BROWSER_GUARDIAN_OWNER_ENROLLMENT_PLAN_VERSION = '1.0.0';
export const BROWSER_GUARDIAN_OWNER_ENROLLMENT_RECORD_SCHEMA = 'metaengine.browser-guardian.owner-enrollment-record.v1';

const EVIDENCE_SCHEMA = 'metaengine.browser-guardian.owner-enrollment-evidence.v1';
const EVIDENCE_VERSION = '1.0.0';
const SID_RE = /^S-\d-\d+(?:-\d+)+$/i;
const HASH_RE = /^[a-f0-9]{64}$/;
const ACTIONS = new Set([
  'HOLD',
  'ENROLL_EXPECTED_OWNER_SID',
  'NOOP_ENROLLED_EXACT',
  'HOLD_OWNER_MISMATCH',
]);

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function normalizeSid(value) {
  const sid = String(value ?? '').trim().toUpperCase();
  return SID_RE.test(sid) ? sid : null;
}

function normalizeHash(value) {
  const hash = String(value ?? '').trim().toLowerCase();
  return HASH_RE.test(hash) ? hash : null;
}

function output(action, reason, extra = {}) {
  if (!ACTIONS.has(action)) throw new Error('guardian_owner_enrollment_plan_action_invalid');
  return freeze({
    schema: BROWSER_GUARDIAN_OWNER_ENROLLMENT_PLAN_SCHEMA,
    version: BROWSER_GUARDIAN_OWNER_ENROLLMENT_PLAN_VERSION,
    action,
    reason,
    durable_write_candidate: action === 'ENROLL_EXPECTED_OWNER_SID',
    exact_current_state_cas_required: action === 'ENROLL_EXPECTED_OWNER_SID',
    expected_absence_required: action === 'ENROLL_EXPECTED_OWNER_SID',
    owner_replacement_allowed: false,
    durable_enrollment_allowed: false,
    journal_mutation_allowed: false,
    wts_execution_allowed: false,
    process_effect_allowed: false,
    scm_effect_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    page_model_text_authority: false,
    release_authority: false,
    session_token_authority: false,
    automatic_retry_allowed: false,
    retry_loop_allowed: false,
    second_scheduler_allowed: false,
    authority_effect: false,
    ...extra,
  });
}

function normalizeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  if (evidence.schema !== EVIDENCE_SCHEMA || evidence.version !== EVIDENCE_VERSION) return null;
  if (evidence.state !== 'EVIDENCE_PROVEN' || evidence.owner_sid_binding_candidate !== true) return null;
  if (evidence.durable_enrollment_allowed !== false || evidence.authority_effect !== false) return null;
  for (const field of [
    'wts_execution_allowed',
    'process_effect_allowed',
    'scm_effect_allowed',
    'browser_authority',
    'task_authority',
    'scheduler_authority',
    'page_model_text_authority',
    'release_authority',
    'automatic_retry_allowed',
  ]) {
    if (evidence[field] !== false) return null;
  }

  const expectedOwnerSid = normalizeSid(evidence.expected_owner_sid_candidate);
  const enrollmentEvidenceSha256 = normalizeHash(evidence.enrollment_evidence_sha256);
  const deviceKeyFingerprintSha256 = normalizeHash(evidence.device_key_fingerprint_sha256);
  const tokenSessionId = Number(evidence.token_session_id);
  if (!expectedOwnerSid || !enrollmentEvidenceSha256 || !deviceKeyFingerprintSha256) return null;
  if (!Number.isSafeInteger(tokenSessionId) || tokenSessionId < 1) return null;

  return freeze({
    expected_owner_sid: expectedOwnerSid,
    enrollment_evidence_sha256: enrollmentEvidenceSha256,
    device_key_fingerprint_sha256: deviceKeyFingerprintSha256,
    observed_token_session_id: tokenSessionId,
  });
}

function normalizeDurableState(durable) {
  if (durable == null) return freeze({ present: false });
  if (typeof durable !== 'object' || Array.isArray(durable)) return null;

  const rawSid = String(durable.expected_owner_sid ?? '').trim();
  if (!rawSid) {
    const materialFields = ['schema', 'enrollment_evidence_sha256', 'device_key_fingerprint_sha256'];
    if (materialFields.some((field) => durable[field] != null && String(durable[field]).trim() !== '')) return null;
    return freeze({ present: false });
  }

  const expectedOwnerSid = normalizeSid(rawSid);
  if (!expectedOwnerSid) return null;
  if (durable.schema != null && durable.schema !== BROWSER_GUARDIAN_OWNER_ENROLLMENT_RECORD_SCHEMA) return null;

  const evidenceHash = durable.enrollment_evidence_sha256 == null
    ? null
    : normalizeHash(durable.enrollment_evidence_sha256);
  const deviceHash = durable.device_key_fingerprint_sha256 == null
    ? null
    : normalizeHash(durable.device_key_fingerprint_sha256);
  if (durable.enrollment_evidence_sha256 != null && !evidenceHash) return null;
  if (durable.device_key_fingerprint_sha256 != null && !deviceHash) return null;

  return freeze({
    present: true,
    expected_owner_sid: expectedOwnerSid,
    enrollment_evidence_sha256: evidenceHash,
    device_key_fingerprint_sha256: deviceHash,
  });
}

/**
 * Pure level-triggered bridge from proven owner-enrollment evidence to one bounded
 * durable-state candidate. The durable identity is the Windows owner SID only;
 * token session IDs are intentionally observation-only because sessions reincarnate.
 *
 * ENROLL_EXPECTED_OWNER_SID is not write authority. A separate adapter must perform
 * an exact-current-state compare-and-set that proves the durable owner record is still
 * absent. Existing owner records are immutable here: a SID mismatch is fail-closed and
 * requires an explicit replacement protocol outside this planner.
 */
export function evaluateGuardianOwnerEnrollmentPlan({ evidence = null, durable = null } = {}) {
  const proven = normalizeEvidence(evidence);
  if (!proven) return output('HOLD', 'OWNER_ENROLLMENT_EVIDENCE_INVALID');

  const current = normalizeDurableState(durable);
  if (!current) return output('HOLD', 'DURABLE_OWNER_ENROLLMENT_STATE_INVALID');

  if (!current.present) {
    return output('ENROLL_EXPECTED_OWNER_SID', 'PROVEN_OWNER_SID_WITH_DURABLE_ABSENCE', {
      expected_owner_sid_candidate: proven.expected_owner_sid,
      observed_token_session_id: proven.observed_token_session_id,
      candidate_record: freeze({
        schema: BROWSER_GUARDIAN_OWNER_ENROLLMENT_RECORD_SCHEMA,
        expected_owner_sid: proven.expected_owner_sid,
        enrollment_evidence_sha256: proven.enrollment_evidence_sha256,
        device_key_fingerprint_sha256: proven.device_key_fingerprint_sha256,
      }),
    });
  }

  if (current.expected_owner_sid !== proven.expected_owner_sid) {
    return output('HOLD_OWNER_MISMATCH', 'DURABLE_OWNER_SID_MISMATCH', {
      expected_owner_sid_candidate: proven.expected_owner_sid,
      durable_expected_owner_sid: current.expected_owner_sid,
      replacement_protocol_required: true,
    });
  }

  return output('NOOP_ENROLLED_EXACT', 'DURABLE_OWNER_SID_ALREADY_EXACT', {
    durable_expected_owner_sid: current.expected_owner_sid,
    observed_token_session_id: proven.observed_token_session_id,
  });
}
