import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForEmergencyCommand } from '../supabase/a2-browser-native-supervisor-v1/emergency-command-wait.mjs';

const emergency = (id = 'cmd-1') => ({
  command_id: id,
  action: 'DISARM',
  payload: {},
  command_lane: 'EMERGENCY',
  authority_effect: false,
});

function waiter({ subscribed = { ok: true, reason: 'SUBSCRIBED' }, wake = { reason: 'BROADCAST' } } = {}) {
  let closed = 0;
  return {
    value: {
      subscribed: Promise.resolve(subscribed),
      wake: Promise.resolve(wake),
      close() { closed += 1; return true; },
    },
    closed: () => closed,
  };
}

test('immediate durable emergency lease avoids opening Realtime', async () => {
  let opens = 0;
  const out = await waitForEmergencyCommand({
    leaseEmergency: async () => ({ command: emergency() }),
    openWake: () => { opens += 1; throw new Error('should_not_open'); },
  });
  assert.equal(out.leased_count, 1);
  assert.equal(out.wake_reason, 'IMMEDIATE');
  assert.equal(out.authoritative_db_reads, 1);
  assert.equal(opens, 0);
  assert.equal(out.transport_delivery_is_authority, false);
});

test('subscribe recheck closes commit-before-subscribe race without waiting for Broadcast', async () => {
  let reads = 0;
  const w = waiter();
  const out = await waitForEmergencyCommand({
    leaseEmergency: async () => ({ command: ++reads === 2 ? emergency('cmd-2') : null }),
    openWake: () => w.value,
  });
  assert.equal(out.leased_count, 1);
  assert.equal(out.wake_reason, 'AFTER_SUBSCRIBE_RECHECK');
  assert.equal(out.authoritative_db_reads, 2);
  assert.equal(w.closed(), 1);
});

test('Broadcast is only advisory and always followed by authoritative final DB read', async () => {
  let reads = 0;
  const w = waiter({ wake: { reason: 'BROADCAST' } });
  const out = await waitForEmergencyCommand({
    leaseEmergency: async () => ({ command: ++reads === 3 ? emergency('cmd-3') : null }),
    openWake: () => w.value,
  });
  assert.equal(out.leased_count, 1);
  assert.equal(out.wake_reason, 'WAKE_BROADCAST');
  assert.equal(out.authoritative_db_reads, 3);
  assert.equal(out.polling_loop, false);
  assert.equal(out.transport_delivery_is_authority, false);
  assert.equal(w.closed(), 1);
});

test('lost wake/timeout returns final durable state without polling loop or effect retry', async () => {
  const w = waiter({ wake: { reason: 'TIMEOUT' } });
  const out = await waitForEmergencyCommand({
    leaseEmergency: async () => ({ command: null }),
    openWake: () => w.value,
  });
  assert.equal(out.leased_count, 0);
  assert.equal(out.wake_reason, 'WAKE_TIMEOUT');
  assert.equal(out.authoritative_db_reads, 3);
  assert.equal(out.polling_loop, false);
  assert.equal(out.automatic_retry_allowed, false);
});

test('failed subscribe degrades to one final DB read', async () => {
  let reads = 0;
  const w = waiter({ subscribed: { ok: false, reason: 'JOIN_REJECTED' } });
  const out = await waitForEmergencyCommand({
    leaseEmergency: async () => ({ command: ++reads === 2 ? emergency('cmd-4') : null }),
    openWake: () => w.value,
  });
  assert.equal(out.leased_count, 1);
  assert.equal(out.wake_reason, 'SUBSCRIBE_JOIN_REJECTED');
  assert.equal(out.authoritative_db_reads, 2);
  assert.equal(w.closed(), 1);
});

test('server-side composition rejects any non-emergency command even if a lease implementation misbehaves', async () => {
  await assert.rejects(
    () => waitForEmergencyCommand({
      leaseEmergency: async () => ({ command: { command_id: 'bad', action: 'NAVIGATE', payload: {} } }),
      openWake: () => waiter().value,
    }),
    /non_emergency_lease_rejected/,
  );
});
