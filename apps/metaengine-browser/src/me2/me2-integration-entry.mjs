/**
 * ME2 Integration Entry (R40+R41+R42 smart merge) — единая точка включения ME2-плоскости в браузере.
 *
 * Принципы (унаследованы от механизмов браузера, не ломают ни один из них):
 *   • fail-open: ME2_INTEGRATION=0 или отсутствие рантайма → браузер живёт как раньше;
 *   • zero authority: никаких эффектов на self-update authority, single-instance,
 *     second-scheduler — только дочерний сервис + наблюдение + ШТАТНОЕ открытие вкладок
 *     (R41: TabRegistry.create(role='SUPERVISOR') — Mission Control, браузер сам открывает
 *     чат-агентов прямо в сайте);
 *   • lifecycle-строки — в stdout-шину (schema-контракт final-runtime).
 *
 * Запуск: final-runtime-entry.mjs → startMe2Integration({ app }) после main-entry.
 * R41: main.mjs аддитивно регистрирует capability вкладок через me2-fleet-tabs-host.
 */
import { startMe2DaemonHost, stopMe2DaemonHost, me2DaemonStatus } from './me2-daemon-host.mjs';
import { startMe2FleetBridge, stopMe2FleetBridge, me2FleetBridgeStatus } from './me2-fleet-bridge.mjs';
import { startMe2MissionControl, stopMe2MissionControl, me2MissionControlStatus } from './me2-mission-control.mjs';
import { startMe2BrainAdapter, stopMe2BrainAdapter, me2BrainAdapterStatus } from './me2-brain-adapter.mjs';
import { startMe2SupervisorMeshBridge, stopMe2SupervisorMeshBridge, me2SupervisorMeshBridgeStatus } from './me2-supervisor-mesh-bridge.mjs';
import { me2FleetTabsHostStatus } from './me2-fleet-tabs-host.mjs';

export const ME2_INTEGRATION_SCHEMA = 'metaengine.browser.me2.integration.v1';
export const ME2_INTEGRATION_VERSION = 'r41-r42-smart-merge-1';

let started = false;
let stoppedFlag = false;

function emitRow(row, { error = false } = {}) {
  const text = JSON.stringify(row);
  if (error || process.argv.some((a) => String(a || '').startsWith('--metaengine-'))) console.error(text);
  else console.log(text);
}

export function me2IntegrationStatus() {
  return {
    schema: ME2_INTEGRATION_SCHEMA,
    version: ME2_INTEGRATION_VERSION,
    started,
    stopped: stoppedFlag,
    daemon: me2DaemonStatus(),
    fleet_bridge: me2FleetBridgeStatus(),
    tabs_host: me2FleetTabsHostStatus(),
    mission_control: me2MissionControlStatus(),
    brain_adapter: me2BrainAdapterStatus(),
    supervisor_mesh_bridge: me2SupervisorMeshBridgeStatus(),
  };
}

export async function startMe2Integration({ app } = {}) {
  if (started || stoppedFlag) return me2IntegrationStatus();
  started = true;
  emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'ME2_INTEGRATION_START', version: ME2_INTEGRATION_VERSION });
  try {
    await startMe2DaemonHost();
  } catch (e) {
    emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'DAEMON_HOST_START_FAILED', error: String(e?.message || e).slice(0, 200) }, { error: true });
  }
  try {
    startMe2FleetBridge();
  } catch (e) {
    emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'FLEET_BRIDGE_START_FAILED', error: String(e?.message || e).slice(0, 200) }, { error: true });
  }
  // R41: браузер сам открывает Mission Control (role='SUPERVISOR') и вкладки чат-агентов (role='FLEET')
  try {
    startMe2MissionControl();
  } catch (e) {
    emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'MISSION_CONTROL_START_FAILED', error: String(e?.message || e).slice(0, 200) }, { error: true });
  }
  // R42a: память brain ⇄ mem-economy (чтение checkpoint'а мозга, sidecar блока памяти ME2)
  let userData = null;
  try {
    userData = app && typeof app.getPath === 'function' ? app.getPath('userData') : null;
  } catch { /* до ready пути могут быть недоступны — адаптеры честно DEGRADED */ }
  try {
    startMe2BrainAdapter({ userData });
  } catch (e) {
    emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'BRAIN_ADAPTER_START_FAILED', error: String(e?.message || e).slice(0, 200) }, { error: true });
  }
  // R42b: двусторонний supervisor-mesh ⇄ agentChatSupervisorTick (epoch-фенсы штатные)
  try {
    startMe2SupervisorMeshBridge({ userData });
  } catch (e) {
    emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'MESH_BRIDGE_START_FAILED', error: String(e?.message || e).slice(0, 200) }, { error: true });
  }
  if (app && typeof app.once === 'function') {
    app.once('will-quit', () => {
      // деликатное завершение: хост НЕ убивает daemon по умолчанию (daemon переживает
      // перезапуск браузера — его данные в SQLite, наследие постоянных сессий)
      stopMe2SupervisorMeshBridge();
      stopMe2BrainAdapter();
      stopMe2MissionControl();
      stopMe2FleetBridge();
      stopMe2DaemonHost({ killChild: false });
      emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'ME2_INTEGRATION_STOP' });
    });
  }
  return me2IntegrationStatus();
}
