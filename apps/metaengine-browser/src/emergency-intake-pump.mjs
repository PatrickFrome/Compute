import { isPreemptiveEmergencyCommand } from './emergency-preemption-core.mjs';

export const EMERGENCY_INTAKE_SCHEMA = 'metaengine.browser.emergency-intake.v1';

function envelope(state, extra = {}) {
  return Object.freeze({
    schema: EMERGENCY_INTAKE_SCHEMA,
    state,
    general_scheduler_dependency: false,
    second_general_scheduler: false,
    command_leasing_authority: false,
    transport_delivery_is_authority: false,
    automatic_effect_retry_allowed: false,
    authority_effect: false,
    ...extra,
  });
}

/**
 * One bounded emergency intake iteration. The injected `nextEmergency` endpoint is
 * the only component allowed to obtain a DB-leased emergency command. This class
 * cannot issue or lease commands and cannot execute normal Browser actions.
 *
 * Result upload is deliberately separate from preemption. If durable completion
 * fails after local OFF/disarm, the caller may replay the SAME receipt against the
 * SAME leased command. The local preemption core de-duplicates by command_id, so
 * the physical authority transition is never blindly repeated.
 */
export class EmergencyIntakePump {
  #nextEmergency;
  #preemption;
  #completeEmergency;
  #last = envelope('IDLE');

  constructor({ nextEmergency, preemption, completeEmergency } = {}) {
    if (typeof nextEmergency !== 'function') throw new Error('emergency_intake_next_required');
    if (!preemption || typeof preemption.preemptLeasedCommand !== 'function') throw new Error('emergency_intake_preemption_required');
    if (typeof completeEmergency !== 'function') throw new Error('emergency_intake_completion_required');
    this.#nextEmergency = nextEmergency;
    this.#preemption = preemption;
    this.#completeEmergency = completeEmergency;
  }

  snapshot() { return this.#last; }

  async cycle() {
    const leased = await this.#nextEmergency();
    const count = Number(leased?.leased_count || 0);
    const command = leased?.command && typeof leased.command === 'object' ? structuredClone(leased.command) : null;
    if (count === 0 || !command) {
      this.#last = envelope('IDLE', { wake_reason: String(leased?.wake_reason || 'NONE').slice(0, 80) });
      return this.#last;
    }
    if (count !== 1) throw new Error('emergency_intake_lease_cardinality_invalid');
    if (!isPreemptiveEmergencyCommand(command)) throw new Error('emergency_intake_non_emergency_rejected');
    if (String(command.command_lane || '').toUpperCase() !== 'EMERGENCY') throw new Error('emergency_intake_lane_invalid');

    const receipt = await this.#preemption.preemptLeasedCommand(command);
    try {
      const completion = await this.#completeEmergency(command, receipt);
      if (!completion || completion.confirmed !== true) {
        this.#last = envelope('RESULT_PENDING', {
          command_id: String(command.command_id || ''),
          command,
          receipt,
          completion_confirmed: false,
        });
        return this.#last;
      }
      this.#last = envelope('COMPLETED', {
        command_id: String(command.command_id || ''),
        command,
        receipt,
        completion_confirmed: true,
      });
      return this.#last;
    } catch (error) {
      this.#last = envelope('RESULT_PENDING', {
        command_id: String(command.command_id || ''),
        command,
        receipt,
        completion_confirmed: false,
        completion_error: String(error?.message || error || 'UNKNOWN').slice(0, 200),
      });
      return this.#last;
    }
  }

  async retryCompletion() {
    if (this.#last.state !== 'RESULT_PENDING' || !this.#last.receipt || !this.#last.command) {
      return envelope('NO_PENDING_RESULT');
    }
    const command = structuredClone(this.#last.command);
    const completion = await this.#completeEmergency(command, this.#last.receipt);
    if (!completion || completion.confirmed !== true) return this.#last;
    this.#last = envelope('COMPLETED', {
      command_id: this.#last.command_id,
      command,
      receipt: this.#last.receipt,
      completion_confirmed: true,
      result_replayed_without_effect_retry: true,
    });
    return this.#last;
  }
}
