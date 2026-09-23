/**
 * ME2 Integration Entry (R40 smart merge) — единая точка включения ME2-плоскости в браузере.
 *
 * Принципы (унаследованы от механизмов браузера, не ломают ни один из них):
 *   • fail-open: ME2_INTEGRATION=0 или отсутствие рантайма → браузер живёт как раньше;
 *   • zero authority: никаких эффектов на self-update authority, single-instance,
 *     second-scheduler — только дочерний сервис + наблюдение (read-only к браузеру);
 *   • lifecycle-строки — в stdout-шину (schema-контракт final-runtime).
 *
 * Запуск: final-runtime-entry.mjs → startMe2Integration({ app }) после main-entry.
 */
import { startMe2DaemonHost, stopMe2DaemonHost, me2DaemonStatus } from './me2-daemon-host.mjs';
import { startMe2FleetBridge, stopMe2FleetBridge, me2FleetBridgeStatus } from './me2-fleet-bridge.mjs';

export const ME2_INTEGRATION_SCHEMA = 'metaengine.browser.me2.integration.v1';
export const ME2_INTEGRATION_VERSION = 'r40-smart-merge-1';

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
  if (app && typeof app.once === 'function') {
    app.once('will-quit', () => {
      // деликатное завершение: хост НЕ убивает daemon по умолчанию (daemon переживает
      // перезапуск браузера — его данные в SQLite, наследие постоянных сессий)
      stopMe2FleetBridge();
      stopMe2DaemonHost({ killChild: false });
      emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'ME2_INTEGRATION_STOP' });
    });
  }
  return me2IntegrationStatus();
}
