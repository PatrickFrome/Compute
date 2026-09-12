import assert from 'node:assert/strict';
import test from 'node:test';
import { captureViewThumbnail } from '../src/native-browser-control.mjs';

function image({ width = 320, height = 200, jpeg = Buffer.from('jpeg') } = {}) {
  return {
    getSize() { return { width, height }; },
    resize() { return this; },
    toJPEG() { return Buffer.from(jpeg); },
  };
}

function webContentsFixture(capturePage) {
  let destroyed = false;
  return {
    id: 7,
    isDestroyed() { return destroyed; },
    destroyForTest() { destroyed = true; },
    capturePage,
    getURL() { return 'https://example.com/live-capture'; },
    getTitle() { return 'Live Capture'; },
  };
}

test('CAPTURE_VIEW retries the transient Electron display-surface race and then succeeds', async () => {
  let calls = 0;
  const sleeps = [];
  const webContents = webContentsFixture(async () => {
    calls += 1;
    if (calls < 3) throw new Error('Current display surface not available for capture');
    return image();
  });

  const result = await captureViewThumbnail(webContents, {
    maxAttempts: 4,
    retryDelayMs: 1,
    sleepImpl: async (ms) => sleeps.push(ms),
  });

  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [1, 1]);
  assert.equal(result.capture_attempts, 3);
  assert.equal(result.transient_surface_retries, 2);
  assert.equal(result.bounded_surface_readiness, true);
  assert.equal(result.source_width, 320);
  assert.equal(result.source_height, 200);
  assert.equal(result.authority_effect, false);
});

test('CAPTURE_VIEW treats a temporary zero-sized surface as retryable readiness', async () => {
  let calls = 0;
  const webContents = webContentsFixture(async () => {
    calls += 1;
    return calls === 1 ? image({ width: 0, height: 0 }) : image({ width: 640, height: 360 });
  });

  const result = await captureViewThumbnail(webContents, {
    maxAttempts: 2,
    retryDelayMs: 0,
  });

  assert.equal(calls, 2);
  assert.equal(result.capture_attempts, 2);
  assert.equal(result.transient_surface_retries, 1);
  assert.equal(result.source_width, 640);
  assert.equal(result.source_height, 360);
});

test('CAPTURE_VIEW fails explicitly after the bounded surface-readiness budget is exhausted', async () => {
  let calls = 0;
  const webContents = webContentsFixture(async () => {
    calls += 1;
    throw new Error('Current display surface not available for capture');
  });

  await assert.rejects(
    () => captureViewThumbnail(webContents, { maxAttempts: 3, retryDelayMs: 0 }),
    (error) => {
      assert.equal(error?.code, 'NATIVE_CAPTURE_SURFACE_UNAVAILABLE');
      assert.equal(error?.attempts, 3);
      assert.match(String(error?.message), /native_capture_surface_unavailable_after_retry:3/);
      return true;
    },
  );
  assert.equal(calls, 3);
});

test('CAPTURE_VIEW does not retry unrelated capture failures', async () => {
  let calls = 0;
  const webContents = webContentsFixture(async () => {
    calls += 1;
    throw new Error('gpu_process_unavailable');
  });

  await assert.rejects(
    () => captureViewThumbnail(webContents, { maxAttempts: 5, retryDelayMs: 0 }),
    /gpu_process_unavailable/,
  );
  assert.equal(calls, 1);
});
