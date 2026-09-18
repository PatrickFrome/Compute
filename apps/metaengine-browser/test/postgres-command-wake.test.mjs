import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPostgresCommandWakeHub,
  POSTGRES_COMMAND_WAKE_SCHEMA,
} from '../supabase/a2-browser-native-supervisor-v1/postgres-command-wake.mjs';

const commandPayload = (targetClientId = 'browser-a', extra = {}) => JSON.stringify({
  table: 'compute_fabric_a2_browser_supervisor_command_h205f22',
  op: 'INSERT',
  client_id: 'issuer-client',
  target_client_id: targetClientId,
  supervisor_client_id: null,
  command_id: '11111111-1111-4111-8111-111111111111',
  action: 'CAPTURE',
  status: 'PENDING',
  last_seen: null,
  ...extra,
});

const deployedLegacyCommandPayload = (client = 'browser-a', extra = {}) => JSON.stringify({
  tbl: 'compute_fabric_a2_browser_supervisor_command_h205f22',
  op: 'INSERT',
  client,
  supervisor: null,
  cmd: '11111111-1111-4111-8111-111111111111',
  action: 'CAPTURE',
  status: 'PENDING',
  last_seen: null,
  ...extra,
});

function harness({ failListen = false, maxWaiters = 128 } = {}) {
  let callback = null;
  let listenCount = 0;
  let unlistenCount = 0;
  let readyCallback = null;
  const hub = createPostgresCommandWakeHub({
    maxWaiters,
    listen: async (channel, onNotify, onListen) => {
      listenCount += 1;
      assert.equal(channel, 'glm_browser_pulse');
      if (failListen) throw new Error('listen_failed');
      callback = onNotify;
      readyCallback = onListen;
      onListen?.();
      return {
        unlisten: async () => { unlistenCount += 1; },
      };
    },
  });
  return {
    hub,
    notify(payload) { callback?.(payload); },
    relisten() { readyCallback?.(); },
    listenCount: () => listenCount,
    unlistenCount: () => unlistenCount,
  };
}

