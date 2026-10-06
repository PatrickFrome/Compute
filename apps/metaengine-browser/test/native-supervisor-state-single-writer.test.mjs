import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createBoundedSupervisorFetch,
  createNativeSupervisorStateSingleWriterFetch,
} from '../src/native-supervisor-client.mjs';

const STATE = 'https://example.invalid/functions/v1/a2-browser-native-supervisor-v1/v1/state';
const HEALTH = 'https://example.invalid/functions/v1/a2-browser-native-supervisor-v1/health';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('primary and realtime durable state writers share one physical POST slot', async () => {
  let activeStateWrites = 0;
  let maxActiveStateWrites = 0;
  let stateCalls = 0;

  const raw = async (url) => {
    if (String(url).endsWith('/v1/state')) {
      stateCalls += 1;
      activeStateWrites += 1;
      maxActiveStateWrites = Math.max(maxActiveStateWrites, activeStateWrites);
      await wait(30);
      activeStateWrites -= 1;
      return new Response('{}', { status: 202 });
    }
    return new Response('{}', { status: 200 });
  };

  const shared = createNativeSupervisorStateSingleWriterFetch(raw);
  // Production has two independently bounded wrappers: one below the core
  // heartbeat transport and one for the public realtime observation fallback.
  const primary = createBoundedSupervisorFetch(shared, { deadlineMs: 1000 });
  const realtime = createBoundedSupervisorFetch(shared, { deadlineMs: 1000 });

  await Promise.all([
    primary(STATE, { method: 'POST', body: '{}' }),
    realtime(STATE, { method: 'POST', body: '{}' }),
  ]);

  assert.equal(stateCalls, 2);
  assert.equal(maxActiveStateWrites, 1,
    'the same client_id must never self-contend on the durable supervisor-state row');
});

test('single-writer gate does not serialize non-state control traffic', async () => {
  let releaseState;
  let stateEnteredResolve;
  const stateEntered = new Promise((resolve) => { stateEnteredResolve = resolve; });
  const stateBlocked = new Promise((resolve) => { releaseState = resolve; });
  let healthObservedWhileStateActive = false;
  let stateActive = false;

  const raw = async (url) => {
    if (String(url).endsWith('/v1/state')) {
      stateActive = true;
      stateEnteredResolve();
      await stateBlocked;
      stateActive = false;
      return new Response('{}', { status: 202 });
    }
    healthObservedWhileStateActive = stateActive;
    return new Response('{}', { status: 200 });
  };

  const fetchImpl = createNativeSupervisorStateSingleWriterFetch(raw);
  const statePromise = fetchImpl(STATE, { method: 'POST', body: '{}' });
  await stateEntered;

  const health = await fetchImpl(HEALTH, { method: 'GET' });
  assert.equal(health.status, 200);
  assert.equal(healthObservedWhileStateActive, true,
    'command/read/control routes must remain independent from observation-state serialization');

  releaseState();
  await statePromise;
});

test('aborted queued state writer never dispatches stale payload and does not wedge the queue', async () => {
  let releaseFirst;
  let firstEnteredResolve;
  const firstEntered = new Promise((resolve) => { firstEnteredResolve = resolve; });
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  let stateCalls = 0;

  const raw = async (url) => {
    if (String(url).endsWith('/v1/state')) {
      stateCalls += 1;
      if (stateCalls === 1) {
        firstEnteredResolve();
        await firstBlocked;
      }
      return new Response('{}', { status: 202 });
    }
    return new Response('{}', { status: 200 });
  };

  const fetchImpl = createNativeSupervisorStateSingleWriterFetch(raw);
  const first = fetchImpl(STATE, { method: 'POST', body: '{"seq":1}' });
  await firstEntered;

  const controller = new AbortController();
  const second = fetchImpl(STATE, {
    method: 'POST',
    body: '{"seq":2}',
    signal: controller.signal,
  });
  controller.abort(new Error('queued_state_deadline'));

  await assert.rejects(second, /queued_state_deadline/);
  assert.equal(stateCalls, 1, 'aborted queued writer must not reach the network');

  releaseFirst();
  await first;

  const third = await fetchImpl(STATE, { method: 'POST', body: '{"seq":3}' });
  assert.equal(third.status, 202);
  assert.equal(stateCalls, 2, 'queue must remain usable after an aborted waiter');
});

test('GET /v1/state is not treated as a durable state mutation', async () => {
  let concurrent = 0;
  let maxConcurrent = 0;
  const raw = async () => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await wait(20);
    concurrent -= 1;
    return new Response('{}', { status: 200 });
  };
  const fetchImpl = createNativeSupervisorStateSingleWriterFetch(raw);
  await Promise.all([
    fetchImpl(STATE, { method: 'GET' }),
    fetchImpl(STATE, { method: 'GET' }),
  ]);
  assert.equal(maxConcurrent, 2);
});
