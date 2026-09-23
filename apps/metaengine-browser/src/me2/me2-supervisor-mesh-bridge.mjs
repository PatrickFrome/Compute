/**
 * ME2 Supervisor Mesh Bridge (R42 smart merge) — двусторонний контур
 * supervisor-mesh (браузер) ⇄ agentChatSupervisorTick (ME2 daemon).
 *
 * Наследие supervisor-mesh / keepalive / epoch-fence: у браузера есть mesh супервизоров
 * с epoch-фенсами (смена координатора → mesh_epoch+1, устаревший фенс честно отклоняется);
 * у ME2 — вечно-живущие чаты-супервизоры (agentChatSupervisorTick: перерождение мёртвых +
 * автономные ходы). Мост СВЯЗЫВАЕТ их двусторонне, не переписывая ни одну плоскость:
 *
 *   mesh → daemon: читает состояние mesh (файл состояния или безопасные кандидаты в userData),
 *     строит фенс штатным bindCoordinationFence (схема metaengine.supervisor-mesh.fence.v1) и
 *     стучится в daemon (POST /agentchat op:'mesh_heartbeat'); daemon хранит состояние и
 *     честно помечает mesh_epoch_advanced, если эпоха продвинулась.
 *   daemon → mesh: ответ heartbeat'а несёт supervisor_tick (последний тик
 *     agentChatSupervisorTick) — мост публикует его в stdout-шину браузера (наследие
 *     outcome river) и держит в статусе; оператор и mesh-потребители видят флот ME2.
 *
 * Epoch-фенсы: свой фенс биндится от ПРОЧИТАННОГО mesh_epoch; если во время полёта эпоха
 * сменилась (файл перечитан) — assertCoordinationFenceCurrent кидает supervisor_mesh_fence_*
 * и ход честно помечается FENCE_STALE (без dispatch в daemon) до следующего тика.
 * Zero-authority: мост не координирует mesh, не двигает вкладки и не трогает self-update.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ME2_REST_BASE } from './me2-daemon-host.mjs';
import { me2SocketOp } from './me2-socket-client.mjs';
import { bindCoordinationFence, assertCoordinationFenceCurrent } from '../supervisor-mesh-epoch-fence.mjs';

export const ME2_SUPERVISOR_MESH_BRIDGE_SCHEMA = 'metaengine.browser.me2.supervisor-mesh-bridge.v1';

const SYNC_MS = Number(process.env.ME2_MESH_SYNC_MS || 30000);
const FIRST_DELAY_MS = Number(process.env.ME2_MESH_FIRST_DELAY_MS || 15000);
const MESH_STATE_FILE = process.env.ME2_MESH_STATE_FILE || null; // если хост назвал файл иначе
const EVENT_ID = 'me2-agentchat-supervisor-tick';

let syncTimer = null;
let firstTimer = null;
let stopped = false;
let lastMeshState = null;   // { mesh_epoch, coordinator_supervisor_id, supervisors[] }
let lastTick = null;        // supervisor_tick из ответа daemon'а
let lastFenceStale = null;  // { reason, at } — последний устаревший фенс
let lastHeartbeatAt = null;
let stats = { heartbeats_ok: 0, heartbeats_fail: 0, fence_stale: 0 };
let startedAt = null;
let lastError = null;

function emitRow(row_, { error = false } = {}) {
  const text = JSON.stringify(row_);
  if (error || process.argv.some((a) => String(a || '').startsWith('--metaengine-'))) console.error(text);
  else console.log(text);
}

function row_(event, patch = {}) {
  return { schema: ME2_SUPERVISOR_MESH_BRIDGE_SCHEMA, event, ...patch };
}

async function me2Fetch(path_, init) {
  const r = await fetch(`${ME2_REST_BASE}${path_}`, { signal: AbortSignal.timeout(8000), ...init });
  if (!r.ok) throw new Error(`me2_http_${r.status}`);
  return r.json();
}

/**
 * Чтение состояния mesh: штатный провайдер — файл состояния SupervisorMeshRuntime
 * (schema metaengine.supervisor-mesh.state.v1/v2). Кандидаты: явный env, типовые имена
 * в userData. Ничего не нашли → null (честное отсутствие mesh, heartbeat уходит без mesh).
 */
function readMeshState(userData) {
  const candidates = [
    MESH_STATE_FILE,
    userData ? path.join(userData, 'metaengine-supervisor-mesh-state-v2.json') : null,
    userData ? path.join(userData, 'metaengine-supervisor-mesh-state.json') : null,
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size < 2 || stat.size > 8 * 1024 * 1024) continue;
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!j || !String(j.schema || '').startsWith('metaengine.supervisor-mesh.state.')) continue;
      const supervisors = (Array.isArray(j.supervisors) ? j.supervisors : [])
        .map((s) => String(s?.supervisor_id || '').slice(0, 80)).filter(Boolean).slice(0, 32);
      return {
        mesh_epoch: Math.max(1, Number(j.mesh_epoch) || 1),
        coordinator_supervisor_id: j.coordinator_supervisor_id ? String(j.coordinator_supervisor_id).slice(0, 80) : null,
        supervisors,
      };
    } catch { /* следующий кандидат */ }
  }
  return null;
}

