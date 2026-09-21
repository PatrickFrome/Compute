export const TAB_HEALTH_VERSION = '1.0.0';

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
  #clock; #rows = new Map(); #seq = 0;

  constructor({ clock = () => Date.now() } = {}) { this.#clock = clock; }

  register(tabId) {
    const id = String(tabId || '');
    if (!id) throw new Error('tab_health_tab_id_required');
    if (!this.#rows.has(id)) {
      this.#rows.set(id, {
        tab_id: id,
        state: 'UNKNOWN',
        state_since: new Date(this.#clock()).toISOString(),
        event_seq: 0,
        last_event: 'REGISTERED',
        last_event_at: new Date(this.#clock()).toISOString(),
        detail: cleanDetail(),
        authority_effect: false,
      });
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
    this.#rows.set(id, next);
    return structuredClone(next);
  }

  remove(tabId) { this.#rows.delete(String(tabId || '')); }
  get(tabId) { const row = this.#rows.get(String(tabId || '')); return row ? structuredClone(row) : null; }

  snapshot() {
    return {
      schema: 'metaengine.tab-health.snapshot.v1',
      version: TAB_HEALTH_VERSION,
      tabs: [...this.#rows.values()].map((row) => structuredClone(row)),
      authority_effect: false,
    };
  }
}
