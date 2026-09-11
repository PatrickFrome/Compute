export const NATIVE_SUPERVISOR_COMMAND_LANES_SCHEMA = 'metaengine.native-supervisor.command-lanes.v3';
export const NATIVE_SUPERVISOR_COMMAND_PRESSURE_BUDGET_SCHEMA = 'metaengine.native-supervisor.command-pressure-budget.v1';

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
  'PROCESS_CENSUS', 'PROCESS_EVENTS', 'SEMANTIC_CENSUS', 'SEMANTIC_EVENTS',
  'CONTROL_LATENCY_STATUS',
]);

const TAB_MUTATION_ACTIONS = new Set([
  'STOP_GENERATION', 'SCROLL', 'SEMANTIC_FOCUS', 'SEMANTIC_TYPE',
  'RESOLVE_PROMPT', 'TYPED_CLICK', 'SELECT_TAB', 'CLOSE_TAB',
  'NAVIGATE', 'BACK', 'FORWARD', 'RELOAD',
]);

const EFFECT_BOUND_TAB_ACTIONS = new Set([
  'STOP_GENERATION', 'SCROLL', 'SEMANTIC_FOCUS', 'SEMANTIC_TYPE', 'TYPED_CLICK',
]);

const GLOBAL_MUTATION_ACTIONS = new Set([
  'ARM', 'SET_SUPERVISOR_MODE', 'SET_MODE', 'NEW_TAB',
  'FLEET_RECONCILE', 'FLEET_SET_PROFILE',
  'DOWNLOAD_FILE', 'DOWNLOAD_CANCEL',
  'SELF_UPDATE_CHECK', 'SELF_UPDATE_APPLY',
  'GATE_DISABLE', 'GATE_DISABLE_ALL', 'GATE_ENABLE', 'GATE_ENABLE_ALL',
]);

const TAB_ID = /^tab_[0-9a-f-]{36}$/i;
let processPressureBudget = null;
let processPressureBudgetRevision = 0;

