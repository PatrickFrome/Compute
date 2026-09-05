export const NATIVE_SUPERVISOR_COMMAND_LANES_SCHEMA = 'metaengine.native-supervisor.command-lanes.v1';

export const COMMAND_LANES = Object.freeze({
  EMERGENCY: 'EMERGENCY',
  READ_ONLY: 'READ_ONLY',
  TAB_MUTATION: 'TAB_MUTATION',
  GLOBAL_MUTATION: 'GLOBAL_MUTATION',
});

const READ_ONLY_ACTIONS = new Set([
  'POLL', 'CAPTURE', 'CAPTURE_VIEW', 'CONTROL_CAPABILITIES',
  'DEV_PLANE_STATUS', 'DEV_PLANE_HEALTH', 'DEV_PLANE_CAPABILITIES',
  'DEV_PLANE_PROCESS_METRICS', 'DEV_PLANE_REPO_HEAD',
  'DOWNLOAD_STATUS', 'SELF_UPDATE_STATUS', 'GATE_STATUS',
  'TAB_CENSUS', 'FLEET_STATUS',
  // Realtime observation reads are zero-authority and must never consume a
  // mutation slot or sit behind an unrelated global policy effect.
  'PROCESS_CENSUS', 'PROCESS_EVENTS', 'SEMANTIC_CENSUS', 'SEMANTIC_EVENTS',
  'CONTROL_LATENCY_STATUS',
]);

const TAB_MUTATION_ACTIONS = new Set([
  'STOP_GENERATION', 'SCROLL', 'SEMANTIC_FOCUS', 'SEMANTIC_TYPE',
  'RESOLVE_PROMPT', 'TYPED_CLICK', 'SELECT_TAB', 'CLOSE_TAB',
  'NAVIGATE', 'BACK', 'FORWARD', 'RELOAD',
]);

const GLOBAL_MUTATION_ACTIONS = new Set([
  'ARM', 'SET_SUPERVISOR_MODE', 'SET_MODE', 'NEW_TAB',
  'FLEET_RECONCILE', 'FLEET_SET_PROFILE',
  'DOWNLOAD_FILE', 'DOWNLOAD_CANCEL',
  'SELF_UPDATE_CHECK', 'SELF_UPDATE_APPLY',
  'GATE_DISABLE', 'GATE_DISABLE_ALL', 'GATE_ENABLE', 'GATE_ENABLE_ALL',
]);

const TAB_ID = /^tab_[0-9a-f-]{36}$/i;

