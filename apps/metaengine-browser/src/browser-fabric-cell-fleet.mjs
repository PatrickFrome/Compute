import {
  BROWSER_CELL_SCHEMA,
  BROWSER_CELL_TYPES,
  validateBrowserCellEnvelope,
} from './browser-fabric-browser-cell.mjs';

export const BROWSER_CELL_FLEET_SCHEMA = 'metaengine.browser-fabric.browser-cell-fleet.v1';
export const BROWSER_CELL_RUNTIME_READBACK_SCHEMA = 'metaengine.browser-fabric.cell-runtime-readback.v1';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const RUNTIME_READBACK_KEYS = new Set([
  'schema', 'observer_id', 'observer_independent', 'observed_at', 'cell_id',
  'cell_generation', 'browser_context_id', 'browser_process_incarnation',
  'renderer_process_incarnation', 'storage_partition_id',
]);
const FLEET_RESOURCE_LIMIT_KEYS = new Set(['max_cells', 'max_tabs', 'max_targets', 'max_memory_mb']);
export const BROWSER_CELL_FLEET_HARD_RESOURCE_LIMITS = Object.freeze({
  max_cells: 64,
  max_tabs: 256,
  max_targets: 512,
  max_memory_mb: 65_536,
});

function fail(reason, details = {}) {
  return Object.freeze({
    ok: false,
    schema: BROWSER_CELL_FLEET_SCHEMA,
    reason,
    fleet_capacity_authority: false,
    browser_effect_allowed: false,
    authority_effect: false,
    ...details,
  });
}

function safe(value) {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function runtimeReadbackViolation(cell) {
  const readback = cell.runtime_readback;
  if (!readback
      || typeof readback !== 'object'
      || Array.isArray(readback)
      || Object.keys(readback).length !== RUNTIME_READBACK_KEYS.size
      || !Object.keys(readback).every((key) => RUNTIME_READBACK_KEYS.has(key))
      || readback.schema !== BROWSER_CELL_RUNTIME_READBACK_SCHEMA) return 'CELL_RUNTIME_READBACK_REQUIRED';
  if (readback.observer_independent !== true || !safe(readback.observer_id)) return 'CELL_RUNTIME_READBACK_OBSERVER_INVALID';
  if (readback.observed_at !== cell.runtime_observed_at
      || readback.cell_id !== cell.cell_id
      || readback.cell_generation !== cell.cell_generation
      || readback.browser_context_id !== cell.browser_context_id
      || readback.browser_process_incarnation !== cell.browser_process_incarnation) {
    return 'CELL_RUNTIME_READBACK_BINDING_MISMATCH';
  }
  if (!safe(readback.renderer_process_incarnation)) return 'CELL_RENDERER_INCARNATION_INVALID';
  const expectedPartition = cell.persistent_partition === true ? cell.storage_partition_id : null;
  return readback.storage_partition_id === expectedPartition ? null : 'CELL_RUNTIME_PARTITION_READBACK_MISMATCH';
}

function activeClaimViolation(cell) {
  if (cell.active_claim_count === 0) {
    return cell.active_task_id == null && cell.active_claim_generation == null
      ? null
      : 'IDLE_CELL_HAS_ACTIVE_CLAIM_IDENTITY';
  }
  return safe(cell.active_task_id)
    && Number.isSafeInteger(cell.active_claim_generation)
    && cell.active_claim_generation > 0
    ? null
    : 'ACTIVE_CELL_CLAIM_IDENTITY_INVALID';
}

function typeIsolationViolation(cell) {
  if (cell.type === BROWSER_CELL_TYPES.HUMAN) {
    if (cell.fleet_capacity !== false || cell.active_claim_count !== 0) return 'HUMAN_CELL_IN_FLEET_FORBIDDEN';
    if (cell.persistent_partition !== true || !safe(cell.storage_partition_id)) return 'HUMAN_PARTITION_REQUIRED';
    return null;
  }
  if (cell.type === BROWSER_CELL_TYPES.AUTHENTICATED_WORKER) {
    if (cell.fleet_capacity !== true) return 'WORKER_FLEET_CAPACITY_UNPROVEN';
    return cell.persistent_partition === true && safe(cell.storage_partition_id)
      ? null
      : 'WORKER_PARTITION_REQUIRED';
  }
  if (cell.type === BROWSER_CELL_TYPES.EPHEMERAL_RESEARCH) {
    if (cell.fleet_capacity !== true) return 'RESEARCH_FLEET_CAPACITY_UNPROVEN';
    return cell.persistent_partition === false
      && cell.user_data_allowed === false
      && cell.prompt_access_allowed === false
      && cell.send_allowed === false
      ? null
      : 'RESEARCH_CELL_ISOLATION_INVALID';
  }
  if (cell.type === BROWSER_CELL_TYPES.RECOVERY_PROBE) {
    if (cell.fleet_capacity !== false) return 'RECOVERY_FLEET_CAPACITY_FORBIDDEN';
    return cell.persistent_partition === false
      && cell.user_data_allowed === false
      && cell.prompt_access_allowed === false
      && cell.send_allowed === false
      ? null
      : 'RECOVERY_CELL_ISOLATION_INVALID';
  }
  return 'CELL_TYPE_INVALID';
}

function inspectCell(cell, now) {
  const envelopeViolation = validateBrowserCellEnvelope(cell, { now });
  if (envelopeViolation) return { violation: envelopeViolation };
  const claimViolation = activeClaimViolation(cell);
  if (claimViolation) return { violation: claimViolation };
  const isolationViolation = typeIsolationViolation(cell);
  if (isolationViolation) return { violation: isolationViolation };
  const readbackViolation = runtimeReadbackViolation(cell);
  if (readbackViolation) return { violation: readbackViolation };
  return {
    violation: null,
    capacity: cell.fleet_capacity === true ? 1 : 0,
    active_claims: cell.active_claim_count,
    persistent_partition_id: cell.persistent_partition === true ? cell.storage_partition_id : null,
    renderer_process_incarnation: cell.runtime_readback.renderer_process_incarnation,
    resource_budget: cell.type === BROWSER_CELL_TYPES.HUMAN ? null : cell.resource_budget,
  };
}

function validFleetResourceLimits(limits) {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) return false;
  const keys = Object.keys(limits);
  return keys.length === FLEET_RESOURCE_LIMIT_KEYS.size
    && keys.every((key) => FLEET_RESOURCE_LIMIT_KEYS.has(key))
    && keys.every((key) => Number.isSafeInteger(limits[key])
      && limits[key] > 0
      && limits[key] <= BROWSER_CELL_FLEET_HARD_RESOURCE_LIMITS[key]);
}

