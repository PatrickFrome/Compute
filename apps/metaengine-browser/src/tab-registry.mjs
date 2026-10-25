import crypto from 'node:crypto';
import {readAgentResourceAdmission} from './agent-resource-admission.mjs';

// No per-role or total tab-count quota. Current memory admission applies
// before a physical tab is created; logical agents can remain queued.
export const FLEET_TAB_CEILING = null;
export const MAX_TABS = null;
export const SUPERVISOR_TAB_CEILING = null;
const TAB_ROLES = Object.freeze(['USER', 'FLEET', 'SUPERVISOR']);
// Continuity provenance stamp (P0 repair, point 4): tabs created by a
// self-update session-continuity restore attempt carry the attempt's
// continuity_id so post-restore cleanup can close ONLY provable duplicates
// of that attempt. Legacy tabs (created before this field existed, including
// the 32 live tabs of the 2026-09-17 incident) never match and are never
// closed by the cleanup planner.
const CREATED_BY_CONTINUITY_ID_RE = /^[a-z0-9-]{8,120}$/i;

function countRole(tabs, role) {
  return tabs.filter((tab) => String(tab.role || 'USER') === role).length;
}

export class TabRegistry {
  #tabs = new Map();
  #selectedId = null;
  #readResources;
  constructor({readResources=readAgentResourceAdmission}={}) {
    if(typeof readResources!=='function')throw Error('tab_resource_reader_invalid');
    this.#readResources=readResources;
  }

  create({ url, kind = 'USER_WEB', title = '', role = 'USER', created_by_continuity_id = null } = {}) {
    const tabRole = String(role || 'USER').toUpperCase();
    if (!TAB_ROLES.includes(tabRole)) throw new Error('tab_role_invalid');
    const continuityProvenance = String(created_by_continuity_id || '');
    if (continuityProvenance && !CREATED_BY_CONTINUITY_ID_RE.test(continuityProvenance)) {
      throw new Error('tab_created_by_continuity_id_invalid');
    }
    // A denied resource observation is a deterministic pre-effect hold.
    if(this.#readResources().physical_start_allowed!==true)throw new Error('tab_capacity_exceeded');
    const tabId = `tab_${crypto.randomUUID()}`;
    const tab = Object.freeze({
      tab_id: tabId,
      // R84 Desktop convergence: BrowserCell identity is allocated by the
      // canonical TabRegistry at the same logical creation boundary as tab_id.
      // It is never inferred later from URL/title/selection/WebContents and no
      // second registry is introduced. Physical reincarnation is fenced
      // independently by BrowserRuntimeBindingIndex.binding_generation.
      browser_cell_id: `cell:${crypto.randomUUID()}`,
      browser_cell_generation: 1,
      kind: String(kind),
      role: tabRole,
      url: String(url),
      title: String(title || ''),
      created_at: new Date().toISOString(),
      ...(continuityProvenance ? { created_by_continuity_id: continuityProvenance } : {}),
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
      // created_by_continuity_id is likewise immutable provenance.
      tab_id: current.tab_id,
      role: current.role,
      browser_cell_id: current.browser_cell_id,
      browser_cell_generation: current.browser_cell_generation,
      created_at: current.created_at,
      ...(current.created_by_continuity_id ? { created_by_continuity_id: current.created_by_continuity_id } : {}),
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
    // R41: явные счётчики по ролям (SUPERVISOR аддитивен; USER больше не «остаток»,
    // а честный подсчёт — семантика для чистых USER/FLEET-флотов не изменилась)
    const fleetTabs = countRole(tabs, 'FLEET');
    const supervisorTabs = countRole(tabs, 'SUPERVISOR');
    const userTabs = countRole(tabs, 'USER');
    const resources=this.#readResources(),headroom=resources.memory_headroom;
    return Object.freeze({
      schema: 'metaengine.browser.tab-census.v1',
      total_tabs: tabs.length,
      max_tabs: tabs.length+headroom,
      agent_count_limit: null,
      by_role: Object.freeze({ USER: userTabs, FLEET: fleetTabs, SUPERVISOR: supervisorTabs }),
      by_kind: Object.freeze(byKind),
      fleet_tab_ceiling: fleetTabs+headroom,
      fleet_tab_headroom: headroom,
      // How many more USER tabs can open right now given current occupancy.
      user_tab_headroom: headroom,
      // Resource headroom is shared; no artificial role reservation.
      user_reserved_slots: 0,
      fleet_at_ceiling: headroom===0,
      total_at_wall: headroom===0,
      fleet_tab_ids: Object.freeze(tabs.filter((tab) => tab.role === 'FLEET').map((tab) => tab.tab_id)),
      // R41: SUPERVISOR-квота Mission Control (аддитивные поля, старые потребители не читают)
      supervisor_tab_ceiling: supervisorTabs+headroom,
      supervisor_tab_headroom: headroom,
      supervisor_tab_ids: Object.freeze(tabs.filter((tab) => tab.role === 'SUPERVISOR').map((tab) => tab.tab_id)),
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
      max_tabs: census.max_tabs,
      agent_count_limit: null,
      census,
    });
  }
}
