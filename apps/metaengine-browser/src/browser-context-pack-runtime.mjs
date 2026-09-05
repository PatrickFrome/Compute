import { captureBrowserContextPack } from './browser-context-pack.mjs';
import { captureSemanticFrame, nativeBrowserTargetIdentity } from './native-browser-control.mjs';

function exactLiveBinding({ registry, views, targetIdentity }, tabId) {
  const tab = registry?.get?.(tabId) || null;
  const view = views?.get?.(String(tabId)) || null;
  if (!tab || !view || view.webContents?.isDestroyed?.() === true) return null;
  const identity = targetIdentity(view.webContents);
  return Object.freeze({
    tab_id: String(tab.tab_id || ''),
    target_id: String(identity.target_id || ''),
    process_incarnation_id: String(identity.process_incarnation_id || ''),
    url: String(view.webContents.getURL?.() || tab.url || ''),
    title: String(view.webContents.getTitle?.() || tab.title || ''),
    kind: String(tab.kind || ''),
    authority_effect: false,
  });
}

/**
 * Shell-local Context Pack runtime. It has no timer and no actuation method: every
 * pack is created only by an explicit caller-supplied tab list. The exact live
 * WebContents binding is observed both before and after each semantic capture by the
 * core contract.
 */
export class BrowserContextPackRuntime {
  #registry;
  #views;
  #captureFrame;
  #targetIdentity;

  constructor({
    registry,
    views,
    captureFrame = captureSemanticFrame,
    targetIdentity = nativeBrowserTargetIdentity,
  } = {}) {
    if (!registry || typeof registry.get !== 'function') throw new Error('browser_context_pack_registry_required');
    if (!views || typeof views.get !== 'function') throw new Error('browser_context_pack_views_required');
    if (typeof captureFrame !== 'function') throw new Error('browser_context_pack_frame_capture_required');
    if (typeof targetIdentity !== 'function') throw new Error('browser_context_pack_target_identity_required');
    this.#registry = registry;
    this.#views = views;
    this.#captureFrame = captureFrame;
    this.#targetIdentity = targetIdentity;
  }

  observeTabBinding(tabId) {
    return exactLiveBinding({
      registry: this.#registry,
      views: this.#views,
      targetIdentity: this.#targetIdentity,
    }, String(tabId || ''));
  }

  async capture(tabIds) {
    return captureBrowserContextPack({
      tab_ids: tabIds,
      observeTabBinding: (tabId) => this.observeTabBinding(tabId),
      captureFrame: async (binding) => {
        const current = this.observeTabBinding(binding.tab_id);
        if (!current
          || current.target_id !== binding.target_id
          || current.process_incarnation_id !== binding.process_incarnation_id
          || current.url !== binding.url) {
          throw new Error('browser_context_pack_pre_capture_binding_drift');
        }
        const view = this.#views.get(binding.tab_id);
        if (!view || view.webContents?.isDestroyed?.() === true) throw new Error('browser_context_pack_view_not_live');
        return this.#captureFrame(view.webContents);
      },
    });
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.browser-context-pack-runtime.v1',
      explicit_invocation_only: true,
      automatic_capture: false,
      automatic_retry_allowed: false,
      browser_actuation_authority: false,
      task_authority: false,
      scheduler_authority: false,
      second_polling_loop: false,
      authority_effect: false,
    });
  }
}
