import crypto from 'node:crypto';

export const BROWSER_GUARDIAN_OWNER_ENROLLMENT_SCHEMA = 'metaengine.browser-guardian.owner-enrollment-evidence.v1';
export const BROWSER_GUARDIAN_OWNER_ENROLLMENT_VERSION = '1.0.0';

const SID_RE = /^S-\d-\d+(?:-\d+)+$/i;
const HASH_RE = /^[a-f0-9]{64}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{32,128}$/;

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function normalizeSid(value) {
  const sid = String(value ?? '').trim().toUpperCase();
  return SID_RE.test(sid) ? sid : null;
}

function hold(reason, extra = {}) {
  return freeze({
    schema: BROWSER_GUARDIAN_OWNER_ENROLLMENT_SCHEMA,
    version: BROWSER_GUARDIAN_OWNER_ENROLLMENT_VERSION,
    state: 'HOLD',
    reason,
    owner_sid_binding_candidate: false,
    durable_enrollment_allowed: false,
    wts_execution_allowed: false,
    process_effect_allowed: false,
    scm_effect_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    page_model_text_authority: false,
    release_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...extra,
  });
}

/**
 * Pure projection of a native named-pipe enrollment observation.
 *
 * The native observer is responsible for deriving user_sid/session_id from the
 * impersonated pipe client's token. Client-supplied SID/session values are never
 * accepted by this contract. A valid observation is still only evidence: a separate
 * durable adapter may bind expected_owner_sid after its own exact-current-state CAS.
 * This function never grants WTS, process, SCM, Browser, task, or retry authority.
 */
export function evaluateGuardianOwnerEnrollmentEvidence({
  challenge = {},
  transport = {},
  token = {},
  device = {},
} = {}) {
  const nonce = String(challenge.nonce || '');
  if (!NONCE_RE.test(nonce)) return hold('CHALLENGE_NONCE_INVALID');
  const nonceSha256 = sha256(nonce);

  if (transport.local_only !== true || transport.pipe_reject_remote_clients !== true) {
    return hold('LOCAL_ONLY_PIPE_UNPROVEN');
  }
  if (transport.explicit_dacl !== true || transport.default_dacl_used === true) {
    return hold('EXPLICIT_PIPE_DACL_UNPROVEN');
  }
  if (transport.first_pipe_instance !== true) return hold('FIRST_PIPE_INSTANCE_UNPROVEN');
  if (transport.overlapped_io !== true || transport.pipe_nowait_used === true) {
    return hold('OVERLAPPED_IO_CONTRACT_UNPROVEN');
  }
  if (transport.generic_write_granted === true || transport.client_create_pipe_instance_allowed === true) {
    return hold('PIPE_INSTANCE_CREATION_RIGHT_EXPOSED');
  }
  if (transport.client_message_read_before_impersonation !== true) {
    return hold('CLIENT_MESSAGE_IMPERSONATION_ORDER_UNPROVEN');
  }
  if (transport.impersonation_succeeded !== true || transport.revert_to_self_succeeded !== true) {
    return hold('PIPE_CLIENT_IMPERSONATION_UNPROVEN');
  }

  const userSid = normalizeSid(token.user_sid);
  const sessionId = Number(token.session_id);
  if (!userSid || !Number.isSafeInteger(sessionId) || sessionId < 1) {
    return hold('TOKEN_IDENTITY_INVALID');
  }
  if (token.identity_source !== 'IMPERSONATED_PIPE_CLIENT_TOKEN') {
    return hold('TOKEN_IDENTITY_SOURCE_INVALID');
  }
  if (token.token_user_readback !== true || token.token_session_id_readback !== true) {
    return hold('TOKEN_IDENTITY_READBACK_UNPROVEN');
  }
  if (token.client_supplied_sid_used === true || token.client_supplied_session_id_used === true) {
    return hold('CLIENT_SUPPLIED_IDENTITY_REJECTED');
  }

  const fingerprint = String(device.key_fingerprint_sha256 || '').toLowerCase();
  if (!HASH_RE.test(fingerprint) || device.enrolled !== true) {
    return hold('DEVICE_IDENTITY_UNPROVEN');
  }
  if (device.challenge_signature_verified !== true) {
    return hold('DEVICE_CHALLENGE_SIGNATURE_UNPROVEN');
  }
  if (String(device.challenge_nonce_sha256 || '').toLowerCase() !== nonceSha256) {
    return hold('DEVICE_CHALLENGE_BINDING_MISMATCH');
  }
  if (device.transport_client_pid_bound !== true) {
    return hold('DEVICE_PROCESS_BINDING_UNPROVEN');
  }

  return freeze({
    schema: BROWSER_GUARDIAN_OWNER_ENROLLMENT_SCHEMA,
    version: BROWSER_GUARDIAN_OWNER_ENROLLMENT_VERSION,
    state: 'EVIDENCE_PROVEN',
    reason: 'TOKEN_AND_DEVICE_BOUND_OWNER_CANDIDATE',
    owner_sid_binding_candidate: true,
    expected_owner_sid_candidate: userSid,
    token_session_id: sessionId,
    challenge_nonce_sha256: nonceSha256,
    device_key_fingerprint_sha256: fingerprint,
    enrollment_evidence_sha256: sha256(JSON.stringify({
      schema: BROWSER_GUARDIAN_OWNER_ENROLLMENT_SCHEMA,
      owner_sid: userSid,
      session_id: sessionId,
      challenge_nonce_sha256: nonceSha256,
      device_key_fingerprint_sha256: fingerprint,
      transport_client_pid: Number(transport.client_pid || 0),
    })),
    durable_enrollment_allowed: false,
    wts_execution_allowed: false,
    process_effect_allowed: false,
    scm_effect_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    page_model_text_authority: false,
    release_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
