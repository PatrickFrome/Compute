import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserContextPackRuntime } from '../src/browser-context-pack-runtime.mjs';

const tabId = 'tab_33333333-3333-4333-8333-333333333333';

function fixture() {
  let destroyed = false;
  let url = 'https://example.com/research';
  let target = 'webcontents:44';
  const tab = { tab_id: tabId, url, title: 'Research', kind: 'WEB' };
  const webContents = {
    isDestroyed: () => destroyed,
    getURL: () => url,
    getTitle: () => 'Research',
  };
  const view = { webContents };
  const registry = { get: (id) => id === tabId ? { ...tab, url } : null };
  const views = new Map([[tabId, view]]);
  const targetIdentity = () => ({ process_incarnation_id: 'proc-browser-1', target_id: target, authority_effect: false });
  return {
    registry,
    views,
    targetIdentity,
    webContents,
    destroy: () => { destroyed = true; },
    driftUrl: () => { url = 'https://example.com/other'; },
    driftTarget: () => { target = 'webcontents:45'; },
  };
}

function safeFrame(runtime, webContents) {
  const bound = runtime.observeTabBinding(tabId);
  return {
    schema: 'metaengine.native-browser.perception.v1',
    captured_at: '2026-09-03T16:20:00.000Z',
    process_incarnation_id: bound.process_incarnation_id,
    target_id: bound.target_id,
    url: webContents.getURL(),
    title: webContents.getTitle(),
    semantic_targets: [],
    semantic_input_values_exposed: false,
    text_excerpt: 'external page data',
    viewport: { width: 900, height: 700, page_x: 0, page_y: 0, scale: 1 },
    authority_effect: false,
  };
}

test('runtime exposes no timer or effect authority', () => {
  const f = fixture();
  const runtime = new BrowserContextPackRuntime({ ...f, captureFrame: async () => ({}) });
  const snap = runtime.snapshot();
  assert.equal(snap.explicit_invocation_only, true);
  assert.equal(snap.automatic_capture, false);
  assert.equal(snap.automatic_retry_allowed, false);
  assert.equal(snap.browser_actuation_authority, false);
  assert.equal(snap.task_authority, false);
  assert.equal(snap.scheduler_authority, false);
  assert.equal(snap.second_polling_loop, false);
  assert.equal(snap.authority_effect, false);
});

test('runtime captures the exact live tab view once', async () => {
  const f = fixture();
  let calls = 0;
  let runtime;
  runtime = new BrowserContextPackRuntime({
    registry: f.registry,
    views: f.views,
    targetIdentity: f.targetIdentity,
    captureFrame: async (webContents) => { calls += 1; return safeFrame(runtime, webContents); },
  });
  const pack = await runtime.capture([tabId]);
  assert.equal(calls, 1);
  assert.equal(pack.state, 'COMPLETE');
  assert.equal(pack.sources[0].tab_id, tabId);
  assert.equal(pack.sources[0].target_id, 'webcontents:44');
  assert.equal(pack.sources[0].process_incarnation_id, 'proc-browser-1');
});

test('destroyed tab cannot enter a context pack', async () => {
  const f = fixture();
  f.destroy();
  let calls = 0;
  const runtime = new BrowserContextPackRuntime({
    registry: f.registry,
    views: f.views,
    targetIdentity: f.targetIdentity,
    captureFrame: async () => { calls += 1; return {}; },
  });
  const pack = await runtime.capture([tabId]);
  assert.equal(calls, 0);
  assert.equal(pack.state, 'EMPTY');
  assert.equal(pack.issues[0].reason, 'TAB_BINDING_NOT_LIVE');
});

test('target drift immediately before capture is fenced without invoking frame capture', async () => {
  const f = fixture();
  let observations = 0;
  const original = f.targetIdentity;
  let calls = 0;
  const runtime = new BrowserContextPackRuntime({
    registry: f.registry,
    views: f.views,
    targetIdentity: (webContents) => {
      observations += 1;
      if (observations === 2) f.driftTarget();
      return original(webContents);
    },
    captureFrame: async () => { calls += 1; return {}; },
  });
  const pack = await runtime.capture([tabId]);
  assert.equal(calls, 0);
  assert.equal(pack.state, 'EMPTY');
  assert.equal(pack.issues[0].reason, 'CAPTURE_FAILED');
  assert.match(pack.issues[0].detail, /pre_capture_binding_drift/);
});

test('navigation during capture becomes post-capture drift and does not admit stale evidence', async () => {
  const f = fixture();
  let runtime;
  runtime = new BrowserContextPackRuntime({
    registry: f.registry,
    views: f.views,
    targetIdentity: f.targetIdentity,
    captureFrame: async (webContents) => {
      const frame = safeFrame(runtime, webContents);
      f.driftUrl();
      return frame;
    },
  });
  const pack = await runtime.capture([tabId]);
  assert.equal(pack.state, 'EMPTY');
  assert.equal(pack.sources.length, 0);
  assert.equal(pack.issues[0].reason, 'POST_CAPTURE_BINDING_DRIFT');
  assert.equal(pack.automatic_retry_allowed, false);
});
