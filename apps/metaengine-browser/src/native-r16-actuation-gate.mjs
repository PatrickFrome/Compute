import { executeSemanticCommand } from './native-browser-control.mjs';

const ACTUATION_ACTIONS = new Set([
  'SCROLL',
  'STOP_GENERATION',
  'SEMANTIC_FOCUS',
  'TYPED_CLICK',
  'SEMANTIC_TYPE',
]);

const TERMINAL_EFFECT_TYPES = new Set(['EFFECT_OBSERVED', 'RECEIPT_EMITTED', 'RECOVERY_REQUIRED']);
const clean = (value) => String(value ?? '').trim();
const clipError = (error) => String(error?.message || error || 'unknown_error').slice(0, 500);

function requireId(value, code) {
  const text = clean(value);
  if (!text || text.length > 256 || /[\u0000-\u001f\u007f]/.test(text)) throw new Error(code);
  return text;
}

function normalizeCommand(command = {}) {
  const action = clean(command.action).toUpperCase();
  if (!ACTUATION_ACTIONS.has(action)) throw new Error('native_r16_action_not_actuation');
  return Object.freeze({
    ...command,
    action,
    command_id: requireId(command.command_id, 'native_r16_command_id_required'),
    action_id: requireId(command.action_id, 'native_r16_action_id_required'),
    lease_id: requireId(command.lease_id, 'native_r16_command_lease_id_required'),
    holder_id: requireId(command.holder_id, 'native_r16_command_holder_id_required'),
    resource_id: requireId(command.resource_id, 'native_r16_resource_id_required'),
    browser_node_id: requireId(command.browser_node_id, 'native_r16_browser_node_id_required'),
    process_incarnation_id: requireId(command.process_incarnation_id, 'native_r16_process_incarnation_id_required'),
    profile_id: requireId(command.profile_id, 'native_r16_profile_id_required'),
    target_id: requireId(command.target_id, 'native_r16_target_id_required'),
  });
}

function validateLease(command, lease, holderId, nowMs) {
  if (!lease || typeof lease !== 'object' || Array.isArray(lease)) throw new Error('native_r16_lease_required');
  const normalized = {
    lease_id: requireId(lease.lease_id, 'native_r16_lease_id_required'),
    holder_id: requireId(lease.holder_id, 'native_r16_lease_holder_required'),
    resource_id: requireId(lease.resource_id, 'native_r16_lease_resource_required'),
    action_id: requireId(lease.action_id, 'native_r16_lease_action_required'),
    browser_node_id: requireId(lease.browser_node_id, 'native_r16_lease_browser_node_required'),
    process_incarnation_id: requireId(lease.process_incarnation_id, 'native_r16_lease_process_incarnation_required'),
    profile_id: requireId(lease.profile_id, 'native_r16_lease_profile_required'),
    target_id: requireId(lease.target_id, 'native_r16_lease_target_required'),
    scope: clean(lease.scope).toUpperCase(),
    state: clean(lease.state).toUpperCase(),
    single_use: lease.single_use === true,
    expires_at: clean(lease.expires_at),
  };
  if (normalized.scope !== 'ACTUATE') throw new Error('native_r16_lease_scope_invalid');
  if (normalized.state !== 'ACTIVE') throw new Error('native_r16_lease_not_active');
  if (!normalized.single_use) throw new Error('native_r16_lease_must_be_single_use');
  const expiresMs = Date.parse(normalized.expires_at);
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) throw new Error('native_r16_lease_expired');
  const exact = [
    ['lease_id', command.lease_id],
    ['holder_id', command.holder_id],
    ['resource_id', command.resource_id],
    ['action_id', command.action_id],
    ['browser_node_id', command.browser_node_id],
    ['process_incarnation_id', command.process_incarnation_id],
    ['profile_id', command.profile_id],
    ['target_id', command.target_id],
  ];
  for (const [field, expected] of exact) {
    if (normalized[field] !== expected) throw new Error(`native_r16_lease_${field}_binding_mismatch`);
  }
  if (normalized.holder_id !== holderId) throw new Error('native_r16_lease_wrong_holder');
  return Object.freeze(normalized);
}

function identityFor(command) {
  return {
    command_id: command.command_id,
    lease_id: command.lease_id,
    action_id: command.action_id,
    browser_node_id: command.browser_node_id,
    process_incarnation_id: command.process_incarnation_id,
    profile_id: command.profile_id,
    target_id: command.target_id,
  };
}

