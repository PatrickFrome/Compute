import crypto from 'node:crypto';

// Per-role quota (W3): the fleet may never occupy more than FLEET_TAB_CEILING
// physical tabs, which guarantees the human user at least
// MAX_TABS - FLEET_TAB_CEILING = 16 slots of headroom at all times, no matter
// how the elastic governor scales the worker pool. The ceiling deliberately
// sits above the governor's 12-agent live ceiling so PROVISIONING_AMBIGUOUS
// and orphan tabs (which still hold physical slots) do not collide with live
// workers inside the same pass.
export const FLEET_TAB_CEILING = 16;
const MAX_TABS = 32;
const TAB_ROLES = Object.freeze(['USER', 'FLEET']);

function countRole(tabs, role) {
  return tabs.filter((tab) => String(tab.role || 'USER') === role).length;
}

export class TabRegistry {
  #tabs = new Map();
  #selectedId = null;

  create({ url, kind = 'USER_WEB', title = '', role = 'USER' } = {}) {
    const tabRole = String(role || 'USER').toUpperCase();
    if (!TAB_ROLES.includes(tabRole)) throw new Error('tab_role_invalid');
    // Deterministic pre-effect capacity contract: both the shared wall and the
    // per-kind fleet ceiling surface the SAME error string, so the fleet
    // provisioner's existing classification (deterministic no-effect, never
    // ambiguous) keeps working without modification.
    if (this.#tabs.size >= MAX_TABS) throw new Error('tab_capacity_exceeded');
    if (tabRole === 'FLEET' && countRole([...this.#tabs.values()], 'FLEET') >= FLEET_TAB_CEILING) {
      throw new Error('tab_capacity_exceeded');
    }
    const tab = Object.freeze({
      tab_id: `tab_${crypto.randomUUID()}`,
      kind: String(kind),
      role: tabRole,
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
      // role is immutable: a tab's ownership class is fixed at creation by the
      // code path that created it (user navigation vs fleet provisioning).
      tab_id: current.tab_id,
      role: current.role,
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

  // Read-only capacity census probe (W3). Never creates a tab, never retries
  // provisioning, never mutates state: this is the evidence source that lets
  // the DevOS cycle and the fleet provisioner observe TRUE physical capacity
  // (including across restarts, where tab-close events are missed) instead of
  // learning about the wall only through failed createTab attempts.
  census() {
    const tabs = [...this.#tabs.values()];
    const byKind = {};
    for (const tab of tabs) byKind[tab.kind] = (byKind[tab.kind] || 0) + 1;
    const fleetTabs = countRole(tabs, 'FLEET');
    const userTabs = tabs.length - fleetTabs;
    return Object.freeze({
      schema: 'metaengine.browser.tab-census.v1',
      total_tabs: tabs.length,
      max_tabs: MAX_TABS,
      by_role: Object.freeze({ USER: userTabs, FLEET: fleetTabs }),
      by_kind: Object.freeze(byKind),
      fleet_tab_ceiling: FLEET_TAB_CEILING,
      fleet_tab_headroom: Math.max(0, FLEET_TAB_CEILING - fleetTabs),
      // How many more USER tabs can open right now given current occupancy.
      user_tab_headroom: Math.max(0, MAX_TABS - tabs.length),
      // Structural guarantee: slots the user can ALWAYS open, even with the
      // fleet parked at its ceiling.
      user_reserved_slots: Math.max(0, MAX_TABS - FLEET_TAB_CEILING),
      fleet_at_ceiling: fleetTabs >= FLEET_TAB_CEILING,
      total_at_wall: tabs.length >= MAX_TABS,
      fleet_tab_ids: Object.freeze(tabs.filter((tab) => tab.role === 'FLEET').map((tab) => tab.tab_id)),
      create_tab_attempted: false,
      release_signal: 'PHYSICAL_TAB_CLOSED',
      authority_effect: false,
    });
  }

  snapshot() {
    const census = this.census();
    return Object.freeze({
      tabs: [...this.#tabs.values()].map((x) => structuredClone(x)),
      selected_tab_id: this.#selectedId,
      max_tabs: MAX_TABS,
      census,
    });
  }
}
