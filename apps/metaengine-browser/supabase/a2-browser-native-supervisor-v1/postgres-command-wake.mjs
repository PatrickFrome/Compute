export const POSTGRES_COMMAND_WAKE_SCHEMA = 'metaengine.native-supervisor.postgres-command-wake.v1';

const COMMAND_TABLE = 'compute_fabric_a2_browser_supervisor_command_h205f22';
const DEFAULT_CHANNEL = 'glm_browser_pulse';
const MAX_WAITERS = 128;

function boundedTimeout(value, fallback = 15000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(250, Math.min(15000, Math.trunc(parsed)));
}

function projection(extra = {}) {
  return Object.freeze({
    schema: POSTGRES_COMMAND_WAKE_SCHEMA,
    ...extra,
    transport_delivery_is_authority: false,
    command_payload_consumed: false,
    execution_authority: false,
    authority_effect: false,
  });
}

function parseWakePayload(value) {
  let row;
  try { row = JSON.parse(String(value || '')); } catch { return null; }
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  if (String(row.tbl || '') !== COMMAND_TABLE) return null;
  if (String(row.status || '').toUpperCase() !== 'PENDING') return null;
  const client = row.client == null ? null : String(row.client).slice(0, 160);
  return Object.freeze({ client });
}

export function createPostgresCommandWakeHub({
  listen,
  channel = DEFAULT_CHANNEL,
  maxWaiters = MAX_WAITERS,
} = {}) {
  if (typeof listen !== 'function') throw new Error('postgres_command_wake_listen_required');
  const boundedMaxWaiters = Math.max(1, Math.min(MAX_WAITERS, Number(maxWaiters) || MAX_WAITERS));
  const waiters = new Map();
  let sequence = 0;
  let startPromise = null;
  let listenerHandle = null;
  let lastError = null;
  let started = false;

  const settleWaiter = (id, reason) => {
    const row = waiters.get(id);
    if (!row) return false;
    waiters.delete(id);
    if (row.timer != null) row.clearTimer(row.timer);
    row.resolve(projection({
      reason,
      notified: reason === 'POSTGRES_NOTIFY',
    }));
    return true;
  };

  const onNotify = (payload) => {
    const wake = parseWakePayload(payload);
    if (!wake) return;
    for (const [id, row] of waiters) {
      if (wake.client && wake.client !== row.clientId) continue;
      settleWaiter(id, 'POSTGRES_NOTIFY');
    }
  };

  async function start() {
    if (started) return projection({ ok: true, reason: 'LISTENING', channel });
    if (startPromise) return startPromise;
    startPromise = (async () => {
      try {
        const handle = await listen(channel, onNotify);
        listenerHandle = handle || null;
        started = true;
        lastError = null;
        return projection({ ok: true, reason: 'LISTENING', channel });
      } catch (error) {
        lastError = String(error?.message || error || 'listen_failed').slice(0, 240);
        started = false;
        return projection({ ok: false, reason: 'LISTEN_UNAVAILABLE', channel, error: lastError });
      } finally {
        startPromise = null;
      }
    })();
    return startPromise;
  }

  function open({ clientId, timeoutMs = 15000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    const normalizedClient = String(clientId || '').trim();
    if (!normalizedClient) throw new Error('postgres_command_wake_client_required');
    if (waiters.size >= boundedMaxWaiters) {
      const unavailable = projection({ ok: false, reason: 'WAITER_CAPACITY_EXCEEDED', channel });
      return Object.freeze({
        schema: POSTGRES_COMMAND_WAKE_SCHEMA,
        subscribed: Promise.resolve(unavailable),
        wake: Promise.resolve(projection({ reason: 'WAITER_CAPACITY_EXCEEDED', notified: false })),
        close() { return false; },
        authority_effect: false,
      });
    }

    const id = ++sequence;
    let resolveWake;
    const wake = new Promise((resolve) => { resolveWake = resolve; });
    const row = {
      clientId: normalizedClient,
      resolve: resolveWake,
      clearTimer,
      timer: null,
    };
    waiters.set(id, row);
    row.timer = setTimer(() => settleWaiter(id, 'TIMEOUT'), boundedTimeout(timeoutMs));
    row.timer?.unref?.();

    const subscribed = start().then((status) => {
      if (status.ok !== true) settleWaiter(id, status.reason || 'LISTEN_UNAVAILABLE');
      return status;
    });

    return Object.freeze({
      schema: POSTGRES_COMMAND_WAKE_SCHEMA,
      subscribed,
      wake,
      close() {
        return settleWaiter(id, 'CLOSED');
      },
      authority_effect: false,
    });
  }

  async function close() {
    for (const id of [...waiters.keys()]) settleWaiter(id, 'CLOSED');
    const closer = listenerHandle?.unlisten || listenerHandle?.unsubscribe;
    listenerHandle = null;
    started = false;
    if (typeof closer === 'function') await closer();
    return projection({ closed: true, reason: 'CLOSED', channel });
  }

  return Object.freeze({
    schema: POSTGRES_COMMAND_WAKE_SCHEMA,
    start,
    open,
    close,
    snapshot() {
      return projection({
        listening: started,
        channel,
        waiter_count: waiters.size,
        last_error: lastError,
        max_waiters: boundedMaxWaiters,
      });
    },
    authority_effect: false,
  });
}
