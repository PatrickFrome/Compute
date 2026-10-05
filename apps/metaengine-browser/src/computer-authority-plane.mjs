import { createHash } from 'node:crypto';

export const COMPUTER_AUTHORITY_PLANE_SCHEMA = 'metaengine.computer-authority-plane.v1';
export const COMPUTER_EFFECT_RECEIPT_SCHEMA = 'metaengine.computer-effect-receipt.v1';

const READ_ONLY_ACTIONS = new Set([
  'STATUS',
  'OBSERVE_WINDOWS',
  'OBSERVE_DISPLAYS',
  'FOREGROUND_STATUS',
  'UIA_SNAPSHOT',
  'CAPTURE_DESKTOP',
  'CAPTURE_WINDOW',
  'VERIFY_TARGET',
]);

const MUTATING_ACTIONS = new Set([
  'UIA_FOCUS',
  'UIA_INVOKE',
  'UIA_SET_VALUE',
  'UIA_TOGGLE',
  'UIA_SELECT',
  'UIA_EXPAND_COLLAPSE',
  'UIA_SCROLL',
  'TYPE_TEXT',
  'KEY_PRESS',
  'POINTER_CLICK',
]);

const SAFE_KEYS = new Set([
  'ENTER',
  'ESCAPE',
  'TAB',
  'BACKSPACE',
  'DELETE',
  'ARROWUP',
  'ARROWDOWN',
  'ARROWLEFT',
  'ARROWRIGHT',
  'HOME',
  'END',
  'PAGEUP',
  'PAGEDOWN',
  'CTRL+A',
]);

const SHA256_RE = /^[0-9a-f]{64}$/;
const HWND_RE = /^0x[0-9a-f]+$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AGENT_ID_RE = /^agent_[a-z0-9-]{8,64}$/i;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function positiveSafeInt(value, name) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out <= 0) throw new Error(`computer_${name}_invalid`);
  return out;
}

function nonNegativeSafeInt(value, name) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0) throw new Error(`computer_${name}_invalid`);
  return out;
}

function normalizeRuntimeId(value, code = 'computer_uia_runtime_id_invalid') {
  const runtimeId = Array.isArray(value) ? value.map((v) => Number(v)) : [];
  if (!runtimeId.length || runtimeId.length > 64 || runtimeId.some((v) => !Number.isSafeInteger(v))) {
    throw new Error(code);
  }
  return Object.freeze(runtimeId);
}

function normalizeVisualFence(value) {
  const frameSha256 = String(value?.frame_sha256 || '').toLowerCase();
  if (!SHA256_RE.test(frameSha256)) throw new Error('computer_visual_frame_fence_required');
  return Object.freeze({ frame_sha256: frameSha256, max_age_ms: 3000 });
}

export function classifyComputerAction(action) {
  const normalized = String(action || '').trim().toUpperCase();
  if (READ_ONLY_ACTIONS.has(normalized)) return Object.freeze({ action: normalized, lane: 'READ_ONLY', mutating: false });
  if (MUTATING_ACTIONS.has(normalized)) return Object.freeze({ action: normalized, lane: 'GLOBAL_MUTATION', mutating: true });
  throw new Error('computer_action_not_allowlisted');
}

export function normalizeComputerTargetIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('computer_target_identity_required');
  const machineFingerprint = String(value.machine_fingerprint_sha256 || '').toLowerCase();
  const executableSha = String(value.executable_sha256 || '').toLowerCase();
  const windowHandle = String(value.window_handle || '').toLowerCase();
  if (!SHA256_RE.test(machineFingerprint)) throw new Error('computer_machine_fingerprint_invalid');
  if (!SHA256_RE.test(executableSha)) throw new Error('computer_executable_sha256_invalid');
  if (!HWND_RE.test(windowHandle)) throw new Error('computer_window_handle_invalid');

  return Object.freeze({
    schema: 'metaengine.computer-target-identity.v1',
    machine_fingerprint_sha256: machineFingerprint,
    session_id: nonNegativeSafeInt(value.session_id, 'session_id'),
    process_id: positiveSafeInt(value.process_id, 'process_id'),
    process_creation_time_ms: positiveSafeInt(value.process_creation_time_ms, 'process_creation_time_ms'),
    window_handle: windowHandle,
    executable_sha256: executableSha,
    generation: positiveSafeInt(value.generation, 'generation'),
    authority_effect: false,
  });
}

