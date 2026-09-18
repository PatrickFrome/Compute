export const HUMAN_TAKEOVER_SCHEMA = 'metaengine.browser.human-takeover.v1';
export const HUMAN_TAKEOVER_VERSION = '1.1.0';

function supervisorSnapshot(supervisor) {
  if (!supervisor || typeof supervisor.snapshot !== 'function') throw new Error('human_takeover_supervisor_snapshot_required');
  const value = supervisor.snapshot();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('human_takeover_supervisor_snapshot_invalid');
  return value;
}

function controlState(value) {
  return Object.freeze({
    mode: String(value?.supervisor_mode || value?.mode || 'UNKNOWN').toUpperCase(),
    armed: value?.armed === true,
    current_command: value?.current_command || null,
  });
}

function result({ state, mode, armed, reason = null, changed = false }) {
  return Object.freeze({
    schema: HUMAN_TAKEOVER_SCHEMA,
    version: HUMAN_TAKEOVER_VERSION,
    state,
    supervisor_mode: mode,
    armed,
    reason,
    changed,
    future_devos_leases_allowed: mode === 'CONTROL' && armed === true,
    retroactive_effect_cancellation: false,
    in_flight_effect_aborted: false,
    automatic_retry_allowed: false,
    automatic_resume_allowed: false,
    second_polling_loop: false,
    browser_actuation_effect: false,
    control_plane_mutation: changed === true,
    authority_effect: changed === true,
  });
}

function observedState(state) {
  if (state.mode === 'OFF') return 'DISABLED';
  if (state.mode === 'MONITOR' && state.armed === false) return 'PAUSED';
  return 'OBSERVED';
}

/**
 * User-initiated control-plane takeover. It only changes the existing Native
 * Supervisor mode/armed state; it creates no scheduler, timer or retry loop.
 * PAUSE prevents future DevOS leasing because the existing scheduler requires
 * CONTROL + armed. It never claims to cancel a physical effect already in flight.
 * OFF is fail-closed: pause never promotes OFF to MONITOR, and the keyboard
 * toggle never interprets OFF as a resumable PAUSED state.
 */
export class HumanTakeoverController {
  #getSupervisor;

  constructor({ getSupervisor } = {}) {
    if (typeof getSupervisor !== 'function') throw new Error('human_takeover_supervisor_provider_required');
    this.#getSupervisor = getSupervisor;
  }

  snapshot() {
    const state = controlState(supervisorSnapshot(this.#getSupervisor()));
    return result({
      state: observedState(state),
      mode: state.mode,
      armed: state.armed,
      reason: state.current_command ? 'COMMAND_IN_FLIGHT_NOT_CANCELLED' : null,
      changed: false,
    });
  }

  pause() {
    const supervisor = this.#getSupervisor();
    if (!supervisor || typeof supervisor.setControlState !== 'function') throw new Error('human_takeover_control_state_required');
    const before = controlState(supervisorSnapshot(supervisor));

    if (before.mode === 'OFF') {
      if (before.armed !== false) supervisor.setControlState({ armed: false });
      const after = controlState(supervisorSnapshot(supervisor));
      if (after.mode !== 'OFF' || after.armed !== false) throw new Error('human_takeover_off_pause_readback_invalid');
      return result({
        state: 'DISABLED',
        mode: after.mode,
        armed: after.armed,
        reason: after.current_command ? 'COMMAND_IN_FLIGHT_NOT_CANCELLED' : (before.armed === false ? 'ALREADY_DISABLED' : null),
        changed: before.armed !== false,
      });
    }

    if (before.mode === 'MONITOR' && before.armed === false) {
      return result({ state: 'PAUSED', mode: before.mode, armed: before.armed, reason: before.current_command ? 'COMMAND_IN_FLIGHT_NOT_CANCELLED' : 'ALREADY_PAUSED', changed: false });
    }

    supervisor.setControlState({ mode: 'MONITOR', armed: false });
    const after = controlState(supervisorSnapshot(supervisor));
    if (after.mode !== 'MONITOR' || after.armed !== false) throw new Error('human_takeover_pause_readback_invalid');
    return result({
      state: 'PAUSED',
      mode: after.mode,
      armed: after.armed,
      reason: after.current_command ? 'COMMAND_IN_FLIGHT_NOT_CANCELLED' : null,
      changed: true,
    });
  }

  resume() {
    const supervisor = this.#getSupervisor();
    if (!supervisor || typeof supervisor.setControlState !== 'function') throw new Error('human_takeover_control_state_required');
    const before = controlState(supervisorSnapshot(supervisor));
    if (before.current_command) {
      return result({
        state: 'RESUME_BLOCKED',
        mode: before.mode,
        armed: before.armed,
        reason: 'ACTIVE_COMMAND_REQUIRES_POSITIVE_COMPLETION_READBACK',
        changed: false,
      });
    }
    if (before.mode === 'CONTROL' && before.armed === true) {
      return result({ state: 'RUNNING', mode: before.mode, armed: before.armed, reason: 'ALREADY_RUNNING', changed: false });
    }

    supervisor.setControlState({ mode: 'CONTROL', armed: true });
    const after = controlState(supervisorSnapshot(supervisor));
    if (after.mode !== 'CONTROL' || after.armed !== true) throw new Error('human_takeover_resume_readback_invalid');
    return result({ state: 'RUNNING', mode: after.mode, armed: after.armed, changed: true });
  }

  execute(action) {
    const normalized = String(action || '').trim().toUpperCase();
    if (normalized === 'PAUSE') return this.pause();
    if (normalized === 'RESUME') return this.resume();
    if (normalized === 'STATUS') return this.snapshot();
    throw new Error('human_takeover_action_invalid');
  }
}
