import { SupervisorKeepalive } from './supervisor-keepalive.mjs';

// Bootstrap is an explicit, narrow exception to the normal conversation-bound
// wake gate. It exists only so the lifecycle runtime can persist one wake intent
// before creating the first supervisor conversation. Normal canWake() semantics
// remain unchanged outside prepareBootstrapWake().
export class SupervisorBootstrapKeepalive extends SupervisorKeepalive {
  #bootstrapPreparation = false;

  canWake() {
    if (super.canWake()) return true;
    if (!this.#bootstrapPreparation) return false;
    const state = this.snapshot();
    return state.admission_state !== 'CLOSED'
      && state.paused !== true
      && state.state === 'RECOVERING'
      && !state.conversation_url
      && !state.pending_wake
      && !state.active_wake
      && Array.isArray(state.queued_wakes)
      && state.queued_wakes.length > 0;
  }

  async prepareBootstrapWake() {
    this.#bootstrapPreparation = true;
    try {
      return await super.prepareNextWake();
    } finally {
      this.#bootstrapPreparation = false;
    }
  }
}
