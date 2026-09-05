import {
  FleetProvisioner as BaseFleetProvisioner,
  FLEET_PROFILES,
  FLEET_PROVISIONER_VERSION,
  FLEET_STATES,
} from './fleet-provisioner-core.mjs';

export { FLEET_PROFILES, FLEET_PROVISIONER_VERSION, FLEET_STATES };

const CAPACITY_AMBIGUITY_PREFIX = 'CREATE_TAB_AMBIGUOUS:tab_capacity_exceeded';

function deterministicCapacityAttempts(snapshot) {
  return (snapshot?.agents || []).filter((agent) =>
    String(agent?.lifecycle_state || '') === 'PROVISIONING_AMBIGUOUS'
    && String(agent?.ambiguous_reason || '').startsWith(CAPACITY_AMBIGUITY_PREFIX));
}

// Core-only policy adapter. Capacity exhaustion is a deterministic pre-effect result
// from TabRegistry, not permission to fan out around provisioning ambiguity. The base
// Fleet core remains the sole owner of owner-gated ambiguous compensating fanout.
export class FleetProvisioner extends BaseFleetProvisioner {
  #capacityBackpressure = false;
  #capacityRetiredAttempts = 0;

  async #retireDeterministicCapacityAttempts() {
    const rows = deterministicCapacityAttempts(super.snapshot());
    if (rows.length === 0) return false;
    for (const agent of rows) await super.retire(agent.agent_id);
    this.#capacityRetiredAttempts += rows.length;
    this.#capacityBackpressure = true;
    return true;
  }

  async init(...args) {
    this.#capacityBackpressure = false;
    this.#capacityRetiredAttempts = 0;
    await super.init(...args);
    // Legacy 1.4.1 persisted tab-capacity attempts as ambiguous although createTab
    // rejected before a physical WebContents was created. Retire only that exact
    // proven no-effect shape. Every other ambiguity remains fenced in the base core.
    await this.#retireDeterministicCapacityAttempts();
    return this.snapshot();
  }

  snapshot() {
    const out = structuredClone(super.snapshot());
    out.capacity_backpressure = {
      blocked: this.#capacityBackpressure,
      retired_no_effect_attempts: this.#capacityRetiredAttempts,
      reason: this.#capacityBackpressure ? 'TAB_CAPACITY_EXCEEDED_PRE_EFFECT' : null,
      deterministic_no_effect: true,
      automatic_retry_allowed: false,
      release_signal: 'PHYSICAL_TAB_CLOSED',
      authority_effect: false,
    };
    return Object.freeze(out);
  }

  async reconcile(args = {}) {
    if (args?.active === true && this.#capacityBackpressure) return this.snapshot();
    await super.reconcile(args);
    await this.#retireDeterministicCapacityAttempts();
    return this.snapshot();
  }

  async onTabClosed(tabId, reason = 'PHYSICAL_TAB_CLOSED') {
    await super.onTabClosed(tabId, reason);
    // A real physical close is the only local evidence that tab capacity may have
    // changed. It releases backpressure for one later normal bounded reconcile pass.
    if (this.#capacityBackpressure) this.#capacityBackpressure = false;
    return this.snapshot();
  }
}
