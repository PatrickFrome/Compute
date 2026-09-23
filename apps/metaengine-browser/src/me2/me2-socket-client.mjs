/**
 * ME2 Socket Client (R49 smart merge) — единый транспорт операций me2-плоскости к daemon'у.
 *
 * Контекст (docs/electron-rebuild-plan.md, фаза A): REST-операции флота сняты в daemon
 * v0.40 (единственная поверхность — socket.io "agentchat:op" c ack; контракт
 * me2-daemon-contract.v1, capabilities в GET /state). Мосты R40-R42 шли на REST
 * POST /agentchat — против v0.41+ это честный 404. Этот клиент — единственная
 * осознанная новая зависимость browser-shell (socket.io-client), как договорено в плане.
 *
 * Гарантии:
 *   • lazy-singleton: одна socket.io-связь на процесс (path '/', как требует gateway/daemon);
 *   • честный таймаут ack (не висим вечно), ошибки — машинные коды;
 *   • fail-open: недоступность socket'а не ломает браузер — мосты логируют DEGRADED;
 *   • zero-authority: клиент ничего не читает из release-состояния и не пишет в него.
 */
import { ME2_REST_BASE } from './me2-daemon-host.mjs';

export const ME2_SOCKET_CLIENT_SCHEMA = 'metaengine.browser.me2.socket-client.v1';

const ME2_WS_PORT = Number(process.env.ME2_WS_PORT || 3040);
const ME2_WS_BASE = process.env.ME2_WS_BASE || `http://127.0.0.1:${ME2_WS_PORT}`;
const DEFAULT_ACK_TIMEOUT_MS = Number(process.env.ME2_SOCKET_ACK_TIMEOUT_MS || 10000);

let ioMod = null;          // ленивый import('socket.io-client')
let socket = null;         // singleton
let lastError = null;
let lastOkAt = null;
let stats = { ops_ok: 0, ops_fail: 0, connects: 0 };

function emitRow(row, { error = false } = {}) {
  const text = JSON.stringify(row);
  if (error || process.argv.some((a) => String(a || '').startsWith('--metaengine-'))) console.error(text);
  else console.log(text);
}

async function loadIo() {
  if (ioMod) return ioMod;
  ioMod = await import('socket.io-client');
  return ioMod;
}

async function getSocket() {
  if (socket?.connected) return socket;
  const mod = await loadIo();
  if (!socket) {
    const { io } = mod;
    socket = io(ME2_WS_BASE, { path: '/', transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 1500, reconnectionDelayMax: 15000, timeout: 8000 });
    socket.on('connect', () => {
      stats.connects += 1;
      emitRow({ schema: ME2_SOCKET_CLIENT_SCHEMA, event: 'SOCKET_CONNECTED', base: ME2_WS_BASE });
    });
    socket.on('connect_error', (e) => {
      lastError = String(e?.message || e).slice(0, 140);
    });
    socket.on('disconnect', (reason) => {
      emitRow({ schema: ME2_SOCKET_CLIENT_SCHEMA, event: 'SOCKET_DISCONNECTED', reason: String(reason).slice(0, 80) }, { error: true });
    });
  }
  if (!socket.connected) {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('socket_connect_timeout')), 9000);
      const onErr = (e) => { clearTimeout(t); reject(new Error(`socket_connect_error: ${String(e?.message || e).slice(0, 80)}`)); };
      socket.once('connect', () => { clearTimeout(t); socket.off('connect_error', onErr); resolve(); });
      socket.once('connect_error', onErr);
    });
  }
  return socket;
}

/**
 * Одна операция на поверхности "agentchat:op" (или другой ack-событие daemon'а).
 * Возвращает ack daemon'а; при таймауте/недоступности — throw с машинным кодом.
 */
export async function me2SocketOp(payload, { timeoutMs = DEFAULT_ACK_TIMEOUT_MS, event = 'agentchat:op' } = {}) {
  const s = await getSocket();
  const res = await new Promise((resolve) => {
    s.timeout(timeoutMs).emit(event, payload ?? {}, (err, ack) => resolve(err ? { __timeout: true } : (ack ?? { ok: false, error: 'no_ack' })));
  });
  if (res?.__timeout) {
    stats.ops_fail += 1;
    lastError = `ack_timeout:${event}`;
    throw new Error(`me2_socket_ack_timeout (${event})`);
  }
  if (res?.ok === true) { stats.ops_ok += 1; lastOkAt = new Date().toISOString(); lastError = null; }
  else { stats.ops_fail += 1; }
  return res;
}

export function me2SocketStatus() {
  return {
    schema: ME2_SOCKET_CLIENT_SCHEMA,
    base: ME2_WS_BASE,
    connected: Boolean(socket?.connected),
    last_error: lastError,
    last_ok_at: lastOkAt,
    stats: { ...stats },
  };
}

/** Рест-база daemon'а (для handshake/read-only наблюдения мостов). */
export function me2RestBase() {
  return ME2_REST_BASE;
}
