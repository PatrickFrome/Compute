import assert from 'node:assert/strict';
import test from 'node:test';
import { EmergencyIntakeRuntime } from '../src/emergency-intake-runtime.mjs';

function harness({ initialState = 'IDLE', cycleImpl = null, retryImpl = null } = {}) {
  const timers = [];
  let state = initialState;
  let cycleCalls = 0;
  let retryCalls = 0;
  const pump = {
    snapshot: () => ({ state }),
    cycle: async () => {
      cycleCalls += 1;
      const result = cycleImpl ? await cycleImpl() : { state: 'IDLE' };
      state = result.state;
      return result;
    },
    retryCompletion: async () => {
      retryCalls += 1;
      const result = retryImpl ? await retryImpl() : { state: 'COMPLETED' };
      state = result.state;
      return result;
    },
  };
  const runtime = new EmergencyIntakeRuntime({
    pump,
    idleDelayMs: 250,
    errorDelayMs: 1000,
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => { timer.cleared = true; },
  });
  return { runtime, timers, pump, stats: () => ({ cycleCalls, retryCalls, state }) };
}

async function runTimer(timer) {
  timer.fn();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('runtime starts an emergency-only intake independently of the general scheduler', async () => {
  const { runtime, timers, stats } = harness();
  const started = runtime.start();
  assert.equal(started.running, true);
  assert.equal(started.general_scheduler_dependency, false);
  assert.equal(started.second_general_scheduler, false);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 0);
  await runTimer(timers[0]);
  assert.equal(stats().cycleCalls, 1);
  assert.equal(runtime.snapshot().leases_normal_commands, false);
  runtime.stop();
});

test('RESULT_PENDING blocks a new lease and retries only durable completion delivery', async () => {
  const { runtime, timers, stats } = harness({ initialState: 'RESULT_PENDING' });
  runtime.start();
  await runTimer(timers[0]);
  assert.equal(stats().cycleCalls, 0);
  assert.equal(stats().retryCalls, 1);
  assert.equal(runtime.snapshot().result_replays, 1);
  assert.equal(runtime.snapshot().automatic_effect_retry_allowed, false);
  runtime.stop();
});

test('idle responses are rate-bounded instead of creating a tight fallback poll loop', async () => {
  const { runtime, timers } = harness();
  runtime.start();
  await runTimer(timers[0]);
  assert.equal(timers.length, 2);
  assert.equal(timers[1].ms, 250);
  runtime.stop();
});

test('intake errors back off and never become effect retry authority', async () => {
  const { runtime, timers } = harness({ cycleImpl: async () => { throw new Error('transport_down'); } });
  runtime.start();
  await runTimer(timers[0]);
  assert.equal(runtime.snapshot().last_state, 'ERROR');
  assert.match(runtime.snapshot().last_error, /transport_down/);
  assert.equal(timers.length, 2);
  assert.equal(timers[1].ms, 1000);
  assert.equal(runtime.snapshot().automatic_effect_retry_allowed, false);
  runtime.stop();
});

test('stop prevents future intake scheduling', async () => {
  const { runtime, timers } = harness();
  runtime.start();
  runtime.stop();
  assert.equal(timers[0].cleared, true);
  assert.equal(runtime.snapshot().running, false);
  assert.equal(runtime.snapshot().last_state, 'STOPPED');
});
