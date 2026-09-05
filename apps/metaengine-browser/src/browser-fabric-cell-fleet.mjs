import { BROWSER_CELL_SCHEMA, BROWSER_CELL_TYPES } from './browser-fabric-browser-cell.mjs';

export const BROWSER_CELL_FLEET_SCHEMA = 'metaengine.browser-fabric.browser-cell-fleet.v1';

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

/**
 * Cross-cell isolation proof for the two-cell pilot and later fleet admission.
 * No BrowserContext is created here; the runtime must independently read back
 * the exact context/partition identities before a cell becomes capacity.
 */
export function validateBrowserCellFleetIsolation(cells = []) {
  if (!Array.isArray(cells) || cells.length === 0) return fail('CELL_FLEET_EMPTY_OR_INVALID');
  const cellIds = new Set();
  const contextIds = new Set();
  const workerPartitions = new Set();
  let activeClaims = 0;
  let capacityCells = 0;

  for (const cell of cells) {
    if (!cell || cell.schema !== BROWSER_CELL_SCHEMA) return fail('CELL_SCHEMA_INVALID');
    if (typeof cell.cell_id !== 'string' || !cell.cell_id) return fail('CELL_ID_INVALID');
    if (cellIds.has(cell.cell_id)) return fail('DUPLICATE_CELL_ID', { cell_id: cell.cell_id });
    cellIds.add(cell.cell_id);

    if (typeof cell.browser_context_id !== 'string' || !cell.browser_context_id) return fail('CELL_CONTEXT_ID_INVALID');
    if (contextIds.has(cell.browser_context_id)) return fail('SHARED_BROWSER_CONTEXT_FORBIDDEN', { browser_context_id: cell.browser_context_id });
    contextIds.add(cell.browser_context_id);

    const claimCount = Number(cell.active_claim_count || 0);
    if (!Number.isSafeInteger(claimCount) || claimCount < 0 || claimCount > 1) return fail('CELL_CLAIM_CARDINALITY_INVALID', { cell_id: cell.cell_id });
    activeClaims += claimCount;

    if (cell.type === BROWSER_CELL_TYPES.HUMAN) {
      if (cell.fleet_capacity !== false || claimCount !== 0) return fail('HUMAN_CELL_IN_FLEET_FORBIDDEN', { cell_id: cell.cell_id });
      continue;
    }

    if (cell.type === BROWSER_CELL_TYPES.AUTHENTICATED_WORKER) {
      if (cell.persistent_partition !== true || typeof cell.storage_partition_id !== 'string' || !cell.storage_partition_id) {
        return fail('WORKER_PARTITION_REQUIRED', { cell_id: cell.cell_id });
      }
      if (workerPartitions.has(cell.storage_partition_id)) return fail('SHARED_WORKER_PARTITION_FORBIDDEN', { storage_partition_id: cell.storage_partition_id });
      workerPartitions.add(cell.storage_partition_id);
      capacityCells += 1;
    } else if (cell.type === BROWSER_CELL_TYPES.EPHEMERAL_RESEARCH) {
      if (cell.persistent_partition !== false || cell.user_data_allowed !== false || cell.prompt_access_allowed !== false) {
        return fail('RESEARCH_CELL_ISOLATION_INVALID', { cell_id: cell.cell_id });
      }
      capacityCells += 1;
    } else if (cell.type === BROWSER_CELL_TYPES.RECOVERY_PROBE) {
      if (cell.persistent_partition !== false || cell.user_data_allowed !== false || cell.send_allowed !== false) {
        return fail('RECOVERY_CELL_ISOLATION_INVALID', { cell_id: cell.cell_id });
      }
    } else {
      return fail('CELL_TYPE_INVALID', { cell_id: cell.cell_id });
    }
  }

  return Object.freeze({
    ok: true,
    schema: BROWSER_CELL_FLEET_SCHEMA,
    cell_count: cells.length,
    capacity_cell_count: capacityCells,
    active_claim_count: activeClaims,
    unique_browser_contexts: contextIds.size === cells.length,
    unique_worker_partitions: true,
    one_claim_per_cell: true,
    human_profile_excluded_from_capacity: true,
    runtime_context_readback_required: true,
    fleet_capacity_authority: false,
    browser_effect_allowed: false,
    authority_effect: false,
  });
}