function emptyAllocation() {
  return { cells: 0, tabs: 0, targets: 0, memory_mb: 0 };
}

function addResourceBudget(allocation, budget) {
  if (budget == null) return;
  allocation.cells += 1;
  allocation.tabs += budget.max_tabs;
  allocation.targets += budget.max_targets;
  allocation.memory_mb += budget.max_memory_mb;
}

function allocationWithinLimits(allocation, limits) {
  return allocation.cells <= limits.max_cells
    && allocation.tabs <= limits.max_tabs
    && allocation.targets <= limits.max_targets
    && allocation.memory_mb <= limits.max_memory_mb;
}

function duplicateViolation(cell, seen) {
  if (seen.cell_ids.has(cell.cell_id)) return ['DUPLICATE_CELL_ID', { cell_id: cell.cell_id }];
  if (seen.context_ids.has(cell.browser_context_id)) {
    return ['SHARED_BROWSER_CONTEXT_FORBIDDEN', { browser_context_id: cell.browser_context_id }];
  }
  const partition = cell.persistent_partition === true ? cell.storage_partition_id : null;
  if (partition != null && seen.partition_ids.has(partition)) {
    return ['SHARED_PERSISTENT_PARTITION_FORBIDDEN', { storage_partition_id: partition }];
  }
  const renderer = cell.runtime_readback.renderer_process_incarnation;
  if (seen.renderer_incarnations.has(renderer)) {
    return ['SHARED_RENDERER_PROCESS_FORBIDDEN', { renderer_process_incarnation: renderer }];
  }
  return null;
}

function rememberCell(cell, seen) {
  seen.cell_ids.add(cell.cell_id);
  seen.context_ids.add(cell.browser_context_id);
  if (cell.persistent_partition === true) seen.partition_ids.add(cell.storage_partition_id);
  seen.renderer_incarnations.add(cell.runtime_readback.renderer_process_incarnation);
}

/**
 * Cross-cell isolation proof for fleet admission. No BrowserContext is created
 * here; an independent runtime readback must bind each generation, context,
 * partition and renderer incarnation before a cell contributes capacity.
 */
export function validateBrowserCellFleetIsolation(cells = [], {
  now = new Date(),
  resource_limits = null,
} = {}) {
  if (!Array.isArray(cells) || cells.length === 0) return fail('CELL_FLEET_EMPTY_OR_INVALID');
  if (!validFleetResourceLimits(resource_limits)) return fail('CELL_FLEET_RESOURCE_LIMITS_INVALID');
  const seen = {
    cell_ids: new Set(),
    context_ids: new Set(),
    partition_ids: new Set(),
    renderer_incarnations: new Set(),
  };
  let activeClaims = 0;
  let capacityCells = 0;
  const allocation = emptyAllocation();

  for (const cell of cells) {
    if (!cell || cell.schema !== BROWSER_CELL_SCHEMA) return fail('CELL_SCHEMA_INVALID');
    const inspection = inspectCell(cell, now);
    if (inspection.violation) return fail(inspection.violation, { cell_id: cell.cell_id });
    const duplicate = duplicateViolation(cell, seen);
    if (duplicate) return fail(duplicate[0], duplicate[1]);
    rememberCell(cell, seen);
    activeClaims += inspection.active_claims;
    capacityCells += inspection.capacity;
    addResourceBudget(allocation, inspection.resource_budget);
  }
  if (!allocationWithinLimits(allocation, resource_limits)) {
    return fail('CELL_FLEET_RESOURCE_BUDGET_EXCEEDED', {
      allocated_resources: Object.freeze({ ...allocation }),
    });
  }

  return Object.freeze({
    ok: true,
    schema: BROWSER_CELL_FLEET_SCHEMA,
    cell_count: cells.length,
    capacity_cell_count: capacityCells,
    active_claim_count: activeClaims,
    unique_browser_contexts: true,
    unique_persistent_partitions: true,
    unique_renderer_process_incarnations: true,
    one_claim_per_cell: true,
    human_profile_excluded_from_capacity: true,
    independent_runtime_readback_required: true,
    generation_bound_capacity: true,
    explicit_resource_budgets_required: true,
    allocated_resources: Object.freeze({ ...allocation }),
    resource_limits: Object.freeze({ ...resource_limits }),
    caller_resource_limits_capped_by_hard_ceiling: true,
    fleet_capacity_authority: false,
    browser_effect_allowed: false,
    authority_effect: false,
  });
}
