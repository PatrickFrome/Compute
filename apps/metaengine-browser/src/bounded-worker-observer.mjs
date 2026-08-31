import { observeFleetTargetFromLocalBrowser } from './fleet-target-local-observer.mjs';

export const BOUNDED_WORKER_OBSERVER_VERSION = '2.0.0';

const TERMINAL_LIFECYCLE = new Set(['LOST', 'RETIRED', 'PROVISIONING_AMBIGUOUS']);

function exactBinding(agent) {
  return Object.freeze({
    agent_id: String(agent?.agent_id || '').toLowerCase(),
    lifecycle_state: String(agent?.lifecycle_state || '').toUpperCase(),
    tab_id: String(agent?.tab_id || ''),
    target_id: String(agent?.target_id || '').toLowerCase(),
    generation_epoch: Number(agent?.generation_epoch || 0),
  });
}

function bindingComplete(binding) {
  return Boolean(binding.agent_id && binding.tab_id && binding.target_id)
    && Number.isSafeInteger(binding.generation_epoch)
    && binding.generation_epoch > 0;
}

function sameBinding(a, b) {
  return String(a?.agent_id || '').toLowerCase() === String(b?.agent_id || '').toLowerCase()
    && String(a?.lifecycle_state || '').toUpperCase() === String(b?.lifecycle_state || '').toUpperCase()
    && String(a?.tab_id || '') === String(b?.tab_id || '')
    && String(a?.target_id || '').toLowerCase() === String(b?.target_id || '').toLowerCase()
    && Number(a?.generation_epoch || 0) === Number(b?.generation_epoch || 0);
}

function exactLocalTarget(binding, observation) {
  return observation?.tab_exists === true
    && String(observation?.tab_id || '') === binding.tab_id
    && String(observation?.target_id || '').toLowerCase() === binding.target_id;
}

function signal(agent, generationState, observationState) {
  return Object.freeze({
    agent_id: String(agent?.agent_id || ''),
    lifecycle_state: agent?.lifecycle_state,
    generation_state: generationState,
    observation_state: observationState,
    lease_eligible: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export class BoundedWorkerObserver {
  #budget;
  #cursor = 0;
  #cache = new Map();

  constructor({ budget = 4 } = {}) {
    this.#budget = Math.max(1, Math.min(32, Number(budget) || 4));
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.bounded-worker-observer.v2',
      budget: this.#budget,
      cursor: this.#cursor,
      cached_bindings: this.#cache.size,
      lease_eligible: false,
      scheduler_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }

  async observe(agents = [], { capture, isGenerating, observeLocalTarget } = {}) {
    if (typeof capture !== 'function' || typeof isGenerating !== 'function' || typeof observeLocalTarget !== 'function') {
      throw new Error('bounded_worker_observer_dependencies_required');
    }

    const rows = Array.isArray(agents) ? agents : [];
    const live = rows.filter((agent) => {
      const binding = exactBinding(agent);
      return !TERMINAL_LIFECYCLE.has(binding.lifecycle_state) && bindingComplete(binding);
    });

    const selected = new Set();
    if (live.length > 0) {
      const count = Math.min(this.#budget, live.length);
      const start = this.#cursor % live.length;
      for (let i = 0; i < count; i += 1) {
        selected.add(String(live[(start + i) % live.length]?.agent_id || '').toLowerCase());
      }
      this.#cursor = (start + count) % live.length;
    } else {
      this.#cursor = 0;
    }

    const signals = [];
    for (const agent of rows) {
      const binding = exactBinding(agent);
      const agentId = binding.agent_id;

      if (TERMINAL_LIFECYCLE.has(binding.lifecycle_state)) {
        this.#cache.delete(agentId);
        signals.push(signal(agent, 'TERMINAL', 'TERMINAL_NO_CAPTURE'));
        continue;
      }

      if (!bindingComplete(binding)) {
        this.#cache.delete(agentId);
        signals.push(signal(agent, 'UNKNOWN', 'UNBOUND'));
        continue;
      }

      if (selected.has(agentId)) {
        try {
          const before = observeFleetTargetFromLocalBrowser({ tab_id: binding.tab_id, observeLocalTarget });
          if (!exactLocalTarget(binding, before)) {
            this.#cache.delete(agentId);
            signals.push(signal(agent, 'UNKNOWN', 'TARGET_DRIFT_PRE_CAPTURE'));
            continue;
          }

          const frame = await capture(binding.tab_id);

          const after = observeFleetTargetFromLocalBrowser({ tab_id: binding.tab_id, observeLocalTarget });
          if (!exactLocalTarget(binding, after)) {
            this.#cache.delete(agentId);
            signals.push(signal(agent, 'UNKNOWN', 'TARGET_DRIFT_POST_CAPTURE'));
            continue;
          }

          const generationState = isGenerating(frame) ? 'GENERATING' : 'IDLE';
          this.#cache.set(agentId, Object.freeze({ ...binding, generation_state: generationState }));
          signals.push(signal(agent, generationState, 'CAPTURED_EXACT_LOCAL_TARGET'));
        } catch {
          this.#cache.delete(agentId);
          signals.push(signal(agent, 'UNKNOWN', 'OBSERVATION_FAILED'));
        }
        continue;
      }

      const cached = this.#cache.get(agentId);
      const exact = sameBinding(cached, binding);
      if (!exact && cached) this.#cache.delete(agentId);
      signals.push(signal(
        agent,
        exact ? String(cached.generation_state || 'UNKNOWN') : 'UNKNOWN',
        exact ? 'EXACT_INCARNATION_CACHE' : 'NOT_OBSERVED_THIS_CYCLE',
      ));
    }

    const activeIds = new Set(rows.map((agent) => String(agent?.agent_id || '').toLowerCase()));
    for (const agentId of this.#cache.keys()) {
      if (!activeIds.has(agentId)) this.#cache.delete(agentId);
    }

    return Object.freeze(signals);
  }
}
