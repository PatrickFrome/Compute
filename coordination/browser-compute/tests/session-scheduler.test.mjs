import assert from 'node:assert/strict';
import test from 'node:test';
import { CdpSessionScheduler } from '../src/session-scheduler.mjs';

const INCARNATION = '77777777-7777-4777-8777-777777777777';

class FakeClient {
  constructor() {
    this.handlers = new Map();
    this.closeHandlers = new Set();
    this.calls = [];
    this.attachCount = 0;
    this.pending = new Map();
  }

  on(method, listener) {
    const list = this.handlers.get(method) || [];
    list.push(listener);
    this.handlers.set(method, list);
    return () => this.handlers.set(method, (this.handlers.get(method) || []).filter((row) => row !== listener));
  }

  onClose(listener) {
    this.closeHandlers.add(listener);
    return () => this.closeHandlers.delete(listener);
  }

  emit(method, params, sessionId = null) {
    for (const listener of this.handlers.get(method) || []) listener(params, sessionId);
  }

  async call(method, params, options = {}) {
    this.calls.push({ method, params, options });
    if (method === 'Target.attachToTarget') return { sessionId: `session-${++this.attachCount}` };
    if (method === 'Test.pending') {
      return new Promise((resolve, reject) => {
        const list = this.pending.get(options.sessionId) || [];
        list.push({ resolve, reject });
        this.pending.set(options.sessionId, list);
      });
    }
    return { ok: true };
  }

  rejectSession(sessionId, error) {
    const rows = this.pending.get(sessionId) || [];
    this.pending.delete(sessionId);
    for (const row of rows) row.reject(error);
    return rows.length;
  }
}

function identity(targetId, cdpTargetId = `engine-${targetId}`, conversationEpoch = 1, processIncarnationId = INCARNATION) {
  return { targetId, cdpTargetId, conversationEpoch, processIncarnationId };
}

test('scheduler uses flattened attachment and never exposes the engine session to its operation', async () => {
  const client = new FakeClient();
  const scheduler = new CdpSessionScheduler({ client, processIncarnationId: INCARNATION });
  try {
    const result = await scheduler.run(identity('target-one'), async ({ call, onEvent, sessionGeneration }) => {
      assert.equal(sessionGeneration, 1);
      assert.deepEqual(Object.keys({ call, onEvent, sessionGeneration }).sort(), ['call', 'onEvent', 'sessionGeneration']);
      return call('DOMSnapshot.captureSnapshot', { computedStyles: [] });
    });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(client.calls[0], {
      method: 'Target.attachToTarget',
      params: { targetId: 'engine-target-one', flatten: true },
      options: {}
    });
    assert.equal(client.calls[1].options.sessionId, 'session-1');
  } finally {
    scheduler.dispose();
  }
});

test('scheduler event subscriptions are exact-session scoped and automatically removed', async () => {
  const client = new FakeClient();
  const scheduler = new CdpSessionScheduler({ client, processIncarnationId: INCARNATION });
  const observed = [];
  try {
    await scheduler.run(identity('target-one'), async ({ call, onEvent }) => {
      onEvent('WebMCP.toolsAdded', (params) => observed.push(params));
      await call('Test.ready');
      client.emit('WebMCP.toolsAdded', { tools: ['wrong-session'] }, 'session-999');
      client.emit('WebMCP.toolsAdded', { tools: ['exact-session'] }, 'session-1');
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.deepEqual(observed, [{ tools: ['exact-session'] }]);
    client.emit('WebMCP.toolsAdded', { tools: ['after-operation'] }, 'session-1');
    assert.deepEqual(observed, [{ tools: ['exact-session'] }]);
  } finally {
    scheduler.dispose();
  }
});

test('detach makes the exact target stale and rejects its pending call only', async () => {
  const client = new FakeClient();
  const scheduler = new CdpSessionScheduler({ client, processIncarnationId: INCARNATION });
  try {
    const first = scheduler.run(identity('target-one'), ({ call }) => call('Test.pending'));
    const second = scheduler.run(identity('target-two'), async ({ call }) => call('Test.ready'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(await second, { ok: true });
    client.emit('Target.detachedFromTarget', { sessionId: 'session-1', targetId: 'engine-target-one' });
    await assert.rejects(first, /snapshot_stale/);
    assert.equal(scheduler.activeBindingCount, 1);
    assert.equal(scheduler.invalidateTarget('target-two'), true);
    assert.equal(scheduler.activeBindingCount, 0);
  } finally {
    scheduler.dispose();
  }
});

test('target identity is exact to epoch and process incarnation', async () => {
  const client = new FakeClient();
  const scheduler = new CdpSessionScheduler({ client, processIncarnationId: INCARNATION });
  try {
    await scheduler.run(identity('target-one'), async () => 'first');
    await scheduler.run(identity('target-one', 'engine-target-one', 2), async ({ sessionGeneration }) => {
      assert.equal(sessionGeneration, 2);
    });
    assert.equal(client.attachCount, 2);
    assert.throws(
      () => scheduler.run(identity('target-old', 'engine-old', 1, '88888888-8888-4888-8888-888888888888'), async () => {}),
      /snapshot_stale/
    );
  } finally {
    scheduler.dispose();
  }
});

test('scheduler preserves per-target FIFO and bounds browser-wide work', async () => {
  const client = new FakeClient();
  const scheduler = new CdpSessionScheduler({ client, processIncarnationId: INCARNATION, maxInFlight: 2 });
  let active = 0;
  let maximum = 0;
  const order = [];
  const operation = (label, delay) => async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    order.push(`start:${label}`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    order.push(`end:${label}`);
    active -= 1;
  };
  try {
    await Promise.all([
      scheduler.run(identity('target-one'), operation('one-a', 30)),
      scheduler.run(identity('target-one'), operation('one-b', 1)),
      scheduler.run(identity('target-two'), operation('two', 20)),
      scheduler.run(identity('target-three'), operation('three', 1))
    ]);
    assert.equal(maximum, 2);
    assert.ok(order.indexOf('end:one-a') < order.indexOf('start:one-b'));
  } finally {
    scheduler.dispose();
  }
});

test('pipe close invalidates every binding and queued operation', async () => {
  const client = new FakeClient();
  const scheduler = new CdpSessionScheduler({ client, processIncarnationId: INCARNATION, maxInFlight: 1 });
  const pending = scheduler.run(identity('target-one'), ({ call }) => call('Test.pending'));
  await new Promise((resolve) => setImmediate(resolve));
  for (const listener of client.closeHandlers) listener(new Error('pipe_closed'));
  await assert.rejects(pending, /snapshot_stale/);
  assert.equal(scheduler.activeBindingCount, 0);
});
