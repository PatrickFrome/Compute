import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detachedCaptureSurfaceContract,
  withTemporaryDetachedCaptureSurface,
} from '../src/browser-detached-capture-surface.mjs';

function harness() {
  const events = [];
  let bounds = { x: 9, y: 11, width: 640, height: 480 };
  const view = {
    webContents: { isDestroyed: () => false },
    getBounds: () => ({ ...bounds }),
    setBounds: (next) => {
      bounds = { ...next };
      events.push(['bounds', { ...next }]);
    },
    getVisible: () => true,
    setVisible: (visible) => events.push(['visible', visible]),
  };
  const host = {
    contentView: {
      addChildView: (candidate) => events.push(['attach', candidate === view]),
      removeChildView: (candidate) => events.push(['detach', candidate === view]),
    },
    close: () => events.push(['close']),
  };
  return {
    view,
    host,
    events,
    bounds: () => ({ ...bounds }),
    createHost: async ({ width, height }) => {
      events.push(['host', width, height]);
      return host;
    },
  };
}

test('detached capture surface contract remains bounded, single-flight, and read-only', () => {
  assert.deepEqual(detachedCaptureSurfaceContract(), {
    schema: 'metaengine.browser.detached-capture-surface.contract.v1',
    exact_existing_view_only: true,
    second_webcontents_created: false,
    hidden_host_only: true,
    restores_detached_state: true,
    bounded: true,
    single_flight_per_view: true,
    timeout_quarantines_until_task_settled: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
});

test('temporary detached capture surface restores the exact view after success', async () => {
  const h = harness();
  const result = await withTemporaryDetachedCaptureSurface(
    h.view,
    async () => {
      assert.deepEqual(h.bounds(), { x: 0, y: 0, width: 640, height: 480 });
      h.events.push(['task']);
      return 'captured';
    },
    { createHost: h.createHost, settleMs: 0 },
  );

  assert.equal(result, 'captured');
  assert.deepEqual(h.bounds(), { x: 9, y: 11, width: 640, height: 480 });
  assert.deepEqual(h.events, [
    ['host', 640, 480],
    ['attach', true],
    ['bounds', { x: 0, y: 0, width: 640, height: 480 }],
    ['visible', true],
    ['task'],
    ['detach', true],
    ['bounds', { x: 9, y: 11, width: 640, height: 480 }],
    ['close'],
  ]);
});

test('temporary detached capture surface restores the exact view when the capture task fails', async () => {
  const h = harness();
  await assert.rejects(
    withTemporaryDetachedCaptureSurface(
      h.view,
      async () => {
        throw new Error('capture_failed');
      },
      { createHost: h.createHost, settleMs: 0 },
    ),
    /capture_failed/,
  );

  assert.deepEqual(h.bounds(), { x: 9, y: 11, width: 640, height: 480 });
  assert.deepEqual(h.events.slice(-3), [
    ['detach', true],
    ['bounds', { x: 9, y: 11, width: 640, height: 480 }],
    ['close'],
  ]);
});

test('timeout restores the view but quarantines it until the underlying capture settles', async () => {
  const h = harness();
  let releaseLate;
  const lateWork = new Promise((resolve) => { releaseLate = resolve; });

  await assert.rejects(
    withTemporaryDetachedCaptureSurface(
      h.view,
      () => lateWork,
      { createHost: h.createHost, settleMs: 0, deadlineMs: 1 },
    ),
    (error) => {
      assert.equal(error?.code, 'DETACHED_CAPTURE_SURFACE_TIMEOUT');
      assert.equal(error?.deadline_ms, 250);
      assert.equal(error?.automatic_retry_allowed, false);
      return true;
    },
  );

  assert.deepEqual(h.bounds(), { x: 9, y: 11, width: 640, height: 480 });
  assert.deepEqual(h.events.slice(-3), [
    ['detach', true],
    ['bounds', { x: 9, y: 11, width: 640, height: 480 }],
    ['close'],
  ]);

  await assert.rejects(
    withTemporaryDetachedCaptureSurface(
      h.view,
      async () => 'too-early',
      { createHost: h.createHost, settleMs: 0 },
    ),
    (error) => {
      assert.equal(error?.code, 'DETACHED_CAPTURE_SURFACE_BUSY');
      assert.equal(error?.automatic_retry_allowed, false);
      return true;
    },
  );
  assert.equal(h.events.filter(([name]) => name === 'host').length, 1);

  releaseLate('late-capture-finished');
  assert.equal(await lateWork, 'late-capture-finished');
  await new Promise((resolve) => setImmediate(resolve));

  const recovered = await withTemporaryDetachedCaptureSurface(
    h.view,
    async () => 'recovered',
    { createHost: h.createHost, settleMs: 0 },
  );
  assert.equal(recovered, 'recovered');
  assert.equal(h.events.filter(([name]) => name === 'host').length, 2);
});

test('concurrent lease for the same exact view fails closed without a second host', async () => {
  const h = harness();
  let signalStarted;
  let releaseFirst;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const hold = new Promise((resolve) => { releaseFirst = resolve; });

  const first = withTemporaryDetachedCaptureSurface(
    h.view,
    async () => {
      signalStarted();
      await hold;
      return 'first';
    },
    { createHost: h.createHost, settleMs: 0 },
  );
  await started;

  await assert.rejects(
    withTemporaryDetachedCaptureSurface(
      h.view,
      async () => 'second',
      { createHost: h.createHost, settleMs: 0 },
    ),
    (error) => {
      assert.equal(error?.code, 'DETACHED_CAPTURE_SURFACE_BUSY');
      assert.equal(error?.automatic_retry_allowed, false);
      return true;
    },
  );

  assert.equal(h.events.filter(([name]) => name === 'host').length, 1);
  assert.equal(h.events.filter(([name]) => name === 'attach').length, 1);
  releaseFirst();
  assert.equal(await first, 'first');
  assert.deepEqual(h.bounds(), { x: 9, y: 11, width: 640, height: 480 });
});
