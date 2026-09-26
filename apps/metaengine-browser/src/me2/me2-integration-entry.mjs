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
import { join } from 'node:path';
import { startMe2DaemonHost, stopMe2DaemonHost, me2DaemonStatus } from './me2-daemon-host.mjs';
import { startMe2FleetBridge, stopMe2FleetBridge, me2FleetBridgeStatus } from './me2-fleet-bridge.mjs';
import { startMe2MissionControl, stopMe2MissionControl, me2MissionControlStatus } from './me2-mission-control.mjs';
import { startMe2BrainAdapter, stopMe2BrainAdapter, me2BrainAdapterStatus } from './me2-brain-adapter.mjs';
import { startMe2SupervisorMeshBridge, stopMe2SupervisorMeshBridge, me2SupervisorMeshBridgeStatus } from './me2-supervisor-mesh-bridge.mjs';
import { me2FleetTabsHostStatus } from './me2-fleet-tabs-host.mjs';
import { startMe2UiHost, stopMe2UiHost, stopMe2UiHostAndWait, me2UiHostStatus } from './me2-ui-host.mjs';
import { startMe2UiGateway, stopMe2UiGateway, me2UiGatewayStatus } from './me2-ui-gateway.mjs';
import { me2SocketStatus } from './me2-socket-client.mjs';
import { ME2_REST_BASE } from './me2-daemon-host.mjs';

export const ME2_INTEGRATION_SCHEMA = 'metaengine.browser.me2.integration.v1';
export const ME2_INTEGRATION_VERSION = 'r50-unified-shell-1';

/** Ожидаемый контракт daemon'а (docs/electron-rebuild-plan.md, фаза A; аналогия — LSP initialize). */
export const ME2_EXPECTED_CONTRACT = 'me2-daemon-contract.v1';

let started = false;
let stoppedFlag = false;
// Concurrent Browser startup paths (final-runtime prewarm + primary window
// creation) must join the same ME2 boot. started means activation has begun;
// startPromise is the readiness barrier callers must await.
let startPromise = null;
let contractState = { checked: false, ok: false, contract: null, expected: ME2_EXPECTED_CONTRACT, capabilities: null, at: null, error: null };

function emitRow(row, { error = false } = {}) {
  const text = JSON.stringify(row);
  if (error || process.argv.some((a) => String(a || '').startsWith('--metaengine-'))) console.error(text);
  else console.log(text);
}

/**
 * R49 (фаза A): capabilities-handshake daemon ⇄ браузерная me2-плоскость.
 * Читает GET /state → contract + capabilities; при несовпадении — честный DEGRADED
 * (без шторма рестартов): наблюдение продолжает работать (read-only REST жив),
 * операции через socket будут честно падать с машинными кодами до починки контракта.
 */
export async function me2ContractHandshake() {
  contractState = { checked: false, ok: false, contract: null, expected: ME2_EXPECTED_CONTRACT, capabilities: null, at: new Date().toISOString(), error: null };
  try {
    const r = await fetch(`${ME2_REST_BASE}/state`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`me2_http_${r.status}`);
    const j = await r.json();
    contractState.checked = true;
    contractState.contract = j?.contract ?? null;
    contractState.capabilities = j?.capabilities ?? null;
    const ops = Array.isArray(j?.capabilities?.ops) ? j.capabilities.ops : [];
    const meshOk = ops.includes('mesh_heartbeat');
    const uiOk = j?.capabilities?.ui === '/ui';
    contractState.ok = contractState.contract === ME2_EXPECTED_CONTRACT && meshOk && uiOk;
    if (contractState.ok) {
      emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'ME2_CONTRACT_OK', contract: contractState.contract, daemon_version: j?.capabilities?.version ?? j?.meta?.version ?? null, ops: ops.length, ui: j?.capabilities?.ui ?? null });
    } else {
      emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'ME2_CONTRACT_MISMATCH', expected: ME2_EXPECTED_CONTRACT, actual: contractState.contract, mesh_heartbeat: meshOk, ui: uiOk, verdict: 'DEGRADED — операции честно падают до починки контракта' }, { error: true });
    }
  } catch (e) {
    contractState.error = String(e?.message || e).slice(0, 140);
    emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'ME2_CONTRACT_UNREACHABLE', error: contractState.error, verdict: 'DEGRADED' }, { error: true });
  }
  return contractState;
}

export function me2IntegrationStatus() {
  return {
    schema: ME2_INTEGRATION_SCHEMA,
    version: ME2_INTEGRATION_VERSION,
    started,
    stopped: stoppedFlag,
    contract: contractState,
    socket_client: me2SocketStatus(),
    ui_host: me2UiHostStatus(),
    ui_gateway: me2UiGatewayStatus(),
    daemon: me2DaemonStatus(),
    fleet_bridge: me2FleetBridgeStatus(),
    tabs_host: me2FleetTabsHostStatus(),
    mission_control: me2MissionControlStatus(),
    brain_adapter: me2BrainAdapterStatus(),
    supervisor_mesh_bridge: me2SupervisorMeshBridgeStatus(),
  };
}

