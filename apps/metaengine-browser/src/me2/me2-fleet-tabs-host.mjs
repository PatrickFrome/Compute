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
export function me2FleetTabsSetHost({ registry, createTab } = {}) {
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
  host = Object.freeze({
    registry,
    createTab: (input, opts) => createTab(input, opts),
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

export function me2FleetTabsHostStatus() {
  return {
    schema: ME2_FLEET_TABS_HOST_SCHEMA,
    registered: host !== null,
    registered_at: registeredAt,
    register_count: registerCount,
    last_error: lastError,
    authority_effect: false,
  };
}
