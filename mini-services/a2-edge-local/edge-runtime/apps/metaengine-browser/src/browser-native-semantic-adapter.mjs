import { BrowserSemanticFastPath } from './browser-semantic-fast-path.mjs';

function assertDebugger(dbg) {
  if (!dbg || typeof dbg.sendCommand !== 'function') throw new Error('native_semantic_adapter_debugger_required');
}

function assertProjectTargets(projectTargets) {
  if (typeof projectTargets !== 'function') throw new Error('native_semantic_adapter_project_targets_required');
}

function runtimeIdentity(dbg) {
  const row = dbg.bindingIdentity?.();
  if (!row) throw new Error('native_semantic_adapter_runtime_identity_required');
  const runtime = {
    web_contents_id: Number(row.web_contents_id),
    target_id: String(row.target_id || ''),
    attachment_generation: Number(row.attachment_generation),
    document_generation: Number(row.document_generation),
    binding_generation: Number(row.binding_generation),
  };
  if (!Number.isSafeInteger(runtime.web_contents_id) || runtime.web_contents_id < 1) throw new Error('native_semantic_adapter_webcontents_invalid');
  if (!runtime.target_id) throw new Error('native_semantic_adapter_target_invalid');
  for (const key of ['attachment_generation', 'document_generation', 'binding_generation']) {
    if (!Number.isSafeInteger(runtime[key]) || runtime[key] < 0) throw new Error(`native_semantic_adapter_${key}_invalid`);
  }
  return Object.freeze(runtime);
}

export class BrowserNativeSemanticAdapter {
  #fastPath;

  constructor({ fastPath = new BrowserSemanticFastPath() } = {}) {
    if (!(fastPath instanceof BrowserSemanticFastPath)) throw new Error('native_semantic_adapter_fast_path_required');
    this.#fastPath = fastPath;
  }

  async capture({ dbg, projectTargets }) {
    assertDebugger(dbg);
    assertProjectTargets(projectTargets);
    return this.#fastPath.capture({
      dbg,
      runtime: runtimeIdentity(dbg),
      projectTargets,
    });
  }

  async resolve({ dbg, role, name, projectTargets }) {
    assertDebugger(dbg);
    assertProjectTargets(projectTargets);
    return this.#fastPath.resolve({
      dbg,
      runtime: runtimeIdentity(dbg),
      role,
      name,
      projectTargets,
    });
  }

  invalidateWebContents(webContentsId) {
    this.#fastPath.invalidateWebContents(webContentsId);
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.browser-native-semantic-adapter.v1',
      semantic_fast_path: this.#fastPath.snapshot(),
      authority_effect: false,
      scheduler_authority: false,
      lease_authority: false,
      automatic_retry_allowed: false,
      final_effect_fence_required: true,
    });
  }
}
