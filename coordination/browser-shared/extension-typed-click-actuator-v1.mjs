import { digestActionGraphEvidence } from './durable-action-graph-core-v1.mjs';

const ACTION_ID = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const PLATFORMS = new Set(['CHATGPT', 'GLM_ZAI']);
const OUTCOMES = new Set(['COMMITTED', 'NO_EFFECT', 'AMBIGUOUS']);
const CLICKABLE_ROLES = new Set(['button', 'checkbox', 'radio', 'switch', 'tab', 'menuitem']);

export class ExtensionTypedClickActuatorError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ExtensionTypedClickActuatorError';
    this.code = code;
  }
}

function bounded(value, max, code) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw new ExtensionTypedClickActuatorError(code);
  return value;
}

function normalizeEphemeral(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExtensionTypedClickActuatorError('extension_click_ephemeral_invalid');
  const keys = Object.keys(value).sort();
  const expected = ['accessible_name', 'platform', 'role'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new ExtensionTypedClickActuatorError('extension_click_ephemeral_fields_invalid');
  }
  const platform = bounded(value.platform, 16, 'extension_click_platform_invalid').toUpperCase();
  if (!PLATFORMS.has(platform)) throw new ExtensionTypedClickActuatorError('extension_click_platform_invalid');
  const role = bounded(value.role, 64, 'extension_click_role_invalid').trim().toLowerCase();
  if (!CLICKABLE_ROLES.has(role)) throw new ExtensionTypedClickActuatorError('extension_click_role_invalid');
  const accessibleName = bounded(value.accessible_name, 500, 'extension_click_accessible_name_invalid').replace(/\s+/gu, ' ').trim();
  if (!accessibleName) throw new ExtensionTypedClickActuatorError('extension_click_accessible_name_invalid');
  return Object.freeze({ platform, role, accessible_name: accessibleName });
}

function normalizeCompletion(value, actionId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ExtensionTypedClickActuatorError('extension_click_completion_invalid');
  const status = String(value.status || '').toUpperCase();
  if (status !== 'COMPLETED') throw new ExtensionTypedClickActuatorError('extension_click_completion_not_completed');
  const commandId = bounded(value.command_id, 128, 'extension_click_command_id_invalid');
  const result = value.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new ExtensionTypedClickActuatorError('extension_click_result_invalid');
  if (result.action_id !== actionId) throw new ExtensionTypedClickActuatorError('extension_click_action_id_mismatch');
  if (!OUTCOMES.has(result.outcome)) throw new ExtensionTypedClickActuatorError('extension_click_outcome_invalid');
  if (typeof result.physical_dispatch_started !== 'boolean') throw new ExtensionTypedClickActuatorError('extension_click_dispatch_flag_invalid');
  if (result.automatic_retry_allowed !== false || result.authority_effect !== false || result.actuation_eligible !== false) {
    throw new ExtensionTypedClickActuatorError('extension_click_result_authority_invalid');
  }
  if (result.outcome === 'NO_EFFECT' && result.physical_dispatch_started !== false) {
    throw new ExtensionTypedClickActuatorError('extension_click_no_effect_dispatch_invalid');
  }
  if ((result.outcome === 'COMMITTED' || result.outcome === 'AMBIGUOUS') && result.physical_dispatch_started !== true) {
    throw new ExtensionTypedClickActuatorError('extension_click_effect_dispatch_invalid');
  }
  const reasonCode = bounded(result.reason_code, 128, 'extension_click_reason_invalid');
  return Object.freeze({ command_id: commandId, result: Object.freeze({
    action_id: actionId,
    outcome: result.outcome,
    reason_code: reasonCode,
    physical_dispatch_started: result.physical_dispatch_started,
    automatic_retry_allowed: false,
    authority_effect: false,
    actuation_eligible: false,
  }) });
}

export class ExtensionTypedClickActuatorV1 {
  #dispatch;

  constructor({ dispatchCommand }) {
    if (typeof dispatchCommand !== 'function') throw new ExtensionTypedClickActuatorError('extension_click_transport_invalid');
    this.#dispatch = dispatchCommand;
  }

  async invoke(request) {
    const actionId = bounded(request?.action_id, 128, 'extension_click_action_id_invalid');
    if (!ACTION_ID.test(actionId)) throw new ExtensionTypedClickActuatorError('extension_click_action_id_invalid');
    if (String(request?.action_kind || '').toUpperCase() !== 'CLICK') throw new ExtensionTypedClickActuatorError('extension_click_action_kind_invalid');
    const target = normalizeEphemeral(request?.ephemeral);

    const completion = await this.#dispatch(Object.freeze({
      action: 'TYPED_CLICK',
      platform: target.platform,
      payload: Object.freeze({
        action_id: actionId,
        role: target.role,
        accessible_name: target.accessible_name,
      }),
      required_mode: 'CONTROL',
      required_armed: true,
      automatic_retry_allowed: false,
    }));

    const normalized = normalizeCompletion(completion, actionId);
    const evidence = Object.freeze({
      schema: 'metaengine.a2-browser-r8d.typed-click-receipt.v1',
      action_id: actionId,
      command_id: normalized.command_id,
      outcome: normalized.result.outcome,
      reason_code: normalized.result.reason_code,
      physical_dispatch_started: normalized.result.physical_dispatch_started,
    });
    const digest = digestActionGraphEvidence(evidence);
    if (normalized.result.outcome === 'COMMITTED') return Object.freeze({ outcome: 'COMMITTED', effect_receipt_digest: digest });
    if (normalized.result.outcome === 'NO_EFFECT') return Object.freeze({ outcome: 'NO_EFFECT', no_effect_evidence_digest: digest });
    return Object.freeze({ outcome: 'AMBIGUOUS', uncertainty_digest: digest });
  }
}

export function createExtensionTypedClickActuator(options) {
  const adapter = new ExtensionTypedClickActuatorV1(options);
  return adapter.invoke.bind(adapter);
}