function int(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function actionOf(command) {
  return String(command?.action || '').trim().toUpperCase();
}

export function nativeActionRequiresExactTabTarget(action) {
  return TAB_MUTATION_ACTIONS.has(String(action || '').trim().toUpperCase());
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

function tabCausalKey(command) {
  const tabId = explicitTabId(command);
  return tabId ? `tab:${tabId}` : null;
}

export function applyNativeSupervisorCommandPressureBudget({
  read_concurrency,
  mutation_concurrency,
  pressure_band = 'UNKNOWN',
  live_cells = null,
} = {}) {
  const readConcurrency = int(read_concurrency, 0, 1, 128);
  const mutationConcurrency = int(mutation_concurrency, 0, 1, 32);
  if (readConcurrency < 1 || mutationConcurrency < 1) {
    throw new Error('native_supervisor_command_pressure_budget_invalid');
  }
  processPressureBudgetRevision += 1;
  processPressureBudget = Object.freeze({
    schema: NATIVE_SUPERVISOR_COMMAND_PRESSURE_BUDGET_SCHEMA,
    revision: processPressureBudgetRevision,
    pressure_band: String(pressure_band || 'UNKNOWN').slice(0, 32),
    read_concurrency: readConcurrency,
    mutation_concurrency: mutationConcurrency,
    live_cells: Number.isSafeInteger(Number(live_cells)) ? Math.max(1, Math.min(512, Number(live_cells))) : null,
    applied_at: new Date().toISOString(),
    process_local: true,
    contains_commands: false,
    contains_leases: false,
    scheduler_authority: false,
    execution_authority: false,
    authority_effect: false,
  });
  return processPressureBudget;
}

export function clearNativeSupervisorCommandPressureBudget() {
  if (processPressureBudget == null) return false;
  processPressureBudget = null;
  processPressureBudgetRevision += 1;
  return true;
}

export function nativeSupervisorCommandPressureBudgetSnapshot() {
  return processPressureBudget
    ? Object.freeze({ ...processPressureBudget })
    : Object.freeze({
        schema: NATIVE_SUPERVISOR_COMMAND_PRESSURE_BUDGET_SCHEMA,
        revision: processPressureBudgetRevision,
        pressure_band: null,
        read_concurrency: null,
        mutation_concurrency: null,
        live_cells: null,
        applied_at: null,
        process_local: true,
        contains_commands: false,
        contains_leases: false,
        scheduler_authority: false,
        execution_authority: false,
        authority_effect: false,
      });
}

function effectiveConcurrency(configuredRead, configuredMutation) {
  const pressure = processPressureBudget;
  return Object.freeze({
    read_concurrency: pressure?.read_concurrency ?? configuredRead,
    mutation_concurrency: pressure?.mutation_concurrency ?? configuredMutation,
    pressure_budget_revision: pressure?.revision ?? processPressureBudgetRevision,
    pressure_band: pressure?.pressure_band ?? null,
    pressure_budget_bound: pressure != null,
  });
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
      causal_key: null,
      read_only: false,
      exclusive: true,
      priority: 0,
      authority_effect: false,
    });
  }

  if (READ_ONLY_ACTIONS.has(action)) {
    const causalKey = tabCausalKey(command);
    return Object.freeze({
      schema: NATIVE_SUPERVISOR_COMMAND_LANES_SCHEMA,
      action,
      lane: COMMAND_LANES.READ_ONLY,
      effect_key: null,
      causal_key: causalKey,
      read_only: true,
      exclusive: false,
      priority: 10,
      authority_effect: false,
    });
  }

  if (TAB_MUTATION_ACTIONS.has(action)) {
    const tabId = explicitTabId(command);
    const key = tabId ? `tab:${tabId}` : 'global:selected-tab';
    return Object.freeze({
      schema: NATIVE_SUPERVISOR_COMMAND_LANES_SCHEMA,
      action,
      lane: tabId ? COMMAND_LANES.TAB_MUTATION : COMMAND_LANES.GLOBAL_MUTATION,
      effect_key: key,
      causal_key: tabId ? key : null,
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
      causal_key: null,
      read_only: false,
      exclusive: true,
      priority: 15,
      authority_effect: false,
    });
  }

  return Object.freeze({
    schema: NATIVE_SUPERVISOR_COMMAND_LANES_SCHEMA,
    action,
    lane: COMMAND_LANES.GLOBAL_MUTATION,
    effect_key: 'global:unknown-action',
    causal_key: null,
    read_only: false,
    exclusive: true,
    priority: 15,
    authority_effect: false,
  });
}

function schedulerDescriptor(command) {
  const descriptor = classifyNativeSupervisorCommand(command);
  if (!TAB_MUTATION_ACTIONS.has(descriptor.action) || explicitTabId(command)) return descriptor;
  const schedulerRejectionError = EFFECT_BOUND_TAB_ACTIONS.has(descriptor.action)
    ? `native_supervisor_effect_binding_explicit_tab_required:${descriptor.action}`
    : null;
  return Object.freeze({
    ...descriptor,
    lane: COMMAND_LANES.TAB_MUTATION,
    effect_key: 'fenced:missing-exact-tab',
    causal_key: null,
    exclusive: false,
    priority: 20,
    scheduler_target_fenced: true,
    scheduler_rejection_error: schedulerRejectionError,
    authority_effect: false,
  });
}

function serializeError(error) {
  return String(error?.message || error || 'unknown_error').slice(0, 500);
}

function increment(map, key) {
  if (!key) return 0;
  const next = Number(map.get(key) || 0) + 1;
  map.set(key, next);
  return next;
}

