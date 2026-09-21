export const DEVELOPER_EMERGENCY_UPDATE_ACTION = 'DEVELOPER_EMERGENCY_UPDATE';
export const DEVELOPER_EMERGENCY_UPDATE_SCHEMA = 'metaengine.developer-emergency-update.v1';
export const DEVELOPER_EMERGENCY_UPDATE_ADMISSION_SCHEMA = 'metaengine.developer-emergency-update-admission.v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE_RE = /^[A-Za-z0-9_-]{32,128}$/;
const GIT_SHA_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const ALLOWED_RECOVERY_ACTIONS = new Set([
  'NOOP_HEALTHY',
  'RECONCILE',
  'STAGE_INACTIVE_SLOT_CANDIDATE',
  'HEALTH_CHALLENGE_CANDIDATE',
  'PROMOTE_POINTER_CANDIDATE',
  'ROLLBACK_POINTER_CANDIDATE',
]);

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function hold(reason, extra = {}) {
  return freeze({
    schema: DEVELOPER_EMERGENCY_UPDATE_ADMISSION_SCHEMA,
    state: 'HOLD',
    reason,
    admitted: false,
    bypass_program_policy: false,
    arbitrary_url_allowed: false,
    arbitrary_executable_allowed: false,
    arbitrary_shell_allowed: false,
    normal_mode_required: false,
    normal_armed_required: false,
    normal_rollout_required: false,
    normal_cadence_required: false,
    developer_identity_required: true,
    verified_release_required: true,
    durable_effect_journal_required: true,
    automatic_effect_retry_allowed: false,
    direct_effect_allowed: false,
    authority_effect: false,
    ...extra,
  });
}

function exactPayload(command) {
  if (!command || String(command.action || '').toUpperCase() !== DEVELOPER_EMERGENCY_UPDATE_ACTION) return null;
  if (!UUID_RE.test(String(command.command_id || ''))) return null;
  const payload = command.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const keys = Object.keys(payload);
  const allowed = new Set(['schema', 'request_nonce', 'release_mode', 'expected_git_sha']);
  if (keys.some((key) => !allowed.has(key))) return null;
  if (payload.schema !== DEVELOPER_EMERGENCY_UPDATE_SCHEMA) return null;
  if (!NONCE_RE.test(String(payload.request_nonce || ''))) return null;
  if (String(payload.release_mode || '') !== 'LATEST_TRUSTED') return null;
  const expectedGitSha = payload.expected_git_sha == null
    ? null
    : String(payload.expected_git_sha).trim().toLowerCase();
  if (expectedGitSha != null && !GIT_SHA_RE.test(expectedGitSha)) return null;
  return freeze({
    command_id: String(command.command_id).toLowerCase(),
    request_nonce: String(payload.request_nonce),
    release_mode: 'LATEST_TRUSTED',
    expected_git_sha: expectedGitSha,
  });
}

function exactOwnerBinding(binding) {
  return binding
    && binding.schema === 'metaengine.browser-guardian.owner-session-binding.v1'
    && binding.durable_owner_binding_proven === true
    && binding.device_binding_proven === true
    && binding.caller_supplied_owner_sid_allowed === false
    && binding.automatic_retry_allowed === false
    && binding.authority_effect === false
    && SHA256_RE.test(String(binding.enrollment_evidence_sha256 || '').toLowerCase())
    && SHA256_RE.test(String(binding.device_key_fingerprint_sha256 || '').toLowerCase());
}

function exactReleaseGate(gate, expectedGitSha) {
  if (!gate
      || gate.schema !== 'metaengine.browser-fabric.release-authority-gate.v1'
      || gate.action !== 'AUTHORITY_ADVANCE_CANDIDATE'
      || gate.authority_advance_candidate !== true
      || gate.requires_separate_journaled_promotion_effect !== true
      || gate.release_authority !== false
      || gate.automatic_retry_allowed !== false
      || gate.authority_effect !== false
      || !GIT_SHA_RE.test(String(gate.candidate_sha || '').toLowerCase())
      || !SHA256_RE.test(String(gate.installer_sha256 || '').toLowerCase())
      || !SHA256_RE.test(String(gate.installed_executable_sha256 || '').toLowerCase())
      || !SHA256_RE.test(String(gate.manifest_sha256 || '').toLowerCase())) return false;
  return expectedGitSha == null || String(gate.candidate_sha).toLowerCase() === expectedGitSha;
}

