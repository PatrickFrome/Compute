import crypto from 'node:crypto';

const MAX_TABS = 32;

export class TabRegistry {
  #tabs = new Map();
  #selectedId = null;

  create({ url, kind = 'USER_WEB', title = '' }) {
    if (this.#tabs.size >= MAX_TABS) throw new Error('tab_capacity_exceeded');
    const tab = Object.freeze({
      tab_id: `tab_${crypto.randomUUID()}`,
      kind: String(kind),
      url: String(url),
      title: String(title || ''),
      created_at: new Date().toISOString(),
    });
    this.#tabs.set(tab.tab_id, tab);
    if (!this.#selectedId) this.#selectedId = tab.tab_id;
    return structuredClone(tab);
  }

  update(tabId, patch = {}) {
    const current = this.#tabs.get(String(tabId));
    if (!current) throw new Error('tab_not_found');
    const next = Object.freeze({
      ...current,
      ...(patch.url === undefined ? {} : { url: String(patch.url) }),
      ...(patch.title === undefined ? {} : { title: String(patch.title) }),
      ...(patch.kind === undefined ? {} : { kind: String(patch.kind) }),
      tab_id: current.tab_id,
      created_at: current.created_at,
    });
    this.#tabs.set(current.tab_id, next);
    return structuredClone(next);
  }

  select(tabId) {
    const id = String(tabId);
    if (!this.#tabs.has(id)) throw new Error('tab_not_found');
    this.#selectedId = id;
    return this.get(id);
  }

  close(tabId) {
    const id = String(tabId);
    if (!this.#tabs.has(id)) return null;
    const order = [...this.#tabs.keys()];
    const index = order.indexOf(id);
    const old = this.#tabs.get(id);
    this.#tabs.delete(id);
    if (this.#selectedId === id) {
      const remaining = [...this.#tabs.keys()];
      this.#selectedId = remaining[Math.min(index, Math.max(0, remaining.length - 1))] || null;
    }
    return structuredClone(old);
  }

  get(tabId) {
    const tab = this.#tabs.get(String(tabId));
    return tab ? structuredClone(tab) : null;
  }

  selected() { return this.#selectedId ? this.get(this.#selectedId) : null; }

  snapshot() {
    return Object.freeze({
      tabs: [...this.#tabs.values()].map((x) => structuredClone(x)),
      selected_tab_id: this.#selectedId,
      max_tabs: MAX_TABS,
    });
  }
}
