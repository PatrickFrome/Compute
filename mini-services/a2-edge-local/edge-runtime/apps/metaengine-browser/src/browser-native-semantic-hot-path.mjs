import { BrowserNativeSemanticAdapter } from './browser-native-semantic-adapter.mjs';

function assertProjectTargets(projectTargets) {
  if (typeof projectTargets !== 'function') throw new Error('native_semantic_hot_path_project_targets_required');
}

function normalizeTargetError(error) {
  const message = String(error?.message || error || '');
  if (message.startsWith('semantic_fast_path_target_ambiguous:')) {
    const count = message.slice('semantic_fast_path_target_ambiguous:'.length);
    throw new Error(`native_semantic_target_ambiguous:${count}`);
  }
  if (message === 'semantic_fast_path_target_not_found') throw new Error('native_semantic_target_not_found');
  if (message === 'semantic_fast_path_target_invalid') throw new Error('native_semantic_target_invalid');
  throw error;
}

function nativeTarget(resolved) {
  const role = String(resolved?.role || '').trim().toLowerCase();
  const name = String(resolved?.name || '').trim();
  const backendNodeId = Number(resolved?.backend_node_id || 0);
  if (!role || !name || !Number.isSafeInteger(backendNodeId) || backendNodeId < 1) {
    throw new Error('native_semantic_target_invalid');
  }
  return Object.freeze({ role, name, backend_node_id: backendNodeId });
}

export class BrowserNativeSemanticHotPath {
  #adapter;

  constructor({ adapter = new BrowserNativeSemanticAdapter() } = {}) {
    if (!(adapter instanceof BrowserNativeSemanticAdapter)) throw new Error('native_semantic_hot_path_adapter_required');
    this.#adapter = adapter;
  }

  async capture({ dbg, projectTargets }) {
    assertProjectTargets(projectTargets);
    const captured = await this.#adapter.capture({ dbg, projectTargets });
    return Object.freeze({
      nodes: captured.nodes,
      targets: captured.targets,
      cache_seeded: captured.cache_seeded === true,
      authority_effect: false,
    });
  }

  async resolve({ dbg, role, name, projectTargets }) {
    assertProjectTargets(projectTargets);
    try {
      const resolved = await this.#adapter.resolve({ dbg, role, name, projectTargets });
      const source = String(resolved?.resolution || '');
      return Object.freeze({
        target: nativeTarget(resolved),
        source,
        revalidated: source === 'CACHE_REVALIDATED',
        authority_effect: false,
      });
    } catch (error) {
      normalizeTargetError(error);
    }
  }

  invalidateWebContents(webContentsId) {
    this.#adapter.invalidateWebContents(webContentsId);
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.browser-native-semantic-hot-path.v1',
      adapter: this.#adapter.snapshot(),
      authority_effect: false,
      scheduler_authority: false,
      lease_authority: false,
      effect_execution_authority: false,
      automatic_retry_allowed: false,
      final_effect_fence_required: true,
      canonical_stop_generation_full_tree_required: true,
      canonical_submit_outcome_full_tree_required: true,
    });
  }
}
