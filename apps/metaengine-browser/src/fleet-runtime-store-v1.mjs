import fs from 'node:fs/promises';
import path from 'node:path';

export const FLEET_RUNTIME_STORE_VERSION = '1.1.0';

const clone = (value) => value == null ? value : structuredClone(value);
const ARRAY_KEYS = Object.freeze([
  'worker_bindings',
  'assignments',
  'readiness_proofs',
  'result_receipts',
  'wake_events',
  'process_observations',
  'memory_records',
  'learning_candidates',
  'scheduler_decisions',
]);

function nowIso(clock) {
  const value = new Date(clock());
  if (!Number.isFinite(value.getTime())) throw new Error('fleet_runtime_clock_invalid');
  return value.toISOString();
}

function freshState(clock) {
  const at = nowIso(clock);
  return {
    schema: 'metaengine.browser.fleet-runtime-state.v1',
    version: FLEET_RUNTIME_STORE_VERSION,
    worker_bindings: [],
    assignments: [],
    readiness_proofs: [],
    result_receipts: [],
    wake_events: [],
    process_observations: [],
    memory_records: [],
    learning_candidates: [],
    scheduler_decisions: [],
    supervisor: {
      emergency_state: 'PAUSE',
      keepalive_state: 'PAUSED',
      binding: null,
      wake_leases: [],
      cooldown_until: null,
      watchdog_deadline_at: null,
      updated_at: at,
    },
    updated_at: at,
  };
}

function migrateState(input, clock) {
  if (!input || input.schema !== 'metaengine.browser.fleet-runtime-state.v1') throw new Error('fleet_runtime_state_schema_invalid');
  const next = clone(input);
  for (const key of ARRAY_KEYS) if (!Array.isArray(next[key])) next[key] = [];
  if (!next.supervisor || typeof next.supervisor !== 'object' || Array.isArray(next.supervisor)) throw new Error('fleet_runtime_state_supervisor_invalid');
  if (!Array.isArray(next.supervisor.wake_leases)) next.supervisor.wake_leases = [];
  next.version = FLEET_RUNTIME_STORE_VERSION;
  next.updated_at = next.updated_at || nowIso(clock);
  next.supervisor.updated_at = next.supervisor.updated_at || next.updated_at;
  return next;
}

function validateState(state) {
  if (!state || state.schema !== 'metaengine.browser.fleet-runtime-state.v1') throw new Error('fleet_runtime_state_schema_invalid');
  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(state[key])) throw new Error(`fleet_runtime_state_${key}_invalid`);
  }
  if (!state.supervisor || typeof state.supervisor !== 'object' || Array.isArray(state.supervisor)) throw new Error('fleet_runtime_state_supervisor_invalid');
  if (!['ACTIVE','PAUSE','OFF'].includes(state.supervisor.emergency_state)) throw new Error('fleet_runtime_emergency_state_invalid');
  if (!Array.isArray(state.supervisor.wake_leases)) throw new Error('fleet_runtime_wake_leases_invalid');
  return state;
}

export class FleetRuntimeStore {
  #statePath;
  #clock;
  #state = null;
  #mutex = Promise.resolve();

  constructor({ statePath, clock = () => Date.now() } = {}) {
    if (!statePath || typeof statePath !== 'string') throw new Error('fleet_runtime_state_path_required');
    this.#statePath = statePath;
    this.#clock = clock;
  }

  async init() {
    return this.#serial(async () => {
      if (this.#state) return this.snapshot();
      try {
        const parsed = JSON.parse(await fs.readFile(this.#statePath, 'utf8'));
        this.#state = validateState(migrateState(parsed, this.#clock));
        await this.#persist();
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          if (error instanceof SyntaxError) throw new Error('fleet_runtime_state_corrupt', { cause: error });
          throw error;
        }
        this.#state = freshState(this.#clock);
        await this.#persist();
      }
      return this.snapshot();
    });
  }

  snapshot() {
    if (!this.#state) throw new Error('fleet_runtime_store_not_initialized');
    return clone(this.#state);
  }

  async transact(mutator) {
    if (typeof mutator !== 'function') throw new Error('fleet_runtime_mutator_required');
    return this.#serial(async () => {
      if (!this.#state) throw new Error('fleet_runtime_store_not_initialized');
      const draft = clone(this.#state);
      const result = await mutator(draft);
      draft.version = FLEET_RUNTIME_STORE_VERSION;
      draft.updated_at = nowIso(this.#clock);
      draft.supervisor.updated_at = draft.updated_at;
      validateState(draft);
      this.#state = draft;
      await this.#persist();
      return clone(result);
    });
  }

  async #persist() {
    const target = this.#statePath;
    const temp = `${target}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temp, `${JSON.stringify(this.#state, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temp, target);
  }

  #serial(fn) {
    const next = this.#mutex.then(fn, fn);
    this.#mutex = next.catch(() => {});
    return next;
  }
}
