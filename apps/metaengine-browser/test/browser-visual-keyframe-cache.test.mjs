import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearVisualKeyframe,
  readVisualKeyframe,
  rememberVisualKeyframe,
  visualKeyframeStatus,
} from '../src/browser-visual-keyframe-cache.mjs';
import { releasePersistentBrowserDebugger } from '../src/browser-persistent-cdp-session.mjs';

function fakeWebContents(id = 77) {
  let attached = false;
  let url = 'https://example.test/a';
  const debuggerApi = {
    attach() { attached = true; },
    detach() { attached = false; },
    isAttached() { return attached; },
    async sendCommand() { return {}; },
  };
  return {
    id,
    debugger: debuggerApi,
    isDestroyed: () => false,
    getURL: () => url,
    getTitle: () => 'Example',
    getOSProcessId: () => 4242,
    getOrCreateDevToolsTargetId: () => `target-${id}`,
    once() {},
    off() {},
    setURL(next) { url = next; },
  };
}

function jpegFrame() {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  return {
    schema: 'metaengine.native-browser.capture-thumbnail.v1',
    captured_at: '2026-09-14T00:00:00.000Z',
    url: 'https://example.test/a',
    title: 'Example',
    source_width: 800,
    source_height: 600,
    capture_backend: 'ELECTRON_CAPTURE_PAGE',
    detached_surface_fallback: false,
    jpeg_bytes: jpeg.byteLength,
    sha256: 'b'.repeat(64),
    jpeg_base64: jpeg.toString('base64'),
    authority_effect: false,
  };
}

test('JPEG keyframe is reusable only for exact same WebContents document identity', async () => {
  const wc = fakeWebContents();
  try {
    await rememberVisualKeyframe(wc, jpegFrame());
    const status = visualKeyframeStatus(wc);
    assert.equal(status.reusable, true);
    assert.equal(status.same_target, true);
    assert.equal(status.same_generation, true);
    assert.equal(status.same_url, true);

    const cached = readVisualKeyframe(wc);
    assert.equal(cached.capture_backend, 'LAST_VERIFIED_JPEG_KEYFRAME');
    assert.equal(cached.detached_surface_fallback, true);
    assert.equal(cached.visual_keyframe_cache_hit, true);
    assert.equal(cached.jpeg_base64, jpegFrame().jpeg_base64);
    assert.equal(cached.automatic_retry_allowed, false);

    wc.setURL('https://example.test/b');
    assert.equal(visualKeyframeStatus(wc).same_url, false);
    assert.equal(readVisualKeyframe(wc), null);
  } finally {
    clearVisualKeyframe(wc);
    releasePersistentBrowserDebugger(wc);
  }
});
