import assert from 'node:assert/strict';
import test from 'node:test';
import { openCdpOutcomeLatch } from '../src/browser-cdp-outcome-latch.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('outcome latch performs one race-closing read and then reacts only to CDP signals', async () => {
  const listeners = new Set();
  const scheduled = [];
  const timers = [];
  let inspections = 0;
  let state = 'PENDING';
  const latch = openCdpOutcomeLatch({
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    inspect: async () => {
      inspections += 1;
      return { resolved: state === 'PROVEN', effect_state: state };
    },
    isResolved: (row) => row?.resolved === true,
    onDeadline: (last) => ({ resolved: false, effect_state: 'AMBIGUOUS', last_state: last?.effect_state || null }),
    eventFilter: (event) => event?.method === 'Accessibility.nodesUpdated',
    setTimer: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; },
    clearTimer: () => {},
    schedule: (fn) => { scheduled.push(fn); },
  });

  assert.equal(timers.length, 1);
  assert.equal(latch.snapshot().poll_timer_required, false);
  assert.equal(latch.snapshot().deadline_timer_only, true);
  assert.equal(inspections, 0);

  await scheduled.shift()();
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(inspections, 1);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(inspections, 1, 'no polling inspection should appear without a signal');

  for (const listener of listeners) listener({ method: 'Network.dataReceived' });
  assert.equal(scheduled.length, 0);
  assert.equal(inspections, 1);

  state = 'PROVEN';
  for (const listener of listeners) listener({ method: 'Accessibility.nodesUpdated' });
  assert.equal(scheduled.length, 1);
  await scheduled.shift()();
  const result = await latch.wait();
  assert.equal(result.effect_state, 'PROVEN');
  assert.equal(inspections, 2);
  assert.equal(listeners.size, 0);
});

test('multiple signals while inspection is in flight coalesce into one follow-up read', async () => {
  const listeners = new Set();
  const scheduled = [];
  const first = deferred();
  let inspections = 0;
  const latch = openCdpOutcomeLatch({
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    inspect: async () => {
      inspections += 1;
      if (inspections === 1) return first.promise;
      return { resolved: true, effect_state: 'PROVEN' };
    },
    isResolved: (row) => row?.resolved === true,
    onDeadline: () => ({ resolved: false, effect_state: 'AMBIGUOUS' }),
    setTimer: (fn, ms) => ({ fn, ms, unref() {} }),
    clearTimer: () => {},
    schedule: (fn) => { scheduled.push(fn); },
  });

  const initial = scheduled.shift();
  const initialPromise = initial();
  await new Promise((resolve) => queueMicrotask(resolve));
  for (const listener of listeners) {
    listener({ method: 'Accessibility.nodesUpdated' });
    listener({ method: 'DOM.documentUpdated' });
    listener({ method: 'Page.lifecycleEvent' });
  }
  assert.equal(latch.snapshot().inspect_pending, true);
  first.resolve({ resolved: false, effect_state: 'PENDING' });
  await initialPromise;
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(scheduled.length, 1);
  await scheduled.shift()();
  const result = await latch.wait();
  assert.equal(result.effect_state, 'PROVEN');
  assert.equal(inspections, 2);
});

test('bounded deadline returns AMBIGUOUS without manufacturing a retry', async () => {
  const scheduled = [];
  let deadline = null;
  const latch = openCdpOutcomeLatch({
    subscribe: () => () => {},
    inspect: async () => ({ resolved: false, effect_state: 'PENDING' }),
    isResolved: (row) => row?.resolved === true,
    onDeadline: (last) => ({
      resolved: false,
      effect_state: 'AMBIGUOUS_AFTER_DEADLINE',
      last_state: last?.effect_state || null,
      automatic_retry_allowed: false,
      authority_effect: false,
    }),
    setTimer: (fn, ms) => { deadline = { fn, ms, unref() {} }; return deadline; },
    clearTimer: () => {},
    schedule: (fn) => { scheduled.push(fn); },
  });

  await scheduled.shift()();
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.ok(deadline);
  deadline.fn();
  const result = await latch.wait();
  assert.equal(result.effect_state, 'AMBIGUOUS_AFTER_DEADLINE');
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(latch.snapshot().settled, true);
  assert.equal(latch.snapshot().poll_timer_required, false);
});
