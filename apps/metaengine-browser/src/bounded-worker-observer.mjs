const TERMINAL_LIFECYCLE = new Set(['LOST', 'RETIRED', 'PROVISIONING_AMBIGUOUS']);

function exactBinding(agent) {
  return {
    tab_id: String(agent?.tab_id || ''),
    generation_epoch: Number(agent?.generation_epoch || 0),
  };
}

function sameBinding(a, b) {
  return String(a?.tab_id || '') === String(b?.tab_id || '')
    && Number(a?.generation_epoch || 0) === Number(b?.generation_epoch || 0);
}

export class BoundedWorkerObserver {
  #budget;
  #cursor = 0;
  #cache = new Map();

  constructor({ budget = 4 } = {}) {
    this.#budget = Math.max(1, Math.min(32, Number(budget) || 4));
  }

  snapshot() {
    return {
      schema: 'metaengine.bounded-worker-observer.v1',
      budget: this.#budget,
      cursor: this.#cursor,
      cached_bindings: this.#cache.size,
      authority_effect: false,
    };
  }

  async observe(agents = [], { capture, isGenerating } = {}) {
    if (typeof capture !== 'function' || typeof isGenerating !== 'function') {
      throw new Error('bounded_worker_observer_dependencies_required');
    }

    const rows = Array.isArray(agents) ? agents : [];
    const live = rows.filter((agent) => {
      const lifecycle = String(agent?.lifecycle_state || '').toUpperCase();
      return !TERMINAL_LIFECYCLE.has(lifecycle) && Boolean(agent?.tab_id);
    });

    const selected = new Set();
    if (live.length > 0) {
      const count = Math.min(this.#budget, live.length);
      const start = this.#cursor % live.length;
      for (let i = 0; i < count; i += 1) {
        selected.add(String(live[(start + i) % live.length]?.agent_id || ''));
      }
      this.#cursor = (start + count) % live.length;
    } else {
      this.#cursor = 0;
    }

    const signals = [];
    for (const agent of rows) {
      const agentId = String(agent?.agent_id || '');
      const lifecycle = String(agent?.lifecycle_state || '').toUpperCase();
      const binding = exactBinding(agent);

      if (TERMINAL_LIFECYCLE.has(lifecycle)) {
        this.#cache.delete(agentId);
        signals.push({
          agent_id: agentId,
          lifecycle_state: agent?.lifecycle_state,
          generation_state: 'TERMINAL',
          observation_state: 'TERMINAL_NO_CAPTURE',
        });
        continue;
      }

      if (!agent?.tab_id) {
        this.#cache.delete(agentId);
        signals.push({
          agent_id: agentId,
          lifecycle_state: agent?.lifecycle_state,
          generation_state: 'UNKNOWN',
          observation_state: 'UNBOUND',
        });
        continue;
      }

      if (selected.has(agentId)) {
        let generationState = 'UNKNOWN';
        try {
          generationState = isGenerating(await capture(agent.tab_id)) ? 'GENERATING' : 'IDLE';
          this.#cache.set(agentId, { ...binding, generation_state: generationState });
        } catch {
          this.#cache.delete(agentId);
        }
        signals.push({
          agent_id: agentId,
          lifecycle_state: agent?.lifecycle_state,
          generation_state: generationState,
          observation_state: generationState === 'UNKNOWN' ? 'CAPTURE_FAILED' : 'CAPTURED',
        });
        continue;
      }

      const cached = this.#cache.get(agentId);
      const exact = sameBinding(cached, binding);
      signals.push({
        agent_id: agentId,
        lifecycle_state: agent?.lifecycle_state,
        generation_state: exact ? String(cached.generation_state || 'UNKNOWN') : 'UNKNOWN',
        observation_state: exact ? 'EXACT_BINDING_CACHE' : 'NOT_OBSERVED_THIS_CYCLE',
      });
    }

    const activeIds = new Set(rows.map((agent) => String(agent?.agent_id || '')));
    for (const agentId of this.#cache.keys()) {
      if (!activeIds.has(agentId)) this.#cache.delete(agentId);
    }

    return signals;
  }
}