/** Один двусторонний ход: mesh-состояние → daemon (с фенсом), supervisor_tick → шина браузера. */
export async function me2MeshSync(userData) {
  // 1. Читаем mesh ДО бинда фенса
  lastMeshState = readMeshState(userData);
  const epoch = lastMeshState?.mesh_epoch ?? 1;
  const coordinator = lastMeshState?.coordinator_supervisor_id ?? 'me2-mesh-bridge-observer';
  // 2. Штатный epoch-фенс браузера (схема metaengine.supervisor-mesh.fence.v1)
  const fence = bindCoordinationFence({ meshEpoch: epoch, coordinatorSupervisorId: coordinator, eventId: EVENT_ID, deliveryId: `${EVENT_ID}:${Date.now().toString(36)}` });
  // 3. Фенс актуален? (перечитываем: эпоха могла смениться между чтениями)
  const reread = readMeshState(userData);
  const fresh = {
    mesh_epoch: reread?.mesh_epoch ?? epoch,
    coordinator_supervisor_id: reread?.coordinator_supervisor_id ?? coordinator, // тот же координатор, что в фенсе
  };
  try {
    assertCoordinationFenceCurrent(fence, fresh);
  } catch (e) {
    stats.fence_stale += 1;
    lastFenceStale = { reason: String(e?.message || e).slice(0, 80), at: new Date().toISOString() };
    emitRow(row_('FENCE_STALE', lastFenceStale), { error: true });
    return null; // ход не уходит с устаревшим фенсом — наследие mesh-дисциплины
  }
  // 4. mesh → daemon (R49: транспорт socket agentchat:op — REST-операции сняты;
  //    mesh_heartbeat — контрактный op, capabilities подтверждаются handshake'ем entry)
  let j;
  try {
    j = await me2SocketOp({
      op: 'mesh_heartbeat',
      mesh_epoch: fence.mesh_epoch,
      coordinator: fence.coordinator_supervisor_id,
      coordinator_supervisor_id: fence.coordinator_supervisor_id, // оба имени — совместимость R41/R49
      supervisors: lastMeshState?.supervisors ?? [],
      fence,
    });
  } catch (e) {
    throw new Error(`mesh_heartbeat_transport: ${String(e?.message || e).slice(0, 100)}`);
  }
  if (!j?.ok) throw new Error(`mesh_heartbeat_rejected: ${String(j?.error || '?').slice(0, 80)}`);
  lastHeartbeatAt = new Date().toISOString();
  stats.heartbeats_ok += 1;
  // 5. daemon → mesh: supervisor_tick в шину браузера (наследие outcome river)
  lastTick = j.supervisor_tick ?? null;
  emitRow(row_('MESH_HEARTBEAT_OK', {
    mesh_epoch: fence.mesh_epoch,
    coordinator: fence.coordinator_supervisor_id,
    mesh_found: lastMeshState !== null,
    stale: j.stale ?? null,
    daemon_version: j.daemon?.version ?? null,
  }));
  if (lastTick) {
    emitRow(row_('DAEMON_SUPERVISOR_TICK', {
      at: lastTick.at ?? null,
      supervisors: lastTick.supervisors ?? 0,
      kicked: (lastTick.kicked ?? []).length,
      ensured_created: lastTick.ensured?.created === true,
    }));
  }
  return { accepted: true, supervisor_tick: lastTick, stale: j.stale ?? null };
}

export function startMe2SupervisorMeshBridge({ userData } = {}) {
  if (stopped || syncTimer) return me2SupervisorMeshBridgeStatus();
  startedAt = new Date().toISOString();
  emitRow(row_('MESH_BRIDGE_START', { sync_ms: SYNC_MS, mesh_state_env: MESH_STATE_FILE }));
  const t = () => {
    me2MeshSync(userData).catch((e) => {
      stats.heartbeats_fail += 1;
      lastError = String(e?.message || e).slice(0, 140);
      emitRow(row_('MESH_HEARTBEAT_FAILED', { error: lastError }), { error: true });
    });
  };
  firstTimer = setTimeout(t, FIRST_DELAY_MS);
  syncTimer = setInterval(t, SYNC_MS);
  return me2SupervisorMeshBridgeStatus();
}

export function stopMe2SupervisorMeshBridge() {
  stopped = true;
  if (firstTimer) clearTimeout(firstTimer); // первый отложенный ход тоже отменяем
  firstTimer = null;
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
  return me2SupervisorMeshBridgeStatus();
}

export function me2SupervisorMeshBridgeStatus() {
  return {
    schema: ME2_SUPERVISOR_MESH_BRIDGE_SCHEMA,
    started_at: startedAt,
    stopped,
    last_mesh_state: lastMeshState,
    last_daemon_supervisor_tick: lastTick,
    last_fence_stale: lastFenceStale,
    last_heartbeat_at: lastHeartbeatAt,
    stats: { ...stats },
    last_error: lastError,
    rest_base: ME2_REST_BASE,
    heartbeat_transport: 'socket:agentchat:op',
    authority_effect: false,
  };
}