function buildPending(commands) {
  const seenReadsByKey = new Map();
  const seenMutationsByKey = new Map();
  return commands.map((command, index) => {
    const descriptor = schedulerDescriptor(command);
    const key = descriptor.causal_key;
    const priorReadCount = key ? Number(seenReadsByKey.get(key) || 0) : 0;
    const priorMutationCount = key ? Number(seenMutationsByKey.get(key) || 0) : 0;
    if (key) {
      if (descriptor.read_only) increment(seenReadsByKey, key);
      else increment(seenMutationsByKey, key);
    }
    return {
      index,
      command,
      descriptor,
      prior_read_count: priorReadCount,
      prior_mutation_count: priorMutationCount,
      enqueued_ms: Date.now(),
    };
  });
}

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
    const effective = effectiveConcurrency(this.#readConcurrency, this.#mutationConcurrency);
    return Object.freeze({
      schema: NATIVE_SUPERVISOR_COMMAND_LANES_SCHEMA,
      read_concurrency: effective.read_concurrency,
      mutation_concurrency: effective.mutation_concurrency,
      configured_read_concurrency: this.#readConcurrency,
      configured_mutation_concurrency: this.#mutationConcurrency,
      pressure_budget_bound: effective.pressure_budget_bound,
      pressure_budget_revision: effective.pressure_budget_revision,
      pressure_band: effective.pressure_band,
      max_batch: this.#maxBatch,
      unknown_actions_exclusive: true,
      implicit_selected_tab_exclusive: true,
      implicit_selected_tab_scheduler_admission: 'FENCED_NONEXCLUSIVE',
      exact_tab_mutation_execution_required: true,
      missing_effect_tab_fails_before_executor: true,
      same_tab_mutations_serialized: true,
      same_tab_read_after_write_causal: true,
      same_tab_write_after_read_causal: true,
      cross_tab_reads_parallel: true,
      global_mutations_exclusive: true,
      read_only_parallel: true,
      immutable_original_order_barriers: true,
      causal_dependency_precompute: 'O(n)',
      causal_pending_lookup: 'O(1)',
      repeated_pending_causal_scan: false,
      pending_scan_bounded_by_max_batch: true,
      live_concurrency_tuning: true,
      process_pressure_budget_register: true,
      pressure_register_contains_commands: false,
      live_concurrency_tuning_changes_authority: false,
      authority_effect: false,
    });
  }

  setConcurrencyBudget({ read_concurrency, mutation_concurrency } = {}) {
    this.#readConcurrency = int(read_concurrency, this.#readConcurrency, 1, 128);
    this.#mutationConcurrency = int(mutation_concurrency, this.#mutationConcurrency, 1, 32);
    return this.snapshot();
  }

  async drain(commands = [], execute) {
    if (!Array.isArray(commands)) throw new Error('native_supervisor_command_batch_invalid');
    if (commands.length > this.#maxBatch) throw new Error('native_supervisor_command_batch_too_large');
    if (typeof execute !== 'function') throw new Error('native_supervisor_command_executor_required');

    const pending = buildPending(commands);
    const results = new Array(pending.length);
    const active = new Set();
    const activeMutationKeys = new Set();
    const activeReadKeys = new Map();
    const launchedReadsByKey = new Map();
    const launchedMutationsByKey = new Map();
    let activeReads = 0;
    let activeMutations = 0;
    let exclusiveMutation = false;

    const incrementReadKey = (key) => {
      if (!key) return;
      activeReadKeys.set(key, Number(activeReadKeys.get(key) || 0) + 1);
    };
    const decrementReadKey = (key) => {
      if (!key) return;
      const next = Number(activeReadKeys.get(key) || 0) - 1;
      if (next > 0) activeReadKeys.set(key, next);
      else activeReadKeys.delete(key);
    };
    const hasEarlierPendingMutationForRead = (item) => {
      const key = item.descriptor.causal_key;
      if (!key) return false;
      return item.prior_mutation_count > Number(launchedMutationsByKey.get(key) || 0);
    };
    const hasEarlierPendingReadForMutation = (item) => {
      const key = item.descriptor.causal_key;
      if (!key) return false;
      return item.prior_read_count > Number(launchedReadsByKey.get(key) || 0);
    };

    const launch = (item) => {
      const { descriptor } = item;
      const startedMs = Date.now();
      if (descriptor.scheduler_rejection_error) {
        results[item.index] = Object.freeze({
          command_id: item.command?.command_id || null,
          action: descriptor.action,
          lane: descriptor.lane,
          effect_key: descriptor.effect_key,
          causal_key: descriptor.causal_key,
          ok: false,
          result: null,
          error: descriptor.scheduler_rejection_error,
          queue_wait_ms: Math.max(0, startedMs - item.enqueued_ms),
          execution_ms: 0,
          scheduler_rejected: true,
          authority_effect: false,
        });
        return;
      }
      if (descriptor.read_only) {
        activeReads += 1;
        incrementReadKey(descriptor.causal_key);
        increment(launchedReadsByKey, descriptor.causal_key);
      } else {
        activeMutations += 1;
        activeMutationKeys.add(descriptor.effect_key);
        increment(launchedMutationsByKey, descriptor.causal_key);
        if (descriptor.exclusive) exclusiveMutation = true;
      }

      let promise;
      promise = Promise.resolve()
        .then(() => execute(item.command, descriptor))
        .then((result) => {
          results[item.index] = Object.freeze({
            command_id: item.command?.command_id || null,
            action: descriptor.action,
            lane: descriptor.lane,
            effect_key: descriptor.effect_key,
            causal_key: descriptor.causal_key,
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
            causal_key: descriptor.causal_key,
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
          if (descriptor.read_only) {
            activeReads -= 1;
            decrementReadKey(descriptor.causal_key);
          } else {
            activeMutations -= 1;
            activeMutationKeys.delete(descriptor.effect_key);
            if (descriptor.exclusive) exclusiveMutation = false;
          }
        });
      active.add(promise);
    };

    while (pending.length > 0 || active.size > 0) {
      let launched = false;
      const firstExclusive = pending.find((item) => !item.descriptor.read_only && item.descriptor.exclusive) || null;
      const firstExclusiveOrder = firstExclusive?.index ?? null;
      const effective = effectiveConcurrency(this.#readConcurrency, this.#mutationConcurrency);

      for (let i = 0; i < pending.length;) {
        const item = pending[i];
        const descriptor = item.descriptor;
        let runnable = false;

        if (descriptor.scheduler_rejection_error) {
          runnable = true;
        } else if (descriptor.read_only) {
          const sameTargetMutationActive = descriptor.causal_key && activeMutationKeys.has(descriptor.causal_key);
          runnable = activeReads < effective.read_concurrency
            && !sameTargetMutationActive
            && !hasEarlierPendingMutationForRead(item);
        } else if (descriptor.exclusive) {
          runnable = activeMutations === 0;
        } else {
          const behindExclusiveBarrier = firstExclusiveOrder != null && item.index > firstExclusiveOrder;
          const sameTargetReadActive = descriptor.causal_key && Number(activeReadKeys.get(descriptor.causal_key) || 0) > 0;
          runnable = !behindExclusiveBarrier
            && !exclusiveMutation
            && activeMutations < effective.mutation_concurrency
            && !activeMutationKeys.has(descriptor.effect_key)
            && !sameTargetReadActive
            && !hasEarlierPendingReadForMutation(item);
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
  same_tab_read_after_write_causal: true,
  same_tab_write_after_read_causal: true,
  cross_tab_read_parallelism_allowed: true,
  global_mutation_parallelism_allowed: false,
  emergency_is_exclusive: true,
  unknown_action_parallelism_allowed: false,
  bounded_backpressure_required: true,
  exact_tab_mutation_execution_required: true,
  missing_effect_tab_fails_before_executor: true,
  implicit_selected_tab_scheduler_admission: 'FENCED_NONEXCLUSIVE',
  immutable_original_order_barriers: true,
  causal_dependency_precompute: 'O(n)',
  causal_pending_lookup: 'O(1)',
  repeated_pending_causal_scan: false,
  live_concurrency_tuning: true,
  process_pressure_budget_register: true,
  pressure_register_contains_commands: false,
  live_concurrency_tuning_changes_authority: false,
  automatic_effect_retry_allowed: false,
  authority_effect: false,
});