async function startMe2IntegrationOnce({ app } = {}) {
  if (started || stoppedFlag) return me2IntegrationStatus();
  started = true;
  emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'ME2_INTEGRATION_START', version: ME2_INTEGRATION_VERSION });
  let userData = null;
  try {
    userData = app && typeof app.getPath === 'function' ? app.getPath('userData') : null;
  } catch { /* до ready пути могут быть недоступны — адаптеры честно DEGRADED */ }
  try {
    await startMe2DaemonHost({ dataDir: userData ? join(userData, 'me2-daemon') : null });
  } catch (e) {
    emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'DAEMON_HOST_START_FAILED', error: String(e?.message || e).slice(0, 200) }, { error: true });
  }
  // R49 (фаза A): capabilities-handshake до стартов мостов — честный контрактdaemon⇄браузер
  try {
    await me2ContractHandshake();
  } catch (e) {
    emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'CONTRACT_HANDSHAKE_FAILED', error: String(e?.message || e).slice(0, 200) }, { error: true });
  }
  // R50 (фаза B): хост панелей UI (усыновление/спавн) + встроенный gateway — ЕДИНЫЙ UI
  // (панели v5) работает внутри браузера без правок; фолбэк Mission Control — GET /ui daemon'а.
  try {
    await startMe2UiHost();
  } catch (e) {
    emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'UI_HOST_START_FAILED', error: String(e?.message || e).slice(0, 200) }, { error: true });
  }
  try {
    await startMe2UiGateway();
  } catch (e) {
    emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'UI_GATEWAY_START_FAILED', error: String(e?.message || e).slice(0, 200) }, { error: true });
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
  if (app && typeof app.once === 'function' && typeof app.on === 'function') {
    let quitDrainStarted = false;
    let quitDrainComplete = false;

    const stopNonUiPlanes = () => {
      stopMe2SupervisorMeshBridge();
      stopMe2BrainAdapter();
      stopMe2MissionControl();
      stopMe2FleetBridge();
      stopMe2UiGateway();
      stopMe2DaemonHost({ killChild: true });
    };

    app.on('before-quit', (event) => {
      if (quitDrainComplete) return;
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (quitDrainStarted) return;
      quitDrainStarted = true;
      stopNonUiPlanes();

      void stopMe2UiHostAndWait({ graceMs: 2500, forceMs: 2500 })
        .then((uiStatus) => {
          if (uiStatus?.shutdown?.confirmed !== true) {
            quitDrainStarted = false;
            emitRow({
              schema: ME2_INTEGRATION_SCHEMA,
              event: 'ME2_UI_SHUTDOWN_UNCONFIRMED',
              pid: uiStatus?.shutdown?.pid ?? null,
              verdict: 'QUIT_FENCED',
            }, { error: true });
            return;
          }
          quitDrainComplete = true;
          emitRow({
            schema: ME2_INTEGRATION_SCHEMA,
            event: 'ME2_QUIT_DRAIN_CONFIRMED',
            ui_pid: uiStatus?.shutdown?.pid ?? null,
            ui_force_kill: uiStatus?.shutdown?.forced === true,
          });
          app.quit();
        })
        .catch((error) => {
          quitDrainStarted = false;
          emitRow({
            schema: ME2_INTEGRATION_SCHEMA,
            event: 'ME2_QUIT_DRAIN_FAILED',
            error: String(error?.message || error).slice(0, 200),
            verdict: 'QUIT_FENCED',
          }, { error: true });
        });
    });

    app.once('will-quit', () => {
      // R85 single-runtime ownership: will-quit is now only an idempotent final
      // cleanup edge. before-quit already proved the Browser-owned UI exited,
      // so the next incarnation cannot race a stale Next server on :3000.
      stopNonUiPlanes();
      stopMe2UiHost({ killChild: true });
      emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'ME2_INTEGRATION_STOP' });
    });
  }
  return me2IntegrationStatus();
}

export async function startMe2Integration({ app } = {}) {
  // Important ordering: a concurrent caller must observe/join the in-flight
  // readiness barrier before consulting started. Returning status merely
  // because activation began caused a physical race where gateway/ui were
  // still IDLE and the Browser incorrectly opened the legacy recovery shell.
  if (startPromise) return startPromise;
  if (started || stoppedFlag) return me2IntegrationStatus();
  startPromise = startMe2IntegrationOnce({ app });
  try {
    return await startPromise;
  } finally {
    startPromise = null;
  }
}
