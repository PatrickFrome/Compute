/**
 * ME2 Integration Entry (R40+R41+R42 smart merge) — единая точка включения ME2-плоскости в браузере.
 *
 * Принципы (унаследованы от механизмов браузера, не ломают ни один из них):
 *   • fail-open: ME2_INTEGRATION=0 или отсутствие compatibility probe/UI → Browser живёт дальше;
 *   • zero authority: packaged ME2 exposes only a read-only loopback compatibility projection;
 *   • Native Browser exclusively owns Agent sessions, fleet, tasks, Brain memory, scheduler and effects;
 *   • lifecycle-строки — в stdout-шину (schema-контракт final-runtime).
 *
 * Запуск: final-runtime-entry.mjs → startMe2Integration({ app }) после main-entry.
 */
import { join } from 'node:path';
import { startMe2DaemonHost, stopMe2DaemonHost, me2DaemonStatus } from './me2-daemon-host.mjs';
import { startMe2UiHost, stopMe2UiHost, stopMe2UiHostAndWait, me2UiHostStatus } from './me2-ui-host.mjs';
import { startMe2UiGateway, stopMe2UiGateway, me2UiGatewayStatus } from './me2-ui-gateway.mjs';
import { ME2_REST_BASE } from './me2-daemon-host.mjs';

export const ME2_INTEGRATION_SCHEMA = 'metaengine.browser.me2.integration.v1';
export const ME2_INTEGRATION_VERSION = 'r97-native-browser-authority-1';

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
    const uiOk = j?.capabilities?.ui === '/ui';
    const probe = j?.browser_probe || null;
    const probeSafe = probe?.boot_mode === 'probe'
      && probe?.read_only === true
      && probe?.model_execution_enabled === false
      && probe?.provider_api_enabled === false
      && probe?.provider_network_enabled === false
      && probe?.agentchat_mutation_enabled === false
      && probe?.scheduler_authority === false
      && probe?.browser_actuation_authority === false
      && probe?.command_mutation_enabled === false
      && probe?.token_mutation_enabled === false
      && probe?.filesystem_mutation_enabled === false
      && probe?.sql_mutation_enabled === false
      && probe?.legacy_daemon_module_loaded === false
      && probe?.socket_mutation_surface_enabled === false
      && probe?.authority_effect === false;
    contractState.ok = contractState.contract === ME2_EXPECTED_CONTRACT && uiOk && probeSafe;
    contractState.browser_probe = probeSafe ? structuredClone(probe) : null;
    if (contractState.ok) {
      emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'ME2_CONTRACT_OK', contract: contractState.contract, daemon_version: j?.capabilities?.version ?? j?.meta?.version ?? null, ops: ops.length, ui: j?.capabilities?.ui ?? null, browser_probe: contractState.browser_probe, agentchat_authority: false });
    } else {
      emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'ME2_CONTRACT_MISMATCH', expected: ME2_EXPECTED_CONTRACT, actual: contractState.contract, ui: uiOk, probe_safe: probeSafe, verdict: 'DEGRADED — local DevOS/UI contract unavailable or unsafe daemon authority' }, { error: true });
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
    socket_client: { state: 'REMOVED_STANDALONE_PROBE_HAS_NO_SOCKET', authority_effect: false },
    ui_host: me2UiHostStatus(),
    ui_gateway: me2UiGatewayStatus(),
    daemon: me2DaemonStatus(),
    fleet_bridge: { state: 'REMOVED_NATIVE_BROWSER_AUTHORITY', authority_effect: false },
    mission_control: { state: 'REMOVED_NATIVE_BROWSER_FLEET_AUTHORITY', scheduler_authority: false, browser_command_authority: false, authority_effect: false },
    brain_adapter: { state: 'REMOVED_NATIVE_BROWSER_BRAIN_MEMORY_AUTHORITY', authority_effect: false },
    supervisor_mesh_bridge: { state: 'REMOVED_NATIVE_BROWSER_AUTHORITY', authority_effect: false },
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
    await startMe2DaemonHost({
      dataDir: userData ? join(userData, 'me2-daemon') : null,
      packaged: app?.isPackaged === true,
      resourcesPath: process.resourcesPath || '',
    });
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
  emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'DAEMON_AGENTCHAT_FLEET_BRIDGE_REMOVED', replacement: 'NATIVE_BROWSER_FLEET', authority_effect: false });
  emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'DAEMON_MISSION_CONTROL_REMOVED', replacement: 'NATIVE_BROWSER_FLEET_AND_SUPERVISOR', authority_effect: false });
  emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'DAEMON_MEMORY_BRIDGE_REMOVED', replacement: 'NATIVE_BROWSER_BRAIN_MEMORY', authority_effect: false });
  emitRow({ schema: ME2_INTEGRATION_SCHEMA, event: 'DAEMON_AGENTCHAT_SUPERVISOR_BRIDGE_REMOVED', replacement: 'NATIVE_BROWSER_SUPERVISOR_MESH', authority_effect: false });
  if (app && typeof app.once === 'function' && typeof app.on === 'function') {
    let quitDrainStarted = false;
    let quitDrainComplete = false;

    const stopNonUiPlanes = () => {
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