export function computerTargetIdentityDigest(identity) {
  const normalized = normalizeComputerTargetIdentity(identity);
  const material = [
    normalized.machine_fingerprint_sha256,
    normalized.session_id,
    normalized.process_id,
    normalized.process_creation_time_ms,
    normalized.window_handle,
    normalized.executable_sha256,
    normalized.generation,
  ].join('|');
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

function normalizeArgs(action, args) {
  const input = args && typeof args === 'object' && !Array.isArray(args) ? clone(args) : {};

  if (action === 'TYPE_TEXT') {
    const text = String(input.text ?? '');
    if (!text || text.length > 120000) throw new Error('computer_type_text_invalid');
    if (input.replace === false) throw new Error('computer_type_append_mode_unproven');
    return Object.freeze({
      text,
      runtime_id: normalizeRuntimeId(input.runtime_id, 'computer_type_runtime_id_invalid'),
      replace: true,
    });
  }

  if (action === 'UIA_SET_VALUE') {
    const value = String(input.value ?? '');
    if (value.length > 120000) throw new Error('computer_uia_value_invalid');
    return Object.freeze({
      runtime_id: normalizeRuntimeId(input.runtime_id),
      value,
    });
  }

  if (['UIA_FOCUS','UIA_INVOKE','UIA_TOGGLE','UIA_SELECT'].includes(action)) {
    return Object.freeze({ runtime_id: normalizeRuntimeId(input.runtime_id) });
  }

  if (action === 'UIA_EXPAND_COLLAPSE') {
    const state = String(input.state || '').trim().toUpperCase();
    if (!['EXPAND','COLLAPSE'].includes(state)) throw new Error('computer_uia_expand_state_invalid');
    return Object.freeze({ runtime_id: normalizeRuntimeId(input.runtime_id), state });
  }

  if (action === 'UIA_SCROLL') {
    const allowed = new Set(['LARGE_DECREMENT','SMALL_DECREMENT','NO_AMOUNT','LARGE_INCREMENT','SMALL_INCREMENT']);
    const horizontal = String(input.horizontal || 'NO_AMOUNT').trim().toUpperCase();
    const vertical = String(input.vertical || 'NO_AMOUNT').trim().toUpperCase();
    if (!allowed.has(horizontal) || !allowed.has(vertical) || (horizontal === 'NO_AMOUNT' && vertical === 'NO_AMOUNT')) {
      throw new Error('computer_uia_scroll_amount_invalid');
    }
    return Object.freeze({
      runtime_id: normalizeRuntimeId(input.runtime_id),
      horizontal,
      vertical,
    });
  }

  if (action === 'KEY_PRESS') {
    const key = String(input.key || '').trim().toUpperCase();
    if (!SAFE_KEYS.has(key)) throw new Error('computer_key_not_allowlisted');
    return Object.freeze({ key });
  }


  if (action === 'POINTER_CLICK') {
    const x = Number(input.x);
    const y = Number(input.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) throw new Error('computer_pointer_coordinates_invalid');
    return Object.freeze({
      x: Math.floor(x),
      y: Math.floor(y),
      button: 'LEFT',
      visual_fence: normalizeVisualFence(input.visual_fence),
    });
  }

  if (action === 'UIA_SNAPSHOT') {
    const limitRaw = input.limit == null ? 256 : Number(input.limit);
    const offsetRaw = input.offset == null ? 0 : Number(input.offset);
    const limit = Number.isSafeInteger(limitRaw) ? Math.max(1, Math.min(1024, limitRaw)) : 256;
    const offset = Number.isSafeInteger(offsetRaw) ? Math.max(0, Math.min(65535, offsetRaw)) : 0;
    return Object.freeze({ offset, limit });
  }

  if (action === 'OBSERVE_WINDOWS') {
    const limitRaw = input.limit == null ? 128 : Number(input.limit);
    const offsetRaw = input.offset == null ? 0 : Number(input.offset);
    const limit = Number.isSafeInteger(limitRaw) ? Math.max(1, Math.min(256, limitRaw)) : 128;
    const offset = Number.isSafeInteger(offsetRaw) ? Math.max(0, Math.min(65535, offsetRaw)) : 0;
    return Object.freeze({ offset, limit });
  }

  if (action === 'OBSERVE_DISPLAYS' || action === 'FOREGROUND_STATUS') return Object.freeze({});

  if (action === 'CAPTURE_DESKTOP') {
    const monitorRaw = input.monitor == null ? 0 : Number(input.monitor);
    const monitor = Number.isSafeInteger(monitorRaw) ? Math.max(0, Math.min(31, monitorRaw)) : 0;
    return Object.freeze({ monitor });
  }

  if (action === 'CAPTURE_WINDOW') return Object.freeze({});

  return Object.freeze({});
}

function assertLeaseBinding(context) {
  const commandId = String(context?.command_id || '');
  if (!UUID_RE.test(commandId)) throw new Error('computer_db_lease_command_id_required');
  const binding = context?.effect_binding;
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) throw new Error('computer_effect_binding_required');
  if (binding.authority_effect !== false || binding.page_data_authority !== false || binding.automatic_retry_allowed !== false) {
    throw new Error('computer_effect_binding_invalid');
  }
  return Object.freeze({
    command_id: commandId.toLowerCase(),
    effect_binding: clone(binding),
    authority_source: 'DB_LEASE_ONLY',
  });
}

