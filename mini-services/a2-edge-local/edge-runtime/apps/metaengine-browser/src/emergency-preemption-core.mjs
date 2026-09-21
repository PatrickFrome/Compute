export const EMERGENCY_PREEMPTION_SCHEMA = 'metaengine.browser.emergency-preemption.v1';
export const MAX_PREEMPTION_RECEIPTS = 64;

const COMMAND_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPreemptiveEmergencyCommand(command) {
  const action = String(command?.action || '').trim().toUpperCase();
  if (action === 'DISARM') return true;
  if (action === 'SET_SUPERVISOR_MODE') {
    return String(command?.payload?.mode || '').trim().toUpperCase() === 'OFF';
  }
  return false;
}

export class EmergencyPreemptionCore {
  #applyLocalAuthority;
  #active = null;
  #receipts = new Map();

  constructor({ applyLocalAuthority } = {}) {
    if (typeof applyLocalAuthority !== 'function') throw new Error('emergency_preemption_authority_applier_required');
    this.#applyLocalAuthority = applyLocalAuthority;
  }

  bindActiveOperation({ operation_id, abort_controller } = {}) {
    const id = String(operation_id || '').trim();
    if (!id) throw new Error('emergency_preemption_operation_id_required');
    if (!abort_controller || typeof abort_controller.abort !== 'function' || !abort_controller.signal) {
      throw new Error('emergency_preemption_abort_controller_required');
    }
    if (this.#active && this.#active.operation_id !== id) throw new Error('emergency_preemption_active_operation_exists');
    this.#active = Object.freeze({ operation_id: id, abort_controller });
    return Object.freeze({ operation_id: id, bound: true, authority_effect: false });
  }

  clearActiveOperation(operation_id) {
    const id = String(operation_id || '').trim();
    if (!this.#active || this.#active.operation_id !== id) return false;
    this.#active = null;
    return true;
  }

  snapshot() {
    return Object.freeze({
      schema: EMERGENCY_PREEMPTION_SCHEMA,
      active_operation_id: this.#active?.operation_id || null,
      retained_receipts: this.#receipts.size,
      max_retained_receipts: MAX_PREEMPTION_RECEIPTS,
      second_scheduler: false,
      command_leasing: false,
      automatic_effect_retry_allowed: false,
      authority_effect: false,
    });
  }

  async preemptLeasedCommand(command) {
    if (!isPreemptiveEmergencyCommand(command)) throw new Error('emergency_preemption_command_not_allowed');
    const commandId = String(command?.command_id || '').trim().toLowerCase();
    if (!COMMAND_ID_RE.test(commandId)) throw new Error('emergency_preemption_command_id_required');

    const prior = this.#receipts.get(commandId);
    if (prior) return prior;

    // This boundary assumes the caller already owns the durable DB lease. It cannot
    // lease commands itself. Close local mutation authority first; only after that
    // signal cancellation to a bounded in-flight operation. Abort is advisory about
    // the in-flight effect and never proves that an external side effect was undone.
    const authorityResult = await this.#applyLocalAuthority(command);
    if (!authorityResult || authorityResult.confirmed !== true) {
      throw new Error('emergency_preemption_authority_transition_unconfirmed');
    }

    const active = this.#active;
    let abortSignalled = false;
    if (active && active.abort_controller.signal.aborted !== true) {
      active.abort_controller.abort('METAENGINE_EMERGENCY_PREEMPTION');
      abortSignalled = true;
    }

    const receipt = Object.freeze({
      schema: EMERGENCY_PREEMPTION_SCHEMA,
      command_id: commandId,
      action: String(command.action).trim().toUpperCase(),
      local_authority_closed: true,
      active_operation_id: active?.operation_id || null,
      abort_signalled: abortSignalled,
      in_flight_effect_cancelled: false,
      in_flight_effect_requires_independent_readback: Boolean(active),
      command_leasing: false,
      second_scheduler: false,
      automatic_effect_retry_allowed: false,
      authority_effect: true,
    });
    this.#receipts.set(commandId, receipt);
    while (this.#receipts.size > MAX_PREEMPTION_RECEIPTS) {
      this.#receipts.delete(this.#receipts.keys().next().value);
    }
    return receipt;
  }
}
