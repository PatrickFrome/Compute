export const TAB_HEALTH_VERSION = '1.1.0';

const STATES = new Set(['UNKNOWN','HEALTHY','LOADING','UNRESPONSIVE','RENDERER_GONE','LOAD_FAILED']);

function cleanDetail(detail = {}) {
  return {
    reason: detail?.reason ? String(detail.reason).slice(0, 120) : null,
    error_code: Number.isFinite(Number(detail?.error_code)) ? Number(detail.error_code) : null,
    error_description: detail?.error_description ? String(detail.error_description).slice(0, 180) : null,
    process_id: Number.isSafeInteger(Number(detail?.process_id)) ? Number(detail.process_id) : null,
  };
}

export class TabHealthRegistry {
  #clock; #rows = new Map(); #seq = 0; #bindings = new Map();

  constructor({ clock = () => Date.now() } = {}) { this.#clock = clock; }

  register(tabId, { webcontents_id = null } = {}) {
    const id = String(tabId || '');
    if (!id) throw new Error('tab_health_tab_id_required');
    if (!this.#rows.has(id)) {
      this.#rows.set(id, {
        tab_id: id,
        webcontents_id: Number.isSafeInteger(Number(webcontents_id)) && Number(webcontents_id) > 0 ? Number(webcontents_id) : null,
        renderer_incarnation: 0,
        state: 'UNKNOWN',
        state_since: new Date(this.#clock()).toISOString(),
        event_seq: 0,
        last_event: 'REGISTERED',
        last_event_at: new Date(this.#clock()).toISOString(),
        detail: cleanDetail(),
        authority_effect: false,
      });
    } else if (Number.isSafeInteger(Number(webcontents_id)) && Number(webcontents_id) > 0) {
      this.#rows.get(id).webcontents_id = Number(webcontents_id);
    }
    return this.get(id);
  }

  mark(tabId, state, detail = {}) {
    const id = String(tabId || '');
    const normalized = String(state || '').toUpperCase();
    if (!STATES.has(normalized)) throw new Error('tab_health_state_invalid');
    const current = this.#rows.get(id) || this.register(id);
    const now = new Date(this.#clock()).toISOString();
    this.#seq += 1;
    const next = {
      ...current,
      state: normalized,
      state_since: current.state === normalized ? current.state_since : now,
      event_seq: this.#seq,
      last_event: normalized,
      last_event_at: now,
      detail: cleanDetail(detail),
      authority_effect: false,
    };
    if (normalized === 'RENDERER_GONE') next.renderer_incarnation = Number(current.renderer_incarnation || 0) + 1;
    this.#rows.set(id, next);
    return structuredClone(next);
  }

  bind(tabId, webContents) {
    const id = String(tabId || '');
    if (!id || !webContents?.on || !Number.isSafeInteger(Number(webContents.id)) || Number(webContents.id) <= 0) {
      throw new Error('tab_health_webcontents_required');
    }
    if (this.#bindings.has(id)) throw new Error('tab_health_binding_exists');
    this.register(id, { webcontents_id: webContents.id });
    const handlers = {
      didStartLoading: () => this.mark(id, 'LOADING'),
      didFinishLoad: () => this.mark(id, 'HEALTHY'),
      didFailLoad: (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
        if (isMainFrame !== true) return;
        this.mark(id, 'LOAD_FAILED', { error_code: errorCode, error_description: errorDescription });
      },
      unresponsive: () => this.mark(id, 'UNRESPONSIVE'),
      responsive: () => this.mark(id, 'HEALTHY'),
      renderProcessGone: (_event, details = {}) => this.mark(id, 'RENDERER_GONE', {
        reason: details.reason,
        process_id: details.processId,
      }),
    };
    webContents.on('did-start-loading', handlers.didStartLoading);
    webContents.on('did-finish-load', handlers.didFinishLoad);
    webContents.on('did-fail-load', handlers.didFailLoad);
    webContents.on('unresponsive', handlers.unresponsive);
    webContents.on('responsive', handlers.responsive);
    webContents.on('render-process-gone', handlers.renderProcessGone);
    this.#bindings.set(id, { webContents, handlers });
    return this.get(id);
  }

  unbind(tabId) {
    const id = String(tabId || '');
    const binding = this.#bindings.get(id);
    if (binding?.webContents?.removeListener) {
      const { webContents, handlers } = binding;
      webContents.removeListener('did-start-loading', handlers.didStartLoading);
      webContents.removeListener('did-finish-load', handlers.didFinishLoad);
      webContents.removeListener('did-fail-load', handlers.didFailLoad);
      webContents.removeListener('unresponsive', handlers.unresponsive);
      webContents.removeListener('responsive', handlers.responsive);
      webContents.removeListener('render-process-gone', handlers.renderProcessGone);
    }
    this.#bindings.delete(id);
    this.#rows.delete(id);
  }

  remove(tabId) { this.unbind(tabId); }
  get(tabId) { const row = this.#rows.get(String(tabId || '')); return row ? structuredClone(row) : null; }

  snapshot() {
    return {
      schema: 'metaengine.tab-health.snapshot.v1',
      version: TAB_HEALTH_VERSION,
      tabs: [...this.#rows.values()].map((row) => structuredClone(row)),
      page_content_observed: false,
      page_content_authority: false,
      browser_actuation_authority: false,
      authority_effect: false,
    };
  }
}
