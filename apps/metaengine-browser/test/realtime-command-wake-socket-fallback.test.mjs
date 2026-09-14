import assert from 'node:assert/strict';
import test from 'node:test';
import { openRealtimeCommandWake } from '../supabase/a2-browser-native-supervisor-v1/realtime-command-wake.mjs';

test('Realtime socket construction failure resolves fail-closed instead of throwing', async () => {
  const subscription = openRealtimeCommandWake({
    createSocket: () => { throw new Error('websocket_constructor_failed'); },
    topics: ['metaengine-control:workspace:client', 'metaengine-control:workspace:all'],
    accessToken: 'service-role-token',
    timeoutMs: 1000,
  });

  const joined = await subscription.subscribed;
  assert.equal(joined.ok, false);
  assert.equal(joined.reason, 'SOCKET_CREATE_FAILED');
  assert.equal(joined.topic_count, 2);
  assert.equal(joined.joined_topic_count, 0);
  assert.equal(joined.transport_delivery_is_authority, false);
  assert.equal(joined.authority_effect, false);

  const wake = await subscription.wake;
  assert.equal(wake.reason, 'SOCKET_CREATE_FAILED');
  assert.equal(wake.broadcast_received, false);
  assert.equal(wake.transport_delivery_is_authority, false);
  assert.equal(wake.authority_effect, false);
  assert.equal(subscription.close(), false);
});

test('Realtime null socket is treated as operational wake degradation', async () => {
  const subscription = openRealtimeCommandWake({
    createSocket: () => null,
    topics: ['metaengine-control:workspace:client'],
    accessToken: 'service-role-token',
  });
  const joined = await subscription.subscribed;
  assert.equal(joined.ok, false);
  assert.equal(joined.reason, 'SOCKET_CREATE_FAILED');
  assert.equal((await subscription.wake).reason, 'SOCKET_CREATE_FAILED');
});

test('invalid caller configuration still throws instead of being hidden as transport degradation', () => {
  assert.throws(() => openRealtimeCommandWake({
    createSocket: () => ({}),
    topics: [],
    accessToken: 'token',
  }), /topics_invalid/);
  assert.throws(() => openRealtimeCommandWake({
    createSocket: () => ({}),
    topics: ['topic'],
    accessToken: '',
  }), /token_required/);
});