test('deployed legacy pulse envelope remains compatible without production DDL', async () => {
  const h = harness();
  const a = h.hub.open({ clientId: 'browser-a', timeoutMs: 5000 });
  const b = h.hub.open({ clientId: 'browser-b', timeoutMs: 5000 });
  await Promise.all([a.subscribed, b.subscribed]);

  h.notify(deployedLegacyCommandPayload('browser-a'));
  assert.equal((await a.wake).reason, 'POSTGRES_NOTIFY');

  let bSettled = false;
  b.wake.then(() => { bSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bSettled, false);

  h.notify(deployedLegacyCommandPayload(null));
  assert.equal((await b.wake).reason, 'POSTGRES_NOTIFY');
  await h.hub.close();
});

test('one DB-native listener multiplexes exact-client wake waiters without command authority', async () => {
  const h = harness();
  const a = h.hub.open({ clientId: 'browser-a', timeoutMs: 5000 });
  const b = h.hub.open({ clientId: 'browser-b', timeoutMs: 5000 });
  assert.equal((await a.subscribed).ok, true);
  assert.equal((await b.subscribed).ok, true);
  assert.equal(h.listenCount(), 1, 'one dedicated LISTEN connection must serve all HTTP waiters');

  h.notify(commandPayload('browser-a'));
  const wakeA = await a.wake;
  assert.equal(wakeA.schema, POSTGRES_COMMAND_WAKE_SCHEMA);
  assert.equal(wakeA.reason, 'POSTGRES_NOTIFY');
  assert.equal(wakeA.notified, true);
  assert.equal(wakeA.transport_delivery_is_authority, false);
  assert.equal(wakeA.command_payload_consumed, false);
  assert.equal(wakeA.execution_authority, false);
  assert.equal(wakeA.authority_effect, false);

  let bSettled = false;
  b.wake.then(() => { bSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bSettled, false, 'targeted notify must not wake a different client');
  assert.equal(b.close(), true);
  assert.equal((await b.wake).reason, 'CLOSED');
  await h.hub.close();
  assert.equal(h.unlistenCount(), 1);
});

test('untargeted command notification wakes all waiters but malformed/non-pending pulses are ignored', async () => {
  const h = harness();
  const a = h.hub.open({ clientId: 'browser-a', timeoutMs: 5000 });
  const b = h.hub.open({ clientId: 'browser-b', timeoutMs: 5000 });
  await Promise.all([a.subscribed, b.subscribed]);

  h.notify('not-json');
  h.notify(JSON.stringify({ table: 'other_table', status: 'PENDING', target_client_id: null }));
  h.notify(commandPayload(null, { status: 'COMPLETED' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.hub.snapshot().waiter_count, 2);

  h.notify(commandPayload(null));
  assert.equal((await a.wake).reason, 'POSTGRES_NOTIFY');
  assert.equal((await b.wake).reason, 'POSTGRES_NOTIFY');
  assert.equal(h.hub.snapshot().waiter_count, 0);
  await h.hub.close();
});

test('listener reconnect wakes bounded waiters for durable queue recheck because NOTIFY has no history', async () => {
  const h = harness();
  const a = h.hub.open({ clientId: 'browser-a', timeoutMs: 5000 });
  const b = h.hub.open({ clientId: 'browser-b', timeoutMs: 5000 });
  await Promise.all([a.subscribed, b.subscribed]);
  assert.equal(h.hub.snapshot().listen_generation, 1);

  h.relisten();
  assert.equal((await a.wake).reason, 'POSTGRES_RELISTEN');
  assert.equal((await b.wake).reason, 'POSTGRES_RELISTEN');
  assert.equal(h.hub.snapshot().listen_generation, 2);
  await h.hub.close();
});

test('timeout remains a wake hint only and does not fabricate queue state', async () => {
  const h = harness();
  let timerCallback = null;
  const subscription = h.hub.open({
    clientId: 'browser-a',
    timeoutMs: 5000,
    setTimer: (fn) => { timerCallback = fn; return { unref() {} }; },
    clearTimer: () => {},
  });
  assert.equal((await subscription.subscribed).ok, true);
  assert.equal(typeof timerCallback, 'function');
  timerCallback();
  const wake = await subscription.wake;
  assert.equal(wake.reason, 'TIMEOUT');
  assert.equal(wake.notified, false);
  assert.equal(wake.command_payload_consumed, false);
  assert.equal(wake.transport_delivery_is_authority, false);
  assert.equal(h.hub.snapshot().waiter_count, 0);
  await h.hub.close();
});

test('LISTEN failure resolves fail-closed so caller can use bounded durable polling fallback', async () => {
  const h = harness({ failListen: true });
  const subscription = h.hub.open({ clientId: 'browser-a', timeoutMs: 5000 });
  const subscribed = await subscription.subscribed;
  assert.equal(subscribed.ok, false);
  assert.equal(subscribed.reason, 'LISTEN_UNAVAILABLE');
  const wake = await subscription.wake;
  assert.equal(wake.reason, 'LISTEN_UNAVAILABLE');
  assert.equal(wake.authority_effect, false);
  assert.match(h.hub.snapshot().last_error, /listen_failed/);
  await h.hub.close();
});

test('waiter capacity is bounded and overflow has zero authority', async () => {
  const h = harness({ maxWaiters: 1 });
  const first = h.hub.open({ clientId: 'browser-a', timeoutMs: 5000 });
  assert.equal((await first.subscribed).ok, true);
  const overflow = h.hub.open({ clientId: 'browser-b', timeoutMs: 5000 });
  const status = await overflow.subscribed;
  assert.equal(status.ok, false);
  assert.equal(status.reason, 'WAITER_CAPACITY_EXCEEDED');
  const wake = await overflow.wake;
  assert.equal(wake.reason, 'WAITER_CAPACITY_EXCEEDED');
  assert.equal(wake.authority_effect, false);
  first.close();
  await h.hub.close();
});