export function normalizeComputerRequest(input, context = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('computer_request_invalid');
  const classification = classifyComputerAction(input.action);
  const targetRequired = classification.mutating || ['UIA_SNAPSHOT','CAPTURE_WINDOW','VERIFY_TARGET'].includes(classification.action);
  const target = targetRequired ? normalizeComputerTargetIdentity(input.target) : null;
  const expectedDigest = target ? computerTargetIdentityDigest(target) : null;
  if (target && input.target_identity_sha256 && String(input.target_identity_sha256).toLowerCase() !== expectedDigest) {
    throw new Error('computer_target_identity_digest_mismatch');
  }
  const lease = classification.mutating ? assertLeaseBinding(context) : null;
  const agentId = input.agent_id == null ? null : String(input.agent_id).trim().toLowerCase();
  if (classification.mutating && !AGENT_ID_RE.test(agentId || '')) throw new Error('computer_agent_id_required');
  if (agentId && !AGENT_ID_RE.test(agentId)) throw new Error('computer_agent_id_invalid');
  if (classification.mutating) {
    const binding = lease.effect_binding;
    if (binding.schema !== 'metaengine.native-supervisor.computer-effect-binding.v1') throw new Error('computer_effect_binding_schema_invalid');
    if (String(binding.action || '').toUpperCase() !== 'COMPUTER_ACTION') throw new Error('computer_effect_binding_action_invalid');
    if (String(binding.computer_action || '').toUpperCase() !== classification.action) throw new Error('computer_effect_binding_subaction_mismatch');
    if (String(binding.agent_id || '').toLowerCase() !== agentId) throw new Error('computer_effect_binding_agent_mismatch');
    if (String(binding.target_identity_sha256 || '').toLowerCase() !== expectedDigest) throw new Error('computer_effect_binding_target_digest_mismatch');
    if (JSON.stringify(binding.target || null) !== JSON.stringify(target)) throw new Error('computer_effect_binding_target_mismatch');
    if (String(binding.command_id || '').toLowerCase() !== lease.command_id) throw new Error('computer_effect_binding_command_mismatch');
  }
  return Object.freeze({
    schema: 'metaengine.computer-request.v1',
    action: classification.action,
    lane: classification.lane,
    mutating: classification.mutating,
    agent_id: agentId,
    target,
    target_identity_sha256: expectedDigest,
    args: normalizeArgs(classification.action, input.args),
    lease,
    automatic_retry_allowed: false,
    page_data_authority: false,
    authority_effect: false,
  });
}

