import assert from 'node:assert/strict';
import test from 'node:test';
import { openRealtimeCommandWake } from '../supabase/a2-browser-native-supervisor-v1/realtime-command-wake.mjs';

class FakeSocket {
  sent = [];
  closed = false;
  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;
  send(value) { this.sent.push(JSON.parse(String(value))); }
  close() { this.closed = true; this.onclose?.(); }
  open() { this.onopen?.(); }
  message(row) { this.onmessage?.({ data: JSON.stringify(row) }); }
}

function ack(socket, topic, ref) {
  socket.message({ topic: `realtime:${topic}`, event: 'phx_reply', payload: { status: 'ok' }, ref, join_ref: ref });
}

test('joining all channels resolves subscribed but does not resolve wake', async () => {
  const socket = new FakeSocket();
  const pending = openRealtimeCommandWake({
    createSocket: () => socket,
    topics: ['client-topic', 'all-topic'],
    accessToken: 'service-token',
    timeoutMs: 5000,
  });
  socket.open();
  assert.equal(socket.sent.length, 2);
  ack(socket, 'client-topic', '1');
  ack(socket, 'all-topic', '2');
  const subscribed = await pending.subscribed;
  assert.equal(subscribed.ok, true);
  assert.equal(subscribed.reason, 'SUBSCRIBED');

  let woke = false;
  pending.wake.then(() => { woke = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(woke, false, 'phx_join must not be mistaken for a command wake');

  socket.message({ topic: 'realtime:client-topic', event: 'broadcast', payload: { event: 'COMMAND_AVAILABLE', payload: {} } });
  const wake = await pending.wake;
  assert.equal(wake.reason, 'BROADCAST');
  assert.equal(wake.broadcast_received, true);
  assert.equal(wake.transport_delivery_is_authority, false);
  pending.close();
});

test('broadcast received after subscription remains observable while caller performs durable recheck', async () => {
  const socket = new FakeSocket();
  const pending = openRealtimeCommandWake({
    createSocket: () => socket,
    topics: ['client-topic'],
    accessToken: 'service-token',
    timeoutMs: 5000,
  });
  socket.open();
  ack(socket, 'client-topic', '1');
  assert.equal((await pending.subscribed).ok, true);
  socket.message({ topic: 'realtime:client-topic', event: 'broadcast', payload: {} });
  await new Promise((resolve) => setImmediate(resolve));
  const wake = await pending.wake;
  assert.equal(wake.reason, 'BROADCAST');
  pending.close();
});

test('channel failure never grants authority and resolves both waits fail-closed', async () => {
  const socket = new FakeSocket();
  const pending = openRealtimeCommandWake({
    createSocket: () => socket,
    topics: ['client-topic'],
    accessToken: 'service-token',
    timeoutMs: 5000,
  });
  socket.open();
  socket.onerror?.();
  const subscribed = await pending.subscribed;
  const wake = await pending.wake;
  assert.equal(subscribed.ok, false);
  assert.equal(wake.reason, 'CHANNEL_ERROR');
  assert.equal(wake.authority_effect, false);
  assert.equal(wake.transport_delivery_is_authority, false);
  pending.close();
});

test('close is idempotent and cannot manufacture a broadcast', async () => {
  const socket = new FakeSocket();
  const pending = openRealtimeCommandWake({
    createSocket: () => socket,
    topics: ['client-topic'],
    accessToken: 'service-token',
    timeoutMs: 5000,
  });
  socket.open();
  ack(socket, 'client-topic', '1');
  await pending.subscribed;
  assert.equal(pending.close(), true);
  assert.equal(pending.close(), false);
  const wake = await pending.wake;
  assert.equal(wake.reason, 'CLOSED');
  assert.equal(wake.broadcast_received, false);
});