function exactRecoveryPlan(plan) {
  if (!plan
      || plan.schema !== 'metaengine.browser-fabric.guardian-recovery-plan.v1'
      || !ALLOWED_RECOVERY_ACTIONS.has(String(plan.action || ''))
      || plan.release_publication_authority !== false
      || plan.policy_authority !== false
      || plan.direct_effect_allowed !== false
      || plan.automatic_retry_allowed !== false
      || plan.authority_effect !== false) return false;
  if (plan.action === 'RECONCILE') return true;
  if (plan.action === 'NOOP_HEALTHY') return true;
  return plan.requires_existing_guardian_effect_journal === true;
}

/**
 * Narrow break-glass admission contract.
 *
 * A leased command may bypass Browser policy state only after independently proving
 * durable owner/device identity and a cryptographically bound immutable release.
 * The result is still only an admission to the existing Guardian recovery plane:
 * this module never executes a file, accepts a URL/path, mutates a pointer, or
 * retries an ambiguous effect.
 */
export function evaluateDeveloperEmergencyUpdateAdmission({
  command = null,
  owner_binding = null,
  release_gate = null,
  guardian_recovery_plan = null,
} = {}) {
  const request = exactPayload(command);
  if (!request) return hold('EMERGENCY_COMMAND_INVALID');
  if (!exactOwnerBinding(owner_binding)) return hold('DEVELOPER_OWNER_DEVICE_BINDING_REQUIRED', {
    command_id: request.command_id,
    request_nonce: request.request_nonce,
  });
  if (!exactReleaseGate(release_gate, request.expected_git_sha)) return hold('VERIFIED_RELEASE_GATE_REQUIRED', {
    command_id: request.command_id,
    request_nonce: request.request_nonce,
  });
  if (!exactRecoveryPlan(guardian_recovery_plan)) return hold('GUARDIAN_RECOVERY_PLAN_REQUIRED', {
    command_id: request.command_id,
    request_nonce: request.request_nonce,
    candidate_sha: String(release_gate.candidate_sha).toLowerCase(),
  });

  return freeze({
    schema: DEVELOPER_EMERGENCY_UPDATE_ADMISSION_SCHEMA,
    state: 'ADMITTED_TO_GUARDIAN_RECOVERY',
    reason: 'DEVELOPER_AND_RELEASE_PROOFS_EXACT',
    admitted: true,
    command_id: request.command_id,
    request_nonce: request.request_nonce,
    release_mode: request.release_mode,
    candidate_sha: String(release_gate.candidate_sha).toLowerCase(),
    release_tag: release_gate.release_tag,
    release_version: release_gate.release_version,
    installer_sha256: String(release_gate.installer_sha256).toLowerCase(),
    installed_executable_sha256: String(release_gate.installed_executable_sha256).toLowerCase(),
    manifest_sha256: String(release_gate.manifest_sha256).toLowerCase(),
    guardian_action: guardian_recovery_plan.action,
    bypass_program_policy: true,
    arbitrary_url_allowed: false,
    arbitrary_executable_allowed: false,
    arbitrary_shell_allowed: false,
    normal_mode_required: false,
    normal_armed_required: false,
    normal_rollout_required: false,
    normal_cadence_required: false,
    developer_identity_required: true,
    verified_release_required: true,
    durable_effect_journal_required: true,
    automatic_effect_retry_allowed: false,
    direct_effect_allowed: false,
    authority_effect: false,
  });
}

export function developerEmergencyUpdateContract() {
  return freeze({
    schema: DEVELOPER_EMERGENCY_UPDATE_ADMISSION_SCHEMA,
    action: DEVELOPER_EMERGENCY_UPDATE_ACTION,
    bypasses_browser_mode: true,
    bypasses_browser_armed_state: true,
    bypasses_browser_rollout_policy: true,
    bypasses_browser_update_cadence: true,
    bypasses_browser_self_update_state: true,
    signed_leased_command_required: true,
    durable_owner_binding_required: true,
    fresh_enrolled_device_binding_required: true,
    verified_immutable_release_required: true,
    guardian_recovery_plane_required: true,
    arbitrary_url_allowed: false,
    arbitrary_executable_allowed: false,
    arbitrary_shell_allowed: false,
    ambiguous_effect_retry_allowed: false,
    durable_effect_journal_required: true,
    direct_effect_allowed: false,
    authority_effect: false,
  });
}
