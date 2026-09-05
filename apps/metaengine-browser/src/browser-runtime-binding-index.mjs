export const BROWSER_RUNTIME_BINDING_INDEX_SCHEMA = 'metaengine.browser.runtime-binding-index.v1';

const TAB_ID_RE = /^tab_[0-9a-f-]{36}$/i;
const CELL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const PROCESS_KEY_RE = /^[1-9][0-9]*:[0-9]+(?:\.[0-9]+)?$/;

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function text(value, max = 240) {
  return value == null ? null : String(value).slice(0, max);
}

function positiveInt(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function exactTargetId(value, webContentsId) {
  const raw = text(value, 192);
  if (raw) return raw;
  return webContentsId ? `webcontents:${webContentsId}` : null;
}

function freezeBinding(row) {
  return Object.freeze({
    schema: 'metaengine.browser.runtime-binding.v1',
    tab_id: row.tab_id,
    cell_id: row.cell_id,
    cell_generation: row.cell_generation,
    binding_generation: row.binding_generation,
    web_contents_id: row.web_contents_id,
    renderer_pid: row.renderer_pid,
    renderer_process_key: row.renderer_process_key,
    renderer_process_identity_complete: row.renderer_process_identity_complete,
    target_id: row.target_id,
    document_generation: row.document_generation,
    semantic_revision: row.semantic_revision,
    provider: row.provider,
    role: row.role,
    valid: row.valid,
    invalid_reason: row.invalid_reason,
    bound_at: row.bound_at,
    observed_at: row.observed_at,
    page_content_exposed: false,
    input_values_exposed: false,
    execution_authority: false,
    command_leasing: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function processKeyByPid(snapshot) {
  const map = new Map();
  for (const row of Array.isArray(snapshot?.processes) ? snapshot.processes : []) {
    const pid = positiveInt(row?.pid);
    const key = text(row?.process_key, 128);
    if (pid && key && PROCESS_KEY_RE.test(key)) map.set(pid, key);
  }
  return map;
}

function semanticByTab(snapshot) {
  const map = new Map();
  for (const row of Array.isArray(snapshot?.semantic_plane?.targets) ? snapshot.semantic_plane.targets : []) {
    const tabId = String(row?.tab_id || '').toLowerCase();
    if (TAB_ID_RE.test(tabId)) map.set(tabId, row);
  }
  return map;
}

export class BrowserRuntimeBindingIndex {
  #clock;
  #maxBindings;
  #byTab = new Map();
  #tabByWebContents = new Map();
  #tabsByProcessKey = new Map();
  #generationByTab = new Map();
  #revision = 0;
  #lastReconciledAt = null;

  constructor({ clock = () => Date.now(), maxBindings = 128 } = {}) {
    if (typeof clock !== 'function') throw new Error('browser_runtime_binding_clock_required');
    this.#clock = clock;
    this.#maxBindings = boundedInt(maxBindings, 128, 1, 512);
  }

  #now() { return new Date(this.#clock()).toISOString(); }

  #detachIndexes(row) {
    if (!row) return;
    if (row.web_contents_id) this.#tabByWebContents.delete(row.web_contents_id);
    if (row.renderer_process_key) {
      const set = this.#tabsByProcessKey.get(row.renderer_process_key);
      if (set) {
        set.delete(row.tab_id);
        if (set.size === 0) this.#tabsByProcessKey.delete(row.renderer_process_key);
      }
    }
  }

  #attachIndexes(row) {
    if (row.web_contents_id) this.#tabByWebContents.set(row.web_contents_id, row.tab_id);
    if (row.renderer_process_key) {
      const set = this.#tabsByProcessKey.get(row.renderer_process_key) || new Set();
      set.add(row.tab_id);
      this.#tabsByProcessKey.set(row.renderer_process_key, set);
    }
  }

  bind({
    tab_id,
    cell_id = null,
    cell_generation = null,
    web_contents_id,
    renderer_pid = null,
    renderer_process_key = null,
    target_id = null,
    document_generation = 0,
    semantic_revision = 0,
    provider = null,
    role = null,
    observed_at = null,
  } = {}) {
    const tabId = String(tab_id || '').toLowerCase();
    if (!TAB_ID_RE.test(tabId)) throw new Error('browser_runtime_binding_tab_id_invalid');
    const webContentsId = positiveInt(web_contents_id);
    if (!webContentsId) throw new Error('browser_runtime_binding_webcontents_id_invalid');
    const rendererPid = positiveInt(renderer_pid);
    const processKey = text(renderer_process_key, 128);
    if (processKey && !PROCESS_KEY_RE.test(processKey)) throw new Error('browser_runtime_binding_process_key_invalid');
    const cellId = cell_id == null ? null : String(cell_id);
    if (cellId != null && !CELL_ID_RE.test(cellId)) throw new Error('browser_runtime_binding_cell_id_invalid');
    const cellGeneration = cell_generation == null ? null : positiveInt(cell_generation);
    if (cell_generation != null && !cellGeneration) throw new Error('browser_runtime_binding_cell_generation_invalid');

    const conflictTabId = this.#tabByWebContents.get(webContentsId);
    if (conflictTabId && conflictTabId !== tabId) this.invalidateTab(conflictTabId, 'WEB_CONTENTS_REBOUND');

    const current = this.#byTab.get(tabId) || null;
    const runtimeIdentityChanged = Boolean(current)
      && (current.web_contents_id !== webContentsId
        || current.renderer_pid !== rendererPid
        || current.renderer_process_key !== processKey
        || current.target_id !== exactTargetId(target_id, webContentsId));
    let generation = Number(this.#generationByTab.get(tabId) || 0);
    if (!current || runtimeIdentityChanged || current.valid !== true) generation += 1;
    if (generation < 1) generation = 1;
    this.#generationByTab.set(tabId, generation);

    if (current) this.#detachIndexes(current);
    const now = this.#now();
    const row = {
      tab_id: tabId,
      cell_id: cellId,
      cell_generation: cellGeneration,
      binding_generation: generation,
      web_contents_id: webContentsId,
      renderer_pid: rendererPid,
      renderer_process_key: processKey,
      renderer_process_identity_complete: Boolean(rendererPid && processKey),
      target_id: exactTargetId(target_id, webContentsId),
      document_generation: Math.max(0, Number(document_generation) || 0),
      semantic_revision: Math.max(0, Number(semantic_revision) || 0),
      provider: text(provider, 64),
      role: text(role, 64),
      valid: true,
      invalid_reason: null,
      bound_at: current && !runtimeIdentityChanged && current.valid === true ? current.bound_at : now,
      observed_at: observed_at ? String(observed_at) : now,
    };
    this.#byTab.set(tabId, row);
    this.#attachIndexes(row);
    this.#revision += 1;

    if (this.#byTab.size > this.#maxBindings) {
      const candidates = [...this.#byTab.values()]
        .filter((item) => item.valid !== true)
        .sort((a, b) => String(a.observed_at).localeCompare(String(b.observed_at)));
      while (this.#byTab.size > this.#maxBindings && candidates.length > 0) {
        const drop = candidates.shift();
        this.#detachIndexes(drop);
        this.#byTab.delete(drop.tab_id);
      }
      if (this.#byTab.size > this.#maxBindings) throw new Error('browser_runtime_binding_capacity_exceeded');
    }
    return freezeBinding(row);
  }

  reconcile({ tabs = [], process_snapshot = null, cell_by_tab = null } = {}) {
    const tabSet = new Set((Array.isArray(tabs) ? tabs : [])
      .map((row) => String(row?.tab_id || '').toLowerCase())
      .filter((value) => TAB_ID_RE.test(value)));
    const processKeys = processKeyByPid(process_snapshot);
    const semantics = semanticByTab(process_snapshot);
    const observedTabs = new Set();
    for (const wc of Array.isArray(process_snapshot?.web_contents) ? process_snapshot.web_contents : []) {
      const tabId = String(wc?.tab_id || '').toLowerCase();
      if (!TAB_ID_RE.test(tabId) || (tabSet.size > 0 && !tabSet.has(tabId))) continue;
      const webContentsId = positiveInt(wc?.web_contents_id);
      if (!webContentsId) continue;
      const rendererPid = positiveInt(wc?.os_pid);
      const semantic = semantics.get(tabId) || null;
      const cell = cell_by_tab instanceof Map ? cell_by_tab.get(tabId) : (cell_by_tab?.[tabId] || null);
      this.bind({
        tab_id: tabId,
        cell_id: cell?.cell_id || null,
        cell_generation: cell?.cell_generation || null,
        web_contents_id: webContentsId,
        renderer_pid: rendererPid,
        renderer_process_key: wc?.process_key || (rendererPid ? processKeys.get(rendererPid) || null : null),
        target_id: semantic?.target_id || `webcontents:${webContentsId}`,
        document_generation: semantic?.document_generation || 0,
        semantic_revision: semantic?.semantic_revision || 0,
        provider: cell?.provider || null,
        role: cell?.role || null,
        observed_at: process_snapshot?.observed_at || null,
      });
      observedTabs.add(tabId);
    }
    for (const [tabId, row] of this.#byTab) {
      if (row.valid === true && !observedTabs.has(tabId)) this.invalidateTab(tabId, 'NOT_PRESENT_IN_PROCESS_CENSUS');
    }
    this.#lastReconciledAt = this.#now();
    return this.snapshot();
  }

  invalidateTab(tabIdRaw, reason = 'INVALIDATED') {
    const tabId = String(tabIdRaw || '').toLowerCase();
    const current = this.#byTab.get(tabId);
    if (!current || current.valid !== true) return current ? freezeBinding(current) : null;
    this.#detachIndexes(current);
    const next = {
      ...current,
      valid: false,
      invalid_reason: text(reason, 160) || 'INVALIDATED',
      observed_at: this.#now(),
    };
    this.#byTab.set(tabId, next);
    this.#revision += 1;
    return freezeBinding(next);
  }

  invalidateWebContents(webContentsIdRaw, reason = 'WEB_CONTENTS_INVALIDATED') {
    const webContentsId = positiveInt(webContentsIdRaw);
    if (!webContentsId) return null;
    const tabId = this.#tabByWebContents.get(webContentsId);
    return tabId ? this.invalidateTab(tabId, reason) : null;
  }

  applyLifecycleEvent(event = {}) {
    const type = String(event?.type || '').toUpperCase();
    const webContentsId = positiveInt(event?.web_contents_id);
    const tabId = String(event?.tab_id || '').toLowerCase();
    if (['WEB_CONTENTS_DESTROYED','RENDER_PROCESS_GONE'].includes(type)) {
      if (webContentsId) return this.invalidateWebContents(webContentsId, type);
      if (TAB_ID_RE.test(tabId)) return this.invalidateTab(tabId, type);
    }
    return null;
  }

  tabIdForWebContents(webContentsIdRaw) {
    return this.#tabByWebContents.get(positiveInt(webContentsIdRaw)) || null;
  }

  resolveTab(tabIdRaw, { require_complete_process_identity = false } = {}) {
    const row = this.#byTab.get(String(tabIdRaw || '').toLowerCase());
    if (!row || row.valid !== true) return null;
    if (require_complete_process_identity && row.renderer_process_identity_complete !== true) return null;
    return freezeBinding(row);
  }

  assertExactRuntimeTarget({ tab_id, binding_generation, web_contents_id, renderer_process_key, target_id } = {}) {
    const current = this.resolveTab(tab_id, { require_complete_process_identity: true });
    if (!current) throw new Error('browser_runtime_binding_target_not_live');
    if (Number(binding_generation) !== current.binding_generation) throw new Error('browser_runtime_binding_generation_mismatch');
    if (Number(web_contents_id) !== current.web_contents_id) throw new Error('browser_runtime_binding_webcontents_mismatch');
    if (String(renderer_process_key || '') !== current.renderer_process_key) throw new Error('browser_runtime_binding_process_incarnation_mismatch');
    if (String(target_id || '') !== current.target_id) throw new Error('browser_runtime_binding_target_id_mismatch');
    return current;
  }

  bindingsForProcess(processKeyRaw) {
    const key = String(processKeyRaw || '');
    const ids = this.#tabsByProcessKey.get(key) || new Set();
    return Object.freeze([...ids].map((tabId) => this.resolveTab(tabId)).filter(Boolean));
  }

  snapshot() {
    const rows = [...this.#byTab.values()].map(freezeBinding);
    return Object.freeze({
      schema: BROWSER_RUNTIME_BINDING_INDEX_SCHEMA,
      revision: this.#revision,
      last_reconciled_at: this.#lastReconciledAt,
      binding_count: rows.length,
      live_binding_count: rows.filter((row) => row.valid).length,
      exact_lookup_complexity: 'O(1)',
      pid_reuse_protection: 'PID_PLUS_PROCESS_CREATION_TIME',
      stale_binding_execution_allowed: false,
      incomplete_process_identity_execution_allowed: false,
      bindings: rows,
      page_content_exposed: false,
      input_values_exposed: false,
      execution_authority: false,
      command_leasing: false,
      second_scheduler: false,
      authority_effect: false,
    });
  }
}
