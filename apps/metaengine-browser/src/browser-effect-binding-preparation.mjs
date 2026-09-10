import {
  buildNativeEffectBinding,
  nativeActionRequiresEffectBinding,
} from './native-effect-binding.mjs';

export const BROWSER_EFFECT_BINDING_PREPARATION_SCHEMA = 'metaengine.browser-effect-binding-preparation.v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TAB_ID_RE = /^tab_[0-9a-f-]{36}$/i;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{16,160}$/;
const OBSERVATION_ID_RE = /^obs_[a-f0-9]{32}$/i;
const TARGET_ID_RE = /^webcontents:[1-9][0-9]*$/i;

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCommand(value, nowMs) {
  if (!plainObject(value)) throw new Error('browser_effect_binding_prepare_command_invalid');
  const commandId = String(value.command_id || '').trim().toLowerCase();
  if (!UUID_RE.test(commandId)) throw new Error('browser_effect_binding_prepare_command_id_invalid');
  const action = String(value.action || '').trim().toUpperCase();
  if (!nativeActionRequiresEffectBinding(action)) throw new Error(`browser_effect_binding_prepare_action_denied:${action || 'UNKNOWN'}`);
  const tabId = String(value.payload?.tab_id || '').trim();
  if (!TAB_ID_RE.test(tabId)) throw new Error('browser_effect_binding_prepare_exact_tab_required');
  const idempotencyKey = String(value.idempotency_key || '').trim();
  if (!IDEMPOTENCY_RE.test(idempotencyKey)) throw new Error('browser_effect_binding_prepare_idempotency_key_invalid');
  const expiresAt = Date.parse(String(value.expires_at || ''));
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) throw new Error('browser_effect_binding_prepare_command_expired');
  return Object.freeze({
    command_id: commandId,
    action,
    platform: value.platform == null ? null : String(value.platform).slice(0, 80),
    payload: Object.freeze({ tab_id: tabId }),
    idempotency_key: idempotencyKey,
    expires_at: new Date(expiresAt).toISOString(),
  });
}

function normalizeObservation(frame, command) {
  if (!plainObject(frame)) throw new Error('browser_effect_binding_prepare_observation_invalid');
  const tabId = String(frame.tab_id || '').trim();
  const processIncarnationId = String(frame.process_incarnation_id || '').trim().toLowerCase();
  const targetId = String(frame.target_id || '').trim().toLowerCase();
  const runtimeObservationId = String(frame.runtime_observation_id || '').trim().toLowerCase();
  const observedAt = new Date(frame.captured_at || frame.observed_at || '');
  if (tabId !== command.payload.tab_id) throw new Error('browser_effect_binding_prepare_tab_drift');
  if (!UUID_RE.test(processIncarnationId)) throw new Error('browser_effect_binding_prepare_process_incarnation_invalid');
  if (!TARGET_ID_RE.test(targetId)) throw new Error('browser_effect_binding_prepare_target_invalid');
  if (!OBSERVATION_ID_RE.test(runtimeObservationId)) throw new Error('browser_effect_binding_prepare_runtime_observation_invalid');
  if (!Number.isFinite(observedAt.getTime())) throw new Error('browser_effect_binding_prepare_observed_at_invalid');
  return Object.freeze({
    process_incarnation_id: processIncarnationId,
    tab_id: tabId,
    target_id: targetId,
    observed_at: observedAt.toISOString(),
    runtime_observation_id: runtimeObservationId,
  });
}

function normalizeIdentity(value) {
  if (!plainObject(value)) throw new Error('browser_effect_binding_prepare_identity_invalid');
  const clientId = String(value.client_id || '').trim().toLowerCase();
  if (!UUID_RE.test(clientId)) throw new Error('browser_effect_binding_prepare_client_id_invalid');
  return Object.freeze({ client_id: clientId });
}

export class BrowserEffectBindingPreparation {
  #captureCommand;
  #identitySnapshot;
  #buildBinding;

  constructor({ captureCommand, identitySnapshot, buildBinding = buildNativeEffectBinding } = {}) {
    if (typeof captureCommand !== 'function') throw new Error('browser_effect_binding_prepare_capture_required');
    if (typeof identitySnapshot !== 'function') throw new Error('browser_effect_binding_prepare_identity_required');
    if (typeof buildBinding !== 'function') throw new Error('browser_effect_binding_prepare_builder_invalid');
    this.#captureCommand = captureCommand;
    this.#identitySnapshot = identitySnapshot;
    this.#buildBinding = buildBinding;
  }

  async prepare(value, { signal } = {}) {
    const command = normalizeCommand(value, Date.now());
    if (signal?.aborted) throw new Error('browser_effect_binding_prepare_aborted');
    const frame = await this.#captureCommand({
      action: 'CAPTURE',
      platform: command.platform,
      payload: { tab_id: command.payload.tab_id },
    }, { signal });
    if (signal?.aborted) throw new Error('browser_effect_binding_prepare_aborted');
    if (Date.parse(command.expires_at) <= Date.now()) throw new Error('browser_effect_binding_prepare_command_expired');
    const observation = normalizeObservation(frame, command);
    const identity = normalizeIdentity(await this.#identitySnapshot());
    if (signal?.aborted) throw new Error('browser_effect_binding_prepare_aborted');
    if (Date.parse(command.expires_at) <= Date.now()) throw new Error('browser_effect_binding_prepare_command_expired');
    const binding = await this.#buildBinding({
      command: structuredClone(command),
      clientId: identity.client_id,
      processIncarnationId: observation.process_incarnation_id,
      tabId: observation.tab_id,
      targetId: observation.target_id,
      observedAt: observation.observed_at,
      runtimeObservationId: observation.runtime_observation_id,
    });
    if (!plainObject(binding)) throw new Error('browser_effect_binding_prepare_binding_invalid');
    return Object.freeze({
      schema: BROWSER_EFFECT_BINDING_PREPARATION_SCHEMA,
      command_id: command.command_id,
      action: command.action,
      tab_id: observation.tab_id,
      process_incarnation_id: observation.process_incarnation_id,
      target_id: observation.target_id,
      observed_at: observation.observed_at,
      runtime_observation_id: observation.runtime_observation_id,
      binding: Object.freeze(structuredClone(binding)),
      binding_built_in_browser_process: true,
      page_text_exposed: false,
      input_values_exposed: false,
      screenshot_exposed: false,
      browser_authority: false,
      transport_delivery_is_authority: false,
      authority_effect: false,
    });
  }

  snapshot() {
    return Object.freeze({
      schema: BROWSER_EFFECT_BINDING_PREPARATION_SCHEMA,
      read_only_capture: true,
      exact_tab_required: true,
      command_expiry_rechecked: true,
      runtime_observation_registry_process_local: true,
      binding_built_in_browser_process: true,
      page_text_exposed: false,
      input_values_exposed: false,
      screenshot_exposed: false,
      browser_authority: false,
      command_leasing: false,
      effect_binding_sealing: false,
      authority_effect: false,
    });
  }
}