export function planComputerToolRoute({ browser_semantic = null, windows_uia = null, visual = null } = {}) {
  if (
    browser_semantic?.exact_target === true
    && browser_semantic?.semantic_ref_current === true
    && browser_semantic?.target_incarnation_current === true
  ) {
    return Object.freeze({
      route: 'BROWSER_SEMANTIC',
      reason: 'EXACT_SEMANTIC_TARGET_CURRENT',
      requires_computer_mutation: false,
      authority_effect: false,
    });
  }
  if (
    windows_uia?.exact_target_count === 1
    && windows_uia?.target_identity_current === true
    && windows_uia?.runtime_id_current === true
  ) {
    return Object.freeze({
      route: 'WINDOWS_UIA',
      reason: 'EXACT_UIA_TARGET_CURRENT',
      requires_computer_mutation: true,
      authority_effect: false,
    });
  }
  if (
    visual?.fresh_frame === true
    && visual?.exact_window_identity === true
    && visual?.coordinate_inside_window === true
  ) {
    return Object.freeze({
      route: 'COMPUTER_VISUAL',
      reason: 'FRESH_VISUAL_FRAME_EXACT_WINDOW',
      requires_computer_mutation: true,
      authority_effect: false,
    });
  }
  return Object.freeze({
    route: 'BLOCKED',
    reason: 'NO_EXACT_EXECUTION_TARGET',
    requires_computer_mutation: false,
    authority_effect: false,
  });
}

export function computerAuthorityPlaneSnapshot() {
  return Object.freeze({
    schema: COMPUTER_AUTHORITY_PLANE_SCHEMA,
    version: '2.0.0',
    scheduler_authority: false,
    command_authority: 'DB_LEASE_ONLY',
    agent_observation_scope: 'FULL_SHARED_COMPUTER_AND_BROWSER',
    agent_mutation_scope: 'FULL_TYPED_COMPUTER_CAPABILITIES_VIA_SHARED_ARBITER',
    physical_input_arbitration: 'SERIALIZE_CONFLICTING_SHARED_DESKTOP_EFFECTS',
    independent_session_parallelism: true,
    router_order: Object.freeze(['BROWSER_SEMANTIC', 'WINDOWS_UIA', 'COMPUTER_VISUAL']),
    read_only_actions: Object.freeze([...READ_ONLY_ACTIONS]),
    mutating_actions: Object.freeze([...MUTATING_ACTIONS]),
    arbitrary_eval: false,
    arbitrary_shell: false,
    raw_powershell_command_input: false,
    typed_action_schema_required: true,
    exact_target_identity_required_for_mutation: true,
    post_effect_readback_required: true,
    effect_barrier_precedes_foreground_focus_pointer_side_effects: true,
    dispatch_only_mutations_never_claim_effect_proven: true,
    type_text_requires_exact_uia_runtime_id: true,
    type_text_requires_value_readback_for_effect_proof: true,
    visual_pointer_requires_recent_capture_fence: true,
    visual_pointer_requires_target_bound_window_capture: true,
    visual_pointer_requires_unchanged_window_geometry: true,
    visual_pointer_requires_foreground_capture: true,
    visual_capture_requires_stable_foreground_geometry: true,
    visual_pointer_revalidates_pixels_after_cursor_move: true,
    visual_pointer_revalidates_target_and_foreground_before_mouse_down: true,
    visual_pointer_never_foregrounds_stale_frame: true,
    direct_uia_patterns: Object.freeze(['VALUE','INVOKE','TOGGLE','SELECTION_ITEM','EXPAND_COLLAPSE','SCROLL']),
    multi_monitor_observation: true,
    automatic_retry_allowed: false,
    page_model_data_grants_authority: false,
    authority_effect: false,
  });
}

export function projectComputerEffectReceipt({
  request,
  result,
  outcome,
  error = null,
} = {}) {
  if (!request || request.schema !== 'metaengine.computer-request.v1') throw new Error('computer_receipt_request_invalid');
  const normalizedOutcome = String(outcome || '').toUpperCase();
  if (!['NO_EFFECT_PROVEN', 'EFFECT_PROVEN', 'AMBIGUOUS_NO_RETRY'].includes(normalizedOutcome)) {
    throw new Error('computer_effect_outcome_invalid');
  }
  return Object.freeze({
    schema: COMPUTER_EFFECT_RECEIPT_SCHEMA,
    command_id: request.lease?.command_id || null,
    agent_id: request.agent_id || null,
    action: request.action,
    target_identity_sha256: request.target_identity_sha256,
    outcome: normalizedOutcome,
    result: clone(result),
    error: error == null ? null : String(error).slice(0, 500),
    automatic_retry_allowed: false,
    scheduler_authority: false,
    page_data_authority: false,
    authority_effect: normalizedOutcome === 'EFFECT_PROVEN',
  });
}
