export const REALTIME_COMMAND_WAKE_SCHEMA = 'metaengine.native-supervisor.realtime-command-wake.v1';

function boundedTimeout(value, fallback = 15000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(250, Math.min(15000, Math.trunc(parsed)));
}

function safeClose(socket) {
  try { socket?.close?.(); } catch {}
}

/**
 * Opens one Realtime subscription without granting any Browser authority.
 *
 * `subscribed` resolves only after every private channel join is acknowledged.
 * `wake` resolves on the first broadcast, timeout, or channel failure. Successful
 * subscription does NOT resolve `wake`; callers must re-read durable queue state
 * after subscription to close the lease-before-subscribe race window.
 */
export function openRealtimeCommandWake({
  createSocket,
  topics,
  accessToken,
  timeoutMs = 15000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof createSocket !== 'function') throw new Error('realtime_command_wake_socket_factory_required');
  if (!Array.isArray(topics) || topics.length < 1 || topics.length > 8) throw new Error('realtime_command_wake_topics_invalid');
  if (!topics.every((topic) => typeof topic === 'string' && topic.length >= 1 && topic.length <= 240)) throw new Error('realtime_command_wake_topic_invalid');
  if (typeof accessToken !== 'string' || accessToken.length < 1) throw new Error('realtime_command_wake_token_required');

  const waitMs = boundedTimeout(timeoutMs);
  const socket = createSocket();
  if (!socket) throw new Error('realtime_command_wake_socket_invalid');
  const expectedTopics = new Set(topics.map((topic) => `realtime:${topic}`));
  const joined = new Set();
  let closed = false;
  let subscribedSettled = false;
  let wakeSettled = false;
  let resolveSubscribed;
  let resolveWake;

  const subscribed = new Promise((resolve) => { resolveSubscribed = resolve; });
  const wake = new Promise((resolve) => { resolveWake = resolve; });

  const finishSubscribed = (value) => {
    if (subscribedSettled) return;
    subscribedSettled = true;
    resolveSubscribed(Object.freeze({ ...value, authority_effect: false }));
  };
  const finishWake = (reason) => {
    if (wakeSettled) return;
    wakeSettled = true;
    clearTimer(timer);
    resolveWake(Object.freeze({
      schema: REALTIME_COMMAND_WAKE_SCHEMA,
      reason,
      broadcast_received: reason === 'BROADCAST',
      transport_delivery_is_authority: false,
      authority_effect: false,
    }));
  };
  const fail = (reason) => {
    finishSubscribed({
      schema: REALTIME_COMMAND_WAKE_SCHEMA,
      ok: false,
      reason,
      topic_count: expectedTopics.size,
      transport_delivery_is_authority: false,
    });
    finishWake(reason);
  };

  const timer = setTimer(() => finishWake('TIMEOUT'), waitMs);
  timer?.unref?.();

  socket.onopen = () => {
    try {
      topics.forEach((topic, index) => {
        const ref = String(index + 1);
        socket.send(JSON.stringify({
          topic: `realtime:${topic}`,
          event: 'phx_join',
          payload: {
            config: { broadcast: { ack: false, self: false }, presence: { enabled: false }, private: true },
            access_token: accessToken,
          },
          ref,
          join_ref: ref,
        }));
      });
    } catch {
      fail('JOIN_SEND_FAILED');
    }
  };

  socket.onmessage = (event) => {
    let row;
    try { row = JSON.parse(String(event?.data || '')); } catch { return; }
    const topic = String(row?.topic || '');
    if (row?.event === 'phx_reply' && expectedTopics.has(topic)) {
      if (row?.payload?.status !== 'ok') {
        fail('JOIN_REJECTED');
        return;
      }
      joined.add(topic);
      if (joined.size === expectedTopics.size) {
        finishSubscribed({
          schema: REALTIME_COMMAND_WAKE_SCHEMA,
          ok: true,
          reason: 'SUBSCRIBED',
          topic_count: joined.size,
          transport_delivery_is_authority: false,
        });
      }
      return;
    }
    if (row?.event === 'broadcast' && expectedTopics.has(topic)) {
      finishWake('BROADCAST');
      return;
    }
    if (row?.event === 'phx_error' || row?.event === 'phx_close') fail('CHANNEL_CLOSED');
  };
  socket.onerror = () => fail('CHANNEL_ERROR');
  socket.onclose = () => {
    if (!closed && !wakeSettled) fail('CHANNEL_CLOSED');
  };

  return Object.freeze({
    schema: REALTIME_COMMAND_WAKE_SCHEMA,
    subscribed,
    wake,
    close() {
      if (closed) return false;
      closed = true;
      clearTimer(timer);
      safeClose(socket);
      finishSubscribed({
        schema: REALTIME_COMMAND_WAKE_SCHEMA,
        ok: false,
        reason: 'CLOSED',
        topic_count: joined.size,
        transport_delivery_is_authority: false,
      });
      finishWake('CLOSED');
      return true;
    },
    transport_delivery_is_authority: false,
    authority_effect: false,
  });
}
