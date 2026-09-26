import crypto from 'node:crypto';

// Closed-loop audit fix (fleet scale): the per-role quota and the shared tab
// wall are now operator-tunable through the environment so the fleet can grow
// past the historical small-constant bounds on capable machines
// (A2_FLEET_TAB_CEILING, A2_MAX_TABS). Defaults are raised (fleet 16 -> 28,
// total 32 -> 48) — the elastic governor only ever grows the fleet on
// server-authoritative demand, so a higher ceiling never means idle tabs.
// The human user keeps MAX_TABS - FLEET_TAB_CEILING = 20 reserved slots at
// all times (was 16).
function envBoundedInt(name, fallback, min, max) {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}
export const FLEET_TAB_CEILING = envBoundedInt('A2_FLEET_TAB_CEILING', 28, 4, 64);
export const MAX_TABS = envBoundedInt('A2_MAX_TABS', 48, 8, 128);
// ME2 smart merge (R41): SUPERVISOR role — вкладка Mission Control, которую браузер открывает
// сам (TabRegistry.create(role='SUPERVISOR') — её собственный крошечный потолок, ОТДЕЛЬНЫЙ от
// FLEET: супервизорская вкладка не съедает флот-квоту и не ломает пользовательскую бронь).
// Все существующие контракты USER/FLEET не тронуты (аддитивно, census остаётся честным).
export const SUPERVISOR_TAB_CEILING = envBoundedInt('A2_SUPERVISOR_TAB_CEILING', 4, 1, 16);
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

  create({ url, kind = 'USER_WEB', title = '', role = 'USER', created_by_continuity_id = null } = {}) {
    const tabRole = String(role || 'USER').toUpperCase();
    if (!TAB_ROLES.includes(tabRole)) throw new Error('tab_role_invalid');
    const continuityProvenance = String(created_by_continuity_id || '');
    if (continuityProvenance && !CREATED_BY_CONTINUITY_ID_RE.test(continuityProvenance)) {
      throw new Error('tab_created_by_continuity_id_invalid');
    }
    // Deterministic pre-effect capacity contract: both the shared wall and the
    // per-kind fleet ceiling surface the SAME error string, so the fleet
    // provisioner's existing classification (deterministic no-effect, never
    // ambiguous) keeps working without modification.
    if (this.#tabs.size >= MAX_TABS) throw new Error('tab_capacity_exceeded');
    if (tabRole === 'FLEET' && countRole([...this.#tabs.values()], 'FLEET') >= FLEET_TAB_CEILING) {
      throw new Error('tab_capacity_exceeded');
    }
    if (tabRole === 'SUPERVISOR' && countRole([...this.#tabs.values()], 'SUPERVISOR') >= SUPERVISOR_TAB_CEILING) {
      throw new Error('tab_capacity_exceeded');
    }
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
    return Object.freeze({
      schema: 'metaengine.browser.tab-census.v1',
      total_tabs: tabs.length,
      max_tabs: MAX_TABS,
      by_role: Object.freeze({ USER: userTabs, FLEET: fleetTabs, SUPERVISOR: supervisorTabs }),
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
      // R41: SUPERVISOR-квота Mission Control (аддитивные поля, старые потребители не читают)
      supervisor_tab_ceiling: SUPERVISOR_TAB_CEILING,
      supervisor_tab_headroom: Math.max(0, SUPERVISOR_TAB_CEILING - supervisorTabs),
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
      max_tabs: MAX_TABS,
      census,
    });
  }
}
