/**
 * ME2 Fleet Bridge (R40 smart merge) — мост «флот вкладок Electron ⇄ флот агентных чатов ME2».
 *
 * Наследие старого браузера (fleet-provisioner / fleet-runtime-bridge / outcome river):
 *   • браузер ВИДИТ флот ME2 в реальном времени: каждые N секунд опрос /agentchat
 *     → observation-строки в stdout-шину (schema-контракт, как у остальных плоскостей);
 *   • река рассуждений ME2 (AGENT_CHAT_STEP/FLEET_STEP) доступна через /events tail;
 *   • честные исходы: деградации чатов (fail_streak) → OUTCOME-строки (reliability-ordered
 *     retirement в будущих раундах, карта в docs/me2-smart-merge-r40.md).
 *
 * Связь локальная (127.0.0.1:3041) — без внешнего сайта: чаты живут в daemon'е (постоянные
 * сессии в SQLite), браузер — их оболочка и наблюдатель, как в Electron-версии, но контекст
 * больше не теряется при перезагрузке вкладки.
 */
import { ME2_REST_BASE } from './me2-daemon-host.mjs';
import { me2SocketOp } from './me2-socket-client.mjs';

export const ME2_FLEET_BRIDGE_SCHEMA = 'metaengine.browser.me2.fleet-bridge.v1';

const POLL_MS = Number(process.env.ME2_FLEET_POLL_MS || 20000);
const EVENTS_TAIL = Number(process.env.ME2_FLEET_EVENTS_TAIL || 12);
let pollTimer = null;
let lastFleetDigest = null;
let stopped = false;

function emitRow(row, { error = false } = {}) {
  const text = JSON.stringify(row);
  if (error || process.argv.some((a) => String(a || '').startsWith('--metaengine-'))) console.error(text);
  else console.log(text);
}

async function me2Fetch(path, init) {
  const r = await fetch(`${ME2_REST_BASE}${path}`, { signal: AbortSignal.timeout(8000), ...init });
  if (!r.ok) throw new Error(`me2_http_${r.status}`);
  return r.json();
}

/** Один цикл наблюдения флота: статус + деградации + свежие события реки рассуждений. */
export async function me2FleetObserve() {
  const ac = await me2Fetch('/agentchat');
  if (!ac?.ok) throw new Error('me2_agentchat_bad_payload');
  const s = ac.status ?? {};
  const fleet = (ac.sessions ?? []).filter((x) => x.status === 'ACTIVE');
  lastFleetDigest = {
    active: fleet.length,
    thinking: s.thinking ?? 0,
    supervisors: s.supervisors ?? 0,
    turns_ok: s.turns_ok ?? 0,
    turns_fail: s.turns_fail ?? 0,
    in_flight: s.in_flight ?? 0,
    degraded: s.degraded ?? 0,
    agent_mode: s.agent ?? 0,
    chains: s.chains ?? 0,
  };
  emitRow({ schema: ME2_FLEET_BRIDGE_SCHEMA, event: 'FLEET_DIGEST', ...lastFleetDigest, at: new Date().toISOString() });
  for (const c of fleet) {
    emitRow({
      schema: ME2_FLEET_BRIDGE_SCHEMA, event: 'FLEET_MEMBER',
      id: c.id, title: String(c.title ?? '').slice(0, 48), role: c.role, state: c.state,
      turns: `${c.turns_ok}/${c.turns_fail}`, objective: String(c.objective ?? '').slice(0, 80),
    });
  }
  if ((s.degraded ?? 0) > 0) {
    // Outcome river v1: деградации — исходы, оператор и супервизор их видят
    emitRow({ schema: ME2_FLEET_BRIDGE_SCHEMA, event: 'OUTCOME_DEGRADED', count: s.degraded }, { error: true });
  }
  try {
    const ev = await me2Fetch(`/events?limit=${EVENTS_TAIL}`);
    const rows = (ev?.events ?? []).filter((e) => String(e.type ?? '').startsWith('AGENT_CHAT'));
    for (const e of rows.slice(-6)) {
      emitRow({ schema: ME2_FLEET_BRIDGE_SCHEMA, event: 'RIVER', type: e.type, at: e.at ?? e.ts ?? null, data: String(e.data ?? '').slice(0, 160) });
    }
  } catch { /* события не блокируют дайджест */ }
  return lastFleetDigest;
}

/** Ход оператора/браузера в чат ME2 (мост «вкладка → чат»); ход идёт фоном (THINKING).
 * R49: транспорт — socket agentchat:op (REST-операции сняты в daemon v0.40; контракт
 * me2-daemon-contract.v1). Недоступный socket — честный throw → OBSERVE/DEGRADED строка. */
export async function me2ChatTurn(sessionId, text) {
  let j;
  try {
    j = await me2SocketOp({ op: 'turn', id: String(sessionId), text: String(text ?? '').slice(0, 8000) });
  } catch (e) {
    emitRow({ schema: ME2_FLEET_BRIDGE_SCHEMA, event: 'TURN_RELAY_FAILED', id: sessionId, error: String(e?.message || e).slice(0, 120) }, { error: true });
    throw e;
  }
  if (!j?.ok) {
    // честный отказ daemon'а (busy/closed/not_found) — наружу без ретраев (штормы недопустимы)
    emitRow({ schema: ME2_FLEET_BRIDGE_SCHEMA, event: 'TURN_REJECTED', id: sessionId, error: String(j?.error || '?').slice(0, 80) }, { error: true });
    return j;
  }
  emitRow({ schema: ME2_FLEET_BRIDGE_SCHEMA, event: 'TURN_RELAYED', id: sessionId, ok: true, transport: 'socket:agentchat:op' });
  return j;
}

export function startMe2FleetBridge() {
  stopped = false;
  emitRow({ schema: ME2_FLEET_BRIDGE_SCHEMA, event: 'BRIDGE_START', poll_ms: POLL_MS });
  const tick = () => {
    me2FleetObserve().catch((e) => {
      emitRow({ schema: ME2_FLEET_BRIDGE_SCHEMA, event: 'OBSERVE_FAILED', error: String(e?.message || e).slice(0, 120) }, { error: true });
    });
  };
  // первая проба с задержкой: daemon-хосту нужно время подняться/усыновиться
  setTimeout(tick, 6000);
  pollTimer = setInterval(tick, POLL_MS);
}

export function stopMe2FleetBridge() {
  stopped = true;
  if (pollTimer) clearInterval(pollTimer);
}

export function me2FleetBridgeStatus() {
  return { schema: ME2_FLEET_BRIDGE_SCHEMA, stopped, last_digest: lastFleetDigest, rest_base: ME2_REST_BASE, turn_transport: 'socket:agentchat:op' };
}