function int(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function actionOf(command) {
  return String(command?.action || '').trim().toUpperCase();
}

function emergency(command) {
  const action = actionOf(command);
  if (action === 'DISARM') return true;
  if (action !== 'SET_SUPERVISOR_MODE') return false;
  return String(command?.payload?.mode || '').trim().toUpperCase() === 'OFF';
}

function explicitTabId(command) {
  const value = String(command?.payload?.tab_id || '').trim();
  return TAB_ID.test(value) ? value.toLowerCase() : null;
}

export function classifyNativeSupervisorCommand(command = {}) {
  const action = actionOf(command);
  if (!action) throw new Error('native_supervisor_command_action_required');

  if (emergency(command)) {
    return Object.freeze({
      schema: NATIVE_SUPERVISOR_COMMAND_LANES_SCHEMA,
      action,
      lane: COMMAND_LANES.EMERGENCY,
      effect_key: 'global:emergency',
      read_only: false,
      exclusive: true,
      priority: 0,
      authority_effect: false,
    });
  }

  if (READ_ONLY_ACTIONS.has(action)) {
    return Object.freeze({
      schema: NATIVE_SUPERVISOR_COMMAND_LANES_SCHEMA,
      action,
      lane: COMMAND_LANES.READ_ONLY,
      effect_key: null,
      read_only: true,
      exclusive: false,
      priority: 10,
      authority_effect: false,
    });
  }

  if (TAB_MUTATION_ACTIONS.has(action)) {
    const tabId = explicitTabId(command);
    // An implicit selected-tab target is mutable global state. It cannot safely
    // run beside another mutation because selection may change underneath it.
    return Object.freeze({
      schema: NATIVE_SUPERVISOR_COMMAND_LANES_SCHEMA,
      action,
      lane: tabId ? COMMAND_LANES.TAB_MUTATION : COMMAND_LANES.GLOBAL_MUTATION,
      effect_key: tabId ? `tab:${tabId}` : 'global:selected-tab',
      read_only: false,
      exclusive: !tabId,
      priority: tabId ? 20 : 15,
      authority_effect: false,
    });
  }

  if (GLOBAL_MUTATION_ACTIONS.has(action)) {
    return Object.freeze({
      schema: NATIVE_SUPERVISOR_COMMAND_LANES_SCHEMA,
      action,
      lane: COMMAND_LANES.GLOBAL_MUTATION,
      effect_key: 'global:control-plane',
      read_only: false,
      exclusive: true,
      priority: 15,
      authority_effect: false,
    });
  }

  // Unknown actions never get optimistic parallelism. They are forced through
  // the exclusive lane so an upstream allow-list can reject them safely.
  return Object.freeze({
    schema: NATIVE_SUPERVISOR_COMMAND_LANES_SCHEMA,
    action,
    lane: COMMAND_LANES.GLOBAL_MUTATION,
    effect_key: 'global:unknown-action',
    read_only: false,
    exclusive: true,
    priority: 15,
    authority_effect: false,
  });
}

function serializeError(error) {
  return String(error?.message || error || 'unknown_error').slice(0, 500);
}

/**
 * Bounded conflict-aware execution pump.
 *
 * READ_ONLY commands may fan out. TAB_MUTATION commands may run concurrently only
 * when they bind distinct explicit tab ids. GLOBAL/EMERGENCY mutations are an
 * exclusive barrier against every other mutation. Read-only observations may run
 * beside mutations, but never grant or carry mutation authority.
 */
export class NativeSupervisorCommandLaneScheduler {
  #readConcurrency;
  #mutationConcurrency;
  #maxBatch;

  constructor({ readConcurrency = 32, mutationConcurrency = 8, maxBatch = 64 } = {}) {
    this.#readConcurrency = int(readConcurrency, 32, 1, 128);
    this.#mutationConcurrency = int(mutationConcurrency, 8, 1, 32);
    this.#maxBatch = int(maxBatch, 64, 1, 256);
  }

  snapshot() {
    return Object.freeze({
      schema: NATIVE_SUPERVISOR_COMMAND_LANES_SCHEMA,
      read_concurrency: this.#readConcurrency,
      mutation_concurrency: this.#mutationConcurrency,
      max_batch: this.#maxBatch,
      unknown_actions_exclusive: true,
      implicit_selected_tab_exclusive: true,
      same_tab_mutations_serialized: true,
      global_mutations_exclusive: true,
      read_only_parallel: true,
      immutable_original_order_barriers: true,
      authority_effect: false,
    });
  }

  async drain(commands = [], execute) {
    if (!Array.isArray(commands)) throw new Error('native_supervisor_command_batch_invalid');
    if (commands.length > this.#maxBatch) throw new Error('native_supervisor_command_batch_too_large');
    if (typeof execute !== 'function') throw new Error('native_supervisor_command_executor_required');

    const pending = commands.map((command, index) => ({
      index,
      command,
      descriptor: classifyNativeSupervisorCommand(command),
      enqueued_ms: Date.now(),
    }));
    const results = new Array(pending.length);
    const active = new Set();
    const activeMutationKeys = new Set();
    let activeReads = 0;
    let activeMutations = 0;
    let exclusiveMutation = false;

    const launch = (item) => {
      const { descriptor } = item;
      if (descriptor.read_only) activeReads += 1;
      else {
        activeMutations += 1;
        activeMutationKeys.add(descriptor.effect_key);
        if (descriptor.exclusive) exclusiveMutation = true;
      }

      const startedMs = Date.now();
      let promise;
      promise = Promise.resolve()
        .then(() => execute(item.command, descriptor))
        .then((result) => {
          results[item.index] = Object.freeze({
            command_id: item.command?.command_id || null,
            action: descriptor.action,
            lane: descriptor.lane,
            effect_key: descriptor.effect_key,
            ok: true,
            result,
            error: null,
            queue_wait_ms: Math.max(0, startedMs - item.enqueued_ms),
            execution_ms: Math.max(0, Date.now() - startedMs),
            authority_effect: false,
          });
        }, (error) => {
          results[item.index] = Object.freeze({
            command_id: item.command?.command_id || null,
            action: descriptor.action,
            lane: descriptor.lane,
            effect_key: descriptor.effect_key,
            ok: false,
            result: null,
            error: serializeError(error),
            queue_wait_ms: Math.max(0, startedMs - item.enqueued_ms),
            execution_ms: Math.max(0, Date.now() - startedMs),
            authority_effect: false,
          });
        })
        .finally(() => {
          active.delete(promise);
          if (descriptor.read_only) activeReads -= 1;
          else {
            activeMutations -= 1;
            activeMutationKeys.delete(descriptor.effect_key);
            if (descriptor.exclusive) exclusiveMutation = false;
          }
        });
      active.add(promise);
    };

    while (pending.length > 0 || active.size > 0) {
      let launched = false;
      // Use immutable input order, never the mutable pending array position. When
      // an earlier command is removed from pending, later commands must not jump
      // across a still-pending global/emergency mutation barrier.
      const firstExclusive = pending.find((item) => !item.descriptor.read_only && item.descriptor.exclusive) || null;
      const firstExclusiveOrder = firstExclusive?.index ?? null;

      for (let i = 0; i < pending.length;) {
        const item = pending[i];
        const descriptor = item.descriptor;
        let runnable = false;

        if (descriptor.read_only) {
          runnable = activeReads < this.#readConcurrency;
        } else if (descriptor.exclusive) {
          runnable = activeMutations === 0;
        } else {
          const behindExclusiveBarrier = firstExclusiveOrder != null && item.index > firstExclusiveOrder;
          runnable = !behindExclusiveBarrier
            && !exclusiveMutation
            && activeMutations < this.#mutationConcurrency
            && !activeMutationKeys.has(descriptor.effect_key);
        }

        if (!runnable) {
          i += 1;
          continue;
        }
        pending.splice(i, 1);
        launch(item);
        launched = true;
        if (descriptor.exclusive) break;
      }

      if (!launched && active.size > 0) await Promise.race(active);
      else if (!launched && pending.length > 0) throw new Error('native_supervisor_command_scheduler_deadlock');
    }

    return Object.freeze(results);
  }
}

export const NATIVE_SUPERVISOR_COMMAND_LANE_CONTRACT = Object.freeze({
  schema: NATIVE_SUPERVISOR_COMMAND_LANES_SCHEMA,
  transport_delivery_is_authority: false,
  read_only_parallelism_allowed: true,
  distinct_tab_mutation_parallelism_allowed: true,
  same_tab_mutation_parallelism_allowed: false,
  global_mutation_parallelism_allowed: false,
  emergency_is_exclusive: true,
  unknown_action_parallelism_allowed: false,
  bounded_backpressure_required: true,
  immutable_original_order_barriers: true,
  automatic_effect_retry_allowed: false,
  authority_effect: false,
});
