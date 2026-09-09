import {
  BrowserSemanticTargetCache,
  resolveSemanticTargetFast,
} from './browser-semantic-target-cache.mjs';

function assertProjectTargets(projectTargets) {
  if (typeof projectTargets !== 'function') throw new Error('semantic_fast_path_project_targets_required');
}

function exactProjectedTarget(targets, roleRaw, nameRaw) {
  const role = String(roleRaw || '').trim().toLowerCase();
  const name = String(nameRaw || '').trim();
  if (!role || !name) throw new Error('semantic_fast_path_target_invalid');
  const matches = targets.filter((row) => String(row?.role || '').trim().toLowerCase() === role && String(row?.name || '').trim() === name);
  if (matches.length !== 1) {
    throw new Error(matches.length ? `semantic_fast_path_target_ambiguous:${matches.length}` : 'semantic_fast_path_target_not_found');
  }
  return matches[0];
}

export class BrowserSemanticFastPath {
  #cache;

  constructor({ cache = new BrowserSemanticTargetCache() } = {}) {
    if (!(cache instanceof BrowserSemanticTargetCache)) throw new Error('semantic_fast_path_cache_required');
    this.#cache = cache;
  }

  async capture({ dbg, runtime, projectTargets }) {
    if (!dbg || typeof dbg.sendCommand !== 'function') throw new Error('semantic_fast_path_debugger_required');
    assertProjectTargets(projectTargets);
    const tree = await dbg.sendCommand('Accessibility.getFullAXTree');
    const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
    const targets = projectTargets(nodes);
    if (!Array.isArray(targets)) throw new Error('semantic_fast_path_targets_invalid');
    const remembered = this.#cache.remember(runtime, targets);
    return Object.freeze({
      nodes,
      targets,
      cache_seeded: remembered.accepted === true,
      authority_effect: false,
    });
  }

  async resolve({ dbg, runtime, role, name, projectTargets }) {
    if (!dbg || typeof dbg.sendCommand !== 'function') throw new Error('semantic_fast_path_debugger_required');
    assertProjectTargets(projectTargets);
    return resolveSemanticTargetFast({
      dbg,
      cache: this.#cache,
      runtime,
      role,
      name,
      fullTreeResolver: async () => {
        const tree = await dbg.sendCommand('Accessibility.getFullAXTree');
        const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
        const targets = projectTargets(nodes);
        if (!Array.isArray(targets)) throw new Error('semantic_fast_path_targets_invalid');
        this.#cache.remember(runtime, targets);
        return exactProjectedTarget(targets, role, name);
      },
    });
  }

  invalidateWebContents(webContentsId) {
    this.#cache.invalidateWebContents(webContentsId);
  }

  snapshot() {
    const cache = this.#cache.snapshot();
    return Object.freeze({
      schema: 'metaengine.browser-semantic-fast-path.v1',
      cache,
      authority_effect: false,
      scheduler_authority: false,
      lease_authority: false,
      automatic_retry_allowed: false,
    });
  }
}
