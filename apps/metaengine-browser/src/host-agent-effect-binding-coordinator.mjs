import { nativeActionRequiresEffectBinding } from './native-effect-binding.mjs';

export const HOST_AGENT_EFFECT_BINDING_COORDINATOR_SCHEMA = 'metaengine.host-agent.effect-binding-coordinator.v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCommand(value) {
  if (!plainObject(value)) throw new Error('host_agent_effect_binding_command_invalid');
  const commandId = String(value.command_id || '').trim().toLowerCase();
  if (!UUID_RE.test(commandId)) throw new Error('host_agent_effect_binding_command_id_invalid');
  const action = String(value.action || '').trim().toUpperCase();
  if (!action) throw new Error('host_agent_effect_binding_action_required');
  const command = structuredClone(value);
  command.command_id = commandId;
  command.action = action;
  return Object.freeze(command);
}

function sameValue(left, right) {
  if (left === right) return true;
  if ((left && typeof left === 'object') || (right && typeof right === 'object')) {
    try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
  }
  return false;
}

function assertPrepared(command, value) {
  if (!plainObject(value) || !plainObject(value.binding)) throw new Error('host_agent_effect_binding_preparation_invalid');
  if (String(value.command_id || '').toLowerCase() !== command.command_id) throw new Error('host_agent_effect_binding_preparation_command_drift');
  if (String(value.action || '').toUpperCase() !== command.action) throw new Error('host_agent_effect_binding_preparation_action_drift');
  if (String(value.binding.command_id || '').toLowerCase() !== command.command_id) throw new Error('host_agent_effect_binding_preparation_binding_command_drift');
  if (String(value.binding.action || '').toUpperCase() !== command.action) throw new Error('host_agent_effect_binding_preparation_binding_action_drift');
  if (value.binding.authority_effect !== false) throw new Error('host_agent_effect_binding_preparation_authority_invalid');
  if (value.binding.page_data_authority !== false || value.binding.automatic_retry_allowed !== false) {
    throw new Error('host_agent_effect_binding_preparation_safety_flags_invalid');
  }
  if (value.binding_built_in_browser_process !== true) throw new Error('host_agent_effect_binding_preparation_process_unproven');
  return value;
}

function assertSealed(prepared, sealedReceipt) {
  if (!plainObject(sealedReceipt) || sealedReceipt.server_accepted !== true || !plainObject(sealedReceipt.effect_binding)) {
    throw new Error('host_agent_effect_binding_seal_invalid');
  }
  const sealed = sealedReceipt.effect_binding;
  for (const key of Object.keys(prepared.binding)) {
    if (!sameValue(sealed[key], prepared.binding[key])) throw new Error(`host_agent_effect_binding_seal_drift:${key}`);
  }
  if (sealed.authority_effect !== false) throw new Error('host_agent_effect_binding_seal_authority_invalid');
  if (sealed.page_data_authority !== false || sealed.automatic_retry_allowed !== false) {
    throw new Error('host_agent_effect_binding_seal_safety_flags_invalid');
  }
  return sealed;
}

export class HostAgentEffectBindingCoordinator {
  #browser;
  #transport;
  #prepared = 0;
  #sealed = 0;

  constructor({ browserExecutorClient, transport } = {}) {
    if (!browserExecutorClient || typeof browserExecutorClient.prepareEffectBinding !== 'function') {
      throw new Error('host_agent_effect_binding_browser_required');
    }
    if (!transport || typeof transport.sealEffectIntent !== 'function') throw new Error('host_agent_effect_binding_transport_required');
    this.#browser = browserExecutorClient;
    this.#transport = transport;
  }

  async prepareCommand(value) {
    const command = normalizeCommand(value);
    if (!nativeActionRequiresEffectBinding(command.action)) return structuredClone(command);
    if (command.effect_binding != null || command.effect_binding_sha256 != null) {
      throw new Error('host_agent_effect_binding_presealed_input_forbidden');
    }

    const prepared = assertPrepared(command, await this.#browser.prepareEffectBinding(command));
    this.#prepared += 1;
    const sealedReceipt = await this.#transport.sealEffectIntent(command.command_id, prepared.binding);
    const sealed = assertSealed(prepared, sealedReceipt);
    this.#sealed += 1;

    return Object.freeze({
      ...structuredClone(command),
      effect_binding: Object.freeze(structuredClone(sealed)),
      effect_binding_sha256: sealedReceipt.effect_binding_sha256 == null ? null : String(sealedReceipt.effect_binding_sha256),
      effect_binding_transport: Object.freeze({
        local_binding_built_in_browser_process: true,
        server_accepted: true,
        browser_revalidation_required_before_effect: true,
        transport_delivery_is_authority: false,
        automatic_effect_retry_allowed: false,
        authority_effect: false,
      }),
    });
  }

  snapshot() {
    return Object.freeze({
      schema: HOST_AGENT_EFFECT_BINDING_COORDINATOR_SCHEMA,
      prepared: this.#prepared,
      sealed: this.#sealed,
      local_binding_source: 'BROWSER_PROCESS_RUNTIME_OBSERVATION',
      server_sealing_required: true,
      browser_revalidation_required_before_effect: true,
      process_local_runtime_registry_not_reimplemented: true,
      command_leasing: false,
      execution_authority: false,
      timers: false,
      automatic_retry_allowed: false,
      transport_delivery_is_authority: false,
      authority_effect: false,
    });
  }
}
