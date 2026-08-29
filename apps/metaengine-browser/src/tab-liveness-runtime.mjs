import { TabHealthRegistry } from './tab-health-registry.mjs';
import { TabNetworkActivityRegistry } from './tab-network-activity.mjs';

export const TAB_LIVENESS_RUNTIME_VERSION = '1.0.0';
const ERR_ABORTED = -3;

function safeProcessId(webContents) {
  try {
    const id = Number(webContents?.getOSProcessId?.() || 0);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch { return null; }
}

export class TabLivenessRuntime {
  #network;
  #health;
  #bindings = new Map();

  constructor({ networkRegistry = null, healthRegistry = null } = {}) {
    this.#network = networkRegistry || new TabNetworkActivityRegistry();
    this.#health = healthRegistry || new TabHealthRegistry();
  }

  attachSession(userSession) {
    if (!userSession?.webRequest) throw new Error('tab_liveness_session_webrequest_required');
    this.#network.attach(userSession.webRequest);
    return this.snapshot();
  }

  wire(tabId, webContents) {
    const id = String(tabId || '');
    if (!id || !webContents?.on || !Number.isSafeInteger(Number(webContents.id))) throw new Error('tab_liveness_binding_required');
    const webcontentsId = Number(webContents.id);
    const existing = this.#bindings.get(id);
    if (existing && existing.webcontents_id !== webcontentsId) throw new Error('tab_liveness_rebind_requires_remove');
    if (existing) return this.tabSnapshot(id);

    this.#bindings.set(id, { tab_id: id, webcontents_id: webcontentsId, webContents });
    this.#health.register(id);

    webContents.on('did-start-loading', () => this.#health.mark(id, 'LOADING'));
    webContents.on('did-stop-loading', () => this.#health.mark(id, 'HEALTHY'));
    webContents.on('responsive', () => this.#health.mark(id, 'HEALTHY'));
    webContents.on('unresponsive', () => this.#health.mark(id, 'UNRESPONSIVE', { process_id: safeProcessId(webContents) }));
    webContents.on('render-process-gone', (_event, details = {}) => {
      this.#health.mark(id, 'RENDERER_GONE', {
        reason: details?.reason || 'renderer_gone',
        error_code: details?.exitCode,
        process_id: safeProcessId(webContents),
      });
    });
    webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame, frameProcessId) => {
      const code = Number(errorCode);
      if (isMainFrame !== true || code === ERR_ABORTED) return;
      this.#health.mark(id, 'LOAD_FAILED', {
        reason: 'main_frame_load_failed',
        error_code: code,
        error_description: errorDescription,
        process_id: frameProcessId,
      });
    });

    return this.tabSnapshot(id);
  }

  remove(tabId) {
    const id = String(tabId || '');
    const binding = this.#bindings.get(id);
    if (binding) this.#network.remove(binding.webcontents_id);
    this.#bindings.delete(id);
    this.#health.remove(id);
  }

  tabSnapshot(tabId) {
    const id = String(tabId || '');
    const binding = this.#bindings.get(id);
    return {
      tab_id: id,
      webcontents_id: binding?.webcontents_id ?? null,
      health: this.#health.get(id),
      network: binding ? this.#network.get(binding.webcontents_id) : null,
      authority_effect: false,
    };
  }

  enrichTab(tab) {
    const live = this.tabSnapshot(tab?.tab_id);
    return { ...tab, webcontents_id: live.webcontents_id, health: live.health, network: live.network };
  }

  snapshot() {
    return {
      schema: 'metaengine.tab-liveness-runtime.snapshot.v1',
      version: TAB_LIVENESS_RUNTIME_VERSION,
      bindings: [...this.#bindings.values()].map((row) => ({ tab_id: row.tab_id, webcontents_id: row.webcontents_id })),
      network: this.#network.snapshot(),
      health: this.#health.snapshot(),
      request_content_persisted: false,
      authority_effect: false,
    };
  }
}
