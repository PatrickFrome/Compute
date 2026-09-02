import {
  DevOsNativeTaskCycle as BaseDevOsNativeTaskCycle,
  assertLiveLeaseBinding,
  normalizeLease,
  planBacklogCapacity,
  renderDevosTaskPrompt,
} from './devos-native-task-cycle-core-base.mjs';
import {
  CHATGPT_RATE_LIMIT_BACKOFF_MS,
  detectChatGptRateLimitBackpressure,
} from './fleet-submit-readiness.mjs';

export { assertLiveLeaseBinding, normalizeLease, planBacklogCapacity, renderDevosTaskPrompt };

const MAX_BACKPRESSURE_PROBES = 8;
const clip = (value, max = 200) => String(value ?? '').slice(0, max);

export class DevOsNativeTaskCycle extends BaseDevOsNativeTaskCycle {
  #getState;
  #executeCommand;
  #clock;
  #backpressureMs;
  #backpressureUntil = 0;
  #lastBackpressure = null;

  constructor(options = {}) {
    super(options);
    if (typeof options.getState !== 'function' || typeof options.executeCommand !== 'function') {
      throw new Error('devos_cycle_dependencies_invalid');
    }
    this.#getState = options.getState;
    this.#executeCommand = options.executeCommand;
    this.#clock = typeof options.clock === 'function' ? options.clock : Date.now;
    this.#backpressureMs = Math.max(10_000, Number(options.platformBackpressureMs || CHATGPT_RATE_LIMIT_BACKOFF_MS));
  }

  snapshot() {
    const base = super.snapshot();
    const now = Number(this.#clock());
    const active = this.#lastBackpressure && now < this.#backpressureUntil;
    return {
      ...base,
      platform_backpressure: this.#lastBackpressure ? {
        ...structuredClone(this.#lastBackpressure),
        active: Boolean(active),
        remaining_ms: active ? Math.max(0, this.#backpressureUntil - now) : 0,
      } : null,
      rate_limit_preflight_before_scheduler: true,
      rate_limit_denial_only: true,
      rate_limit_physical_effect_retry: false,
    };
  }

  #activateBackpressure(signal, { tabId = null, source = 'UNKNOWN' } = {}) {
    const now = Number(this.#clock());
    this.#backpressureUntil = now + Math.max(this.#backpressureMs, Number(signal?.retry_after_ms || 0));
    this.#lastBackpressure = {
      state: 'CHATGPT_RATE_LIMIT_BACKPRESSURE',
      observed_at: new Date(now).toISOString(),
      observed_tab_id: tabId ? String(tabId) : null,
      source: clip(source, 80),
      retry_after_ms: this.#backpressureUntil - now,
      scheduler_superstep_suppressed: true,
      fleet_reconcile_suppressed: true,
      new_lease_acquisition_suppressed: true,
      physical_effect_attempted: false,
      effect_barrier_crossed: false,
      observation_retry_allowed: true,
      automatic_retry_allowed: false,
      page_data_authority: false,
      authority_effect: false,
    };
    return this.#lastBackpressure;
  }

  async #probeBackpressure() {
    const state = await this.#getState();
    const stateSignal = detectChatGptRateLimitBackpressure(state?.perception);
    if (stateSignal) {
      this.#activateBackpressure(stateSignal, {
        tabId: state?.perception?.tab_id || state?.active_tab?.tab_id || null,
        source: 'SELECTED_PERCEPTION_DENIAL_ONLY',
      });
      return true;
    }

    const agents = (state?.fleet?.agents || [])
      .filter((row) => String(row?.lifecycle_state || '') === 'ACTIVE' && row?.tab_id)
      .slice(0, MAX_BACKPRESSURE_PROBES);
    for (const agent of agents) {
      let frame = null;
      try {
        frame = await this.#executeCommand({
          action: 'CAPTURE',
          platform: 'CHATGPT',
          payload: { tab_id: String(agent.tab_id) },
        });
      } catch {
        continue;
      }
      const signal = detectChatGptRateLimitBackpressure(frame);
      if (signal) {
        this.#activateBackpressure(signal, {
          tabId: agent.tab_id,
          source: 'ACTIVE_FLEET_CAPTURE_DENIAL_ONLY',
        });
        return true;
      }
    }
    return false;
  }

  async cycle() {
    const now = Number(this.#clock());
    if (this.#lastBackpressure && now < this.#backpressureUntil) return this.snapshot();

    if (await this.#probeBackpressure()) return this.snapshot();

    if (this.#lastBackpressure) {
      this.#lastBackpressure = {
        ...this.#lastBackpressure,
        state: 'CLEARED_BY_FRESH_OBSERVATION',
        cleared_at: new Date(Number(this.#clock())).toISOString(),
        scheduler_superstep_suppressed: false,
        fleet_reconcile_suppressed: false,
        new_lease_acquisition_suppressed: false,
        physical_effect_attempted: false,
        effect_barrier_crossed: false,
        observation_retry_allowed: false,
        automatic_retry_allowed: false,
        authority_effect: false,
      };
      this.#backpressureUntil = 0;
    }

    await super.cycle();
    return this.snapshot();
  }
}
