const DEFAULT_MAX_CELLS = 128;
const DEFAULT_MAX_TARGETS_PER_CELL = 120;

const semanticKey = (role, name) => `${String(role || '').trim().toLowerCase()}\u0000${String(name || '').trim()}`;

function runtimeKey(runtime) {
  if (!runtime) return null;
  const webContentsId = Number(runtime.web_contents_id);
  const attachmentGeneration = Number(runtime.attachment_generation);
  const documentGeneration = Number(runtime.document_generation);
  const bindingGeneration = Number(runtime.binding_generation);
  const targetId = String(runtime.target_id || '');
  if (!Number.isSafeInteger(webContentsId) || webContentsId < 1 || !targetId) return null;
  if (![attachmentGeneration, documentGeneration, bindingGeneration].every(Number.isSafeInteger)) return null;
  return `${webContentsId}:${targetId}:${attachmentGeneration}:${documentGeneration}:${bindingGeneration}`;
}

function normalizedTarget(row) {
  const role = String(row?.role || '').trim().toLowerCase();
  const name = String(row?.name || '').trim();
  const backendNodeId = Number(row?.backend_node_id ?? row?.backendDOMNodeId ?? 0);
  if (!role || !name || !Number.isSafeInteger(backendNodeId) || backendNodeId < 1) return null;
  return Object.freeze({ role, name, backend_node_id: backendNodeId });
}

function partialNodeMatches(node, expected) {
  if (!node || node.ignored === true) return false;
  const role = String(node?.role?.value || '').trim().toLowerCase();
  const name = String(node?.name?.value || '').trim();
  const backendNodeId = Number(node?.backendDOMNodeId || 0);
  return role === expected.role && name === expected.name && backendNodeId === expected.backend_node_id;
}

export class BrowserSemanticTargetCache {
  #cells = new Map();
  #maxCells;
  #maxTargetsPerCell;

  constructor({ maxCells = DEFAULT_MAX_CELLS, maxTargetsPerCell = DEFAULT_MAX_TARGETS_PER_CELL } = {}) {
    if (!Number.isSafeInteger(maxCells) || maxCells < 1 || maxCells > 1024) throw new Error('semantic_target_cache_max_cells_invalid');
    if (!Number.isSafeInteger(maxTargetsPerCell) || maxTargetsPerCell < 1 || maxTargetsPerCell > 512) throw new Error('semantic_target_cache_max_targets_invalid');
    this.#maxCells = maxCells;
    this.#maxTargetsPerCell = maxTargetsPerCell;
  }

  remember(runtime, targets = []) {
    const key = runtimeKey(runtime);
    if (!key) return { accepted: false, reason: 'runtime_identity_invalid', authority_effect: false };
    const cellId = Number(runtime.web_contents_id);
    const rows = new Map();
    for (const row of targets) {
      const target = normalizedTarget(row);
      if (!target) continue;
      const targetKey = semanticKey(target.role, target.name);
      if (rows.has(targetKey)) {
        rows.delete(targetKey);
        continue;
      }
      if (rows.size >= this.#maxTargetsPerCell) break;
      rows.set(targetKey, target);
    }
    this.#cells.delete(cellId);
    this.#cells.set(cellId, { runtime_key: key, targets: rows });
    while (this.#cells.size > this.#maxCells) this.#cells.delete(this.#cells.keys().next().value);
    return { accepted: true, target_count: rows.size, authority_effect: false };
  }

  invalidateWebContents(webContentsId) {
    this.#cells.delete(Number(webContentsId));
  }

  lookup(runtime, role, name) {
    const key = runtimeKey(runtime);
    const cell = this.#cells.get(Number(runtime?.web_contents_id));
    if (!key || !cell || cell.runtime_key !== key) return null;
    return cell.targets.get(semanticKey(role, name)) || null;
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.browser-semantic-target-cache.v1',
      cell_count: this.#cells.size,
      max_cells: this.#maxCells,
      max_targets_per_cell: this.#maxTargetsPerCell,
      authority_effect: false,
      scheduler_authority: false,
      lease_authority: false,
      automatic_retry_allowed: false,
    });
  }
}

export async function resolveSemanticTargetFast({ dbg, cache, runtime, role, name, fullTreeResolver }) {
  if (!dbg || typeof dbg.sendCommand !== 'function') throw new Error('semantic_target_cache_debugger_required');
  if (!(cache instanceof BrowserSemanticTargetCache)) throw new Error('semantic_target_cache_required');
  if (typeof fullTreeResolver !== 'function') throw new Error('semantic_target_cache_full_tree_resolver_required');

  const cached = cache.lookup(runtime, role, name);
  if (cached) {
    try {
      const partial = await dbg.sendCommand('Accessibility.getPartialAXTree', {
        backendNodeId: cached.backend_node_id,
        fetchRelatives: false,
      });
      const nodes = Array.isArray(partial?.nodes) ? partial.nodes : [];
      if (nodes.length === 1 && partialNodeMatches(nodes[0], cached)) {
        return Object.freeze({ ...cached, resolution: 'CACHE_REVALIDATED', authority_effect: false });
      }
    } catch {}
    cache.invalidateWebContents(runtime?.web_contents_id);
  }

  const resolved = normalizedTarget(await fullTreeResolver());
  if (!resolved) throw new Error('semantic_target_cache_full_tree_resolution_invalid');
  return Object.freeze({ ...resolved, resolution: 'FULL_TREE', authority_effect: false });
}
