/**
 * ME2 Fleet Tabs Host (R41 smart merge) — узкий мост capability от main.mjs к ME2-плоскости.
 *
 * Зачем: вкладки с WebContentsView создаёт ТОЛЬКО createTab() внутри main.mjs (там регистрация
 * view, wire-навигация, snapshot-публикация). ME2-плоскость не переписывает этот механизм —
 * она получает УЗКУЮ capability (registry для честного census + createTab для открытия вкладок)
 * через этот общий синглтон. main.mjs регистрирует хост одним аддитивным guarded-вызовом;
 * me2-mission-control.mjs читает его при старте.
 *
 * Fail-open по построению: без регистрации хоста Mission Control честно переходит в DEGRADED
 * и браузер живёт ровно как раньше. Zero-authority: хост не даёт доступа к self-update,
 * single-instance, окнам и сессиям — только вкладки (createTab/select) и census.
 */

const ME2_FLEET_TABS_HOST_SCHEMA = 'metaengine.browser.me2.fleet-tabs-host.v1';

let host = null;
let registeredAt = null;
let registerCount = 0;
let lastError = null;

function emitRow(row, { error = false } = {}) {
  const text = JSON.stringify(row);
  if (error || process.argv.some((a) => String(a || '').startsWith('--metaengine-'))) console.error(text);
  else console.log(text);
}

/**
 * Регистрация хоста (вызывает main.mjs). Идемпотентно: повторная регистрация
 * обновляет capability (после рестартов модулей) и не дублирует состояние.
 */
export function me2FleetTabsSetHost({ registry, createTab, closeTab = null, selectTab = null, resolveIdentity = null } = {}) {
  if (!registry || typeof registry.snapshot !== 'function' || typeof registry.census !== 'function') {
    lastError = 'registry_invalid';
    emitRow({ schema: ME2_FLEET_TABS_HOST_SCHEMA, event: 'HOST_REGISTER_REJECTED', reason: lastError }, { error: true });
    return me2FleetTabsHostStatus();
  }
  if (typeof createTab !== 'function') {
    lastError = 'createTab_invalid';
    emitRow({ schema: ME2_FLEET_TABS_HOST_SCHEMA, event: 'HOST_REGISTER_REJECTED', reason: lastError }, { error: true });
    return me2FleetTabsHostStatus();
  }
  if (closeTab != null && typeof closeTab !== 'function') {
    lastError = 'closeTab_invalid';
    emitRow({ schema: ME2_FLEET_TABS_HOST_SCHEMA, event: 'HOST_REGISTER_REJECTED', reason: lastError }, { error: true });
    return me2FleetTabsHostStatus();
  }
  if (selectTab != null && typeof selectTab !== 'function') {
    lastError = 'selectTab_invalid';
    emitRow({ schema: ME2_FLEET_TABS_HOST_SCHEMA, event: 'HOST_REGISTER_REJECTED', reason: lastError }, { error: true });
    return me2FleetTabsHostStatus();
  }
  if (resolveIdentity != null && typeof resolveIdentity !== 'function') {
    lastError = 'resolveIdentity_invalid';
    emitRow({ schema: ME2_FLEET_TABS_HOST_SCHEMA, event: 'HOST_REGISTER_REJECTED', reason: lastError }, { error: true });
    return me2FleetTabsHostStatus();
  }
  host = Object.freeze({
    registry,
    createTab: (input, opts) => createTab(input, opts),
    closeTab: closeTab ? (tabId) => closeTab(tabId) : null,
    selectTab: selectTab ? (tabId) => selectTab(tabId) : null,
    resolveIdentity: resolveIdentity ? (tabId) => resolveIdentity(tabId) : null,
  });
  registerCount += 1;
  registeredAt = new Date().toISOString();
  lastError = null;
  emitRow({ schema: ME2_FLEET_TABS_HOST_SCHEMA, event: 'HOST_REGISTERED', registration: registerCount, at: registeredAt });
  return me2FleetTabsHostStatus();
}

export function me2FleetTabsGetHost() {
  return host;
}

export function me2FleetTabsResolveIdentity(tabId) {
  if (!host?.resolveIdentity) return null;
  let row = null;
  try { row = host.resolveIdentity(String(tabId || '')); } catch { return null; }
  if (!row || row.exact_identity !== true || !row.tab_id || !Number.isSafeInteger(Number(row.web_contents_id))) return null;
  return Object.freeze({
    schema: 'metaengine.browser.me2.native-conversation-identity.v1',
    tab_id: String(row.tab_id),
    browsercell_identity: row.browsercell_identity == null ? null : String(row.browsercell_identity),
    browsercell_identity_source: row.browsercell_identity_source == null ? null : String(row.browsercell_identity_source),
    web_contents_id: Number(row.web_contents_id),
    webcontents_binding_generation: Number(row.webcontents_binding_generation || row.binding_generation || 0) || null,
    runtime_binding_generation: Number(row.runtime_binding_generation || 0) || null,
    cell_id: row.cell_id == null ? null : String(row.cell_id),
    cell_generation: Number(row.cell_generation || 0) || null,
    renderer_process_key: row.renderer_process_key == null ? null : String(row.renderer_process_key),
    target_id: row.target_id == null ? null : String(row.target_id),
    document_generation: Math.max(0, Number(row.document_generation || 0)),
    semantic_revision: Math.max(0, Number(row.semantic_revision || 0)),
    runtime_binding_live: row.runtime_binding_live === true,
    runtime_identity_complete: row.runtime_identity_complete === true,
    runtime_binding_source: row.runtime_binding_source == null ? null : String(row.runtime_binding_source),
    identity_lookup_complexity: row.identity_lookup_complexity === 'O(1)' ? 'O(1)' : null,
    exact_identity: true,
    selected_tab_fallback: false,
    url_identity_fallback: false,
    title_identity_fallback: false,
    webcontents_target_fallback: false,
    execution_authority: false,
    command_leasing: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function me2FleetTabsHostStatus() {
  return {
    schema: ME2_FLEET_TABS_HOST_SCHEMA,
    registered: host !== null,
    registered_at: registeredAt,
    register_count: registerCount,
    last_error: lastError,
    physical_close_registered: typeof host?.closeTab === 'function',
    select_registered: typeof host?.selectTab === 'function',
    exact_identity_resolver_registered: typeof host?.resolveIdentity === 'function',
    canonical_runtime_binding_only: true,
    browsercell_fallback_allowed: false,
    target_fallback_allowed: false,
    second_tab_registry: false,
    authority_effect: false,
  };
}