export class NativeR16ActuationGate {
  #ledger;
  #holderId;
  #executeImpl;
  #now;
  #inFlight = new Set();

  constructor({ ledger, holderId, executeImpl = executeSemanticCommand, now = () => Date.now() } = {}) {
    if (!ledger || typeof ledger.append !== 'function' || typeof ledger.timeline !== 'function') throw new Error('native_r16_ledger_required');
    this.#holderId = requireId(holderId, 'native_r16_holder_id_required');
    if (typeof executeImpl !== 'function') throw new Error('native_r16_execute_impl_required');
    if (typeof now !== 'function') throw new Error('native_r16_clock_required');
    this.#ledger = ledger;
    this.#executeImpl = executeImpl;
    this.#now = now;
  }

  async execute(webContents, rawCommand, rawLease) {
    const command = normalizeCommand(rawCommand);
    const lease = validateLease(command, rawLease, this.#holderId, Number(this.#now()));
    if (this.#inFlight.has(command.resource_id)) throw new Error('native_r16_resource_actuation_in_flight');
    this.#inFlight.add(command.resource_id);
    let intentSealed = false;
    try {
      const prior = await this.#ledger.timeline({ actionId: command.action_id });
      if (prior.entries.some((entry) => TERMINAL_EFFECT_TYPES.has(entry.type))) throw new Error('native_r16_action_already_consumed_or_ambiguous');
      if (prior.entries.some((entry) => entry.type === 'INTENT_SEALED')) throw new Error('native_r16_action_intent_already_sealed');

      const identity = identityFor(command);
      await this.#ledger.append({
        type: 'INTENT_SEALED',
        identity,
        payload: {
          action: command.action,
          resource_id: command.resource_id,
          lease_expires_at: lease.expires_at,
          no_blind_retry: true,
          page_data_authority: false,
        },
      });
      intentSealed = true;
      await this.#ledger.append({
        type: 'AUTHORITY_GRANTED',
        identity,
        payload: {
          source: 'EXTERNAL_SINGLE_USE_LEASE',
          holder_id: lease.holder_id,
          resource_id: lease.resource_id,
          scope: lease.scope,
          state: lease.state,
          single_use: true,
        },
      });

      const effect = await this.#executeImpl(webContents, command);
      await this.#ledger.append({
        type: 'EFFECT_OBSERVED',
        identity,
        payload: {
          action: command.action,
          executor_authority_effect: effect?.authority_effect === true,
        },
      });
      const receipt = await this.#ledger.append({
        type: 'RECEIPT_EMITTED',
        identity,
        payload: {
          action: command.action,
          authority_effect: false,
          status: 'COMPLETED',
        },
      });
      return {
        ...effect,
        r16_gate: 'ONE_RESOURCE_ONE_ACTUATION_LEASE',
        action_id: command.action_id,
        lease_id: command.lease_id,
        receipt_entry_sha256: receipt.entry_sha256,
      };
    } catch (error) {
      if (intentSealed) {
        await this.#ledger.append({
          type: 'RECOVERY_REQUIRED',
          identity: identityFor(command),
          payload: {
            action: command.action,
            error: clipError(error),
            no_blind_retry: true,
            authority_effect: false,
          },
        }).catch(() => {});
      }
      throw error;
    } finally {
      this.#inFlight.delete(command.resource_id);
    }
  }
}

export function createR16NativeSupervisorExecutor({ gate, resolveWebContents } = {}) {
  if (!gate || typeof gate.execute !== 'function') throw new Error('native_r16_gate_required');
  if (typeof resolveWebContents !== 'function') throw new Error('native_r16_webcontents_resolver_required');
  return async function executeSupervisorCommand(command) {
    const action = clean(command?.action).toUpperCase();
    if (!ACTUATION_ACTIONS.has(action)) throw new Error('native_r16_supervisor_action_not_actuation');
    const webContents = await resolveWebContents(command.target_id, command);
    if (!webContents) throw new Error('native_r16_target_webcontents_unavailable');
    return gate.execute(webContents, command, command.lease);
  };
}

export const NATIVE_R16_ACTUATION_ACTIONS = Object.freeze([...ACTUATION_ACTIONS]);
