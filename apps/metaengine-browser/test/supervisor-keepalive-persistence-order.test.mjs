import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';

import { SupervisorKeepalive } from '../src/supervisor-keepalive.mjs';

const CONVERSATION = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CLOSED = Object.freeze({
  authoritative: true, state: 'CLOSED', generation_floor: 28,
  continuous_service_allowed: false, refill_enabled: false, supervisor_admission_enabled: false,
  reason: 'CONTINUOUS_SERVICE_ADMISSION_FENCED',
});

async function controlledStorage() {
  let durable = null;
  let now = Date.parse('2026-10-03T20:00:00.000Z');
  let blocked = false;
  let active = 0;
  let maxActive = 0;
  const writes = [];
  const keepalive = new SupervisorKeepalive({
    loadState: async () => structuredClone(durable),
    saveState: async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const write = { snapshot: structuredClone(value) };
      writes.push(write);
      try {
        if (blocked) await new Promise((resolve, reject) => { write.resolve = resolve; write.reject = reject; });
        durable = structuredClone(value);
      } finally { active -= 1; }
    },
    clock: () => now,
    processIncarnationId: 'process_persistence_order_test',
  });
  await keepalive.init();
  await keepalive.bindConversation({ url: CONVERSATION, tab_id: 'tab_supervisor' });
  writes.length = 0;
  maxActive = 0;
  blocked = true;
  return {
    keepalive, writes,
    durable: () => structuredClone(durable),
    maxActive: () => maxActive,
    advance: (ms) => { now += ms; },
    flush() {
      blocked = false;
      for (const write of writes) write.resolve?.();
    },
  };
}

function outcome(promise) {
  return promise.then((value) => ({ value }), (error) => ({ error }));
}

test('rollover intent and cycle completion persist captured snapshots in call order without concurrent writes', async () => {
  const h = await controlledStorage();
  let rollover;
  let completion;
  try {
    rollover = outcome(h.keepalive.requestRollover('COMPOSER_UNCLEARABLE_DK7', { autoRelease: true }));
    h.advance(1000);
    completion = outcome(h.keepalive.markCycleComplete());
    await nextTurn();
    assert.equal(h.writes.length, 1, 'cycle persistence must wait for the rollover write to finish');
    assert.equal(h.writes[0].snapshot.state, 'ROLLOVER_REQUIRED');
    assert.equal(h.writes[0].snapshot.last_completed_cycle_at, null);
    assert.equal(h.writes[0].snapshot.updated_at, '2026-10-03T20:00:00.000Z');
    h.writes[0].resolve();
    assert.equal((await rollover).error, undefined);
    await nextTurn();
    assert.equal(h.writes.length, 2);
    assert.equal(h.writes[1].snapshot.state, 'ROLLOVER_REQUIRED');
    assert.equal(h.writes[1].snapshot.last_completed_cycle_at, '2026-10-03T20:00:01.000Z');
    assert.equal(h.writes[1].snapshot.updated_at, '2026-10-03T20:00:01.000Z');
    h.writes[1].resolve();
    assert.equal((await completion).error, undefined);
    assert.equal(h.maxActive(), 1);
    assert.equal(h.durable().last_completed_cycle_at, '2026-10-03T20:00:01.000Z');
    assert.equal(h.durable().rollover_reason, 'COMPOSER_UNCLEARABLE_DK7');
  } finally {
    h.flush();
    await Promise.all([rollover, completion]);
  }
});

test('a newer admission fence stays durable after an older rollover write and cannot resurrect queued intent', async () => {
  const h = await controlledStorage();
  let rollover;
  let closed;
  try {
    rollover = outcome(h.keepalive.requestRollover('COMPOSER_UNCLEARABLE_DK7', { autoRelease: true }));
    h.advance(1000);
    closed = outcome(h.keepalive.applyAdmissionClosed(CLOSED));
    await nextTurn();
    assert.equal(h.writes.length, 1);
    assert.equal(h.writes[0].snapshot.state, 'ROLLOVER_REQUIRED', 'the earlier snapshot must be cloned before the queue wait');
    assert.equal(h.writes[0].snapshot.rollover_reason, 'COMPOSER_UNCLEARABLE_DK7');
    h.writes[0].resolve();
    assert.equal((await rollover).error, undefined);
    await nextTurn();
    assert.equal(h.writes.length, 2);
    assert.equal(h.writes[1].snapshot.state, 'PARKED');
    assert.equal(h.writes[1].snapshot.admission_generation_floor, 28);
    assert.equal(h.writes[1].snapshot.rollover_reason, null);
    h.writes[1].resolve();
    assert.equal((await closed).error, undefined);
    assert.equal(h.maxActive(), 1);
    assert.equal(h.durable().state, 'PARKED');
    assert.equal(h.durable().admission_state, 'CLOSED');
    assert.equal(h.durable().rollover_reason, null);
    assert.equal(h.durable().rollover_release_at, null);
    assert.equal(h.keepalive.canWake(), false);
  } finally {
    h.flush();
    await Promise.all([rollover, closed]);
  }
});

test('a failed write rejects its caller once while later newer state persists without retrying the failed snapshot', async () => {
  const h = await controlledStorage();
  let rollover;
  let closed;
  const failure = Object.assign(new Error('simulated_windows_replace_failure'), { code: 'EPERM' });
  try {
    rollover = outcome(h.keepalive.requestRollover('COMPOSER_UNCLEARABLE_DK7', { autoRelease: true }));
    h.advance(1000);
    closed = outcome(h.keepalive.applyAdmissionClosed(CLOSED));
    await nextTurn();
    assert.equal(h.writes.length, 1);
    h.writes[0].reject(failure);
    assert.equal((await rollover).error, failure, 'consuming the queue-tail rejection must not hide the caller error');
    await nextTurn();
    assert.equal(h.writes.length, 2, 'the rejected tail must not poison the next independent write');
    assert.equal(h.writes[1].snapshot.state, 'PARKED');
    h.writes[1].resolve();
    assert.equal((await closed).error, undefined);
    assert.equal(h.maxActive(), 1);
    assert.equal(h.durable().admission_state, 'CLOSED');
    assert.equal(h.durable().rollover_reason, null);
    assert.equal(h.writes.filter((write) => write.snapshot.state === 'ROLLOVER_REQUIRED').length, 1);

    h.flush();
    h.advance(1000);
    await h.keepalive.markCycleComplete();
    assert.equal(h.writes.length, 3, 'future calls remain runnable after the earlier save failure');
    assert.equal(h.durable().state, 'PARKED');
    assert.equal(h.durable().last_completed_cycle_at, '2026-10-03T20:00:02.000Z');
    assert.equal(h.keepalive.canWake(), false);
  } finally {
    h.flush();
    await Promise.all([rollover, closed]);
  }
});
