import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { TabHealthRegistry } from '../src/tab-health-registry.mjs';
import { TabLivenessRuntime } from '../src/tab-liveness-runtime.mjs';
import { TabNetworkActivityRegistry } from '../src/tab-network-activity.mjs';

test('network liveness tracks only bounded counters and never persists request content', () => {
  let now = Date.parse('2026-08-29T15:30:00Z');
  const registry = new TabNetworkActivityRegistry({ clock: () => now });
  const request = {
    id: 17,
    webContentsId: 42,
    resourceType: 'xhr',
    url: 'https://chatgpt.com/backend-api/conversation',
    method: 'POST',
    requestHeaders: { authorization: 'secret-that-must-not-persist' },
    uploadData: [{ bytes: Buffer.from('prompt body that must not persist') }],
  };

  registry.onBeforeRequest(request);
  let row = registry.get(42);
  assert.equal(row.inflight_tracked, 1);
  assert.equal(row.completed_count, 0);
  assert.equal(row.authority_effect, false);

  now += 250;
  registry.onCompleted(request);
  row = registry.get(42);
  assert.equal(row.inflight_tracked, 0);
  assert.equal(row.completed_count, 1);

  const serialized = JSON.stringify(registry.snapshot());
  assert.equal(serialized.includes('backend-api'), false);
  assert.equal(serialized.includes('authorization'), false);
  assert.equal(serialized.includes('secret-that-must-not-persist'), false);
  assert.equal(serialized.includes('prompt body that must not persist'), false);
  assert.equal(registry.snapshot().tracked_request_urls, false);
  assert.equal(registry.snapshot().tracked_request_headers, false);
  assert.equal(registry.snapshot().tracked_request_bodies, false);
});

test('network liveness ignores unrelated hosts and non-tracked resource classes', () => {
  const registry = new TabNetworkActivityRegistry();
  registry.onBeforeRequest({ id: 1, webContentsId: 5, resourceType: 'xhr', url: 'https://example.com/api' });
  registry.onBeforeRequest({ id: 2, webContentsId: 5, resourceType: 'image', url: 'https://chatgpt.com/image.png' });
  assert.equal(registry.get(5), null);
  assert.equal(registry.snapshot().tabs.length, 0);
});

test('tab health records renderer/load state without page content authority', () => {
  let now = Date.parse('2026-08-29T15:31:00Z');
  const health = new TabHealthRegistry({ clock: () => now });
  health.register('tab-1');
  now += 100;
  health.mark('tab-1', 'LOADING');
  now += 100;
  health.mark('tab-1', 'UNRESPONSIVE', { reason: 'renderer-hung', process_id: 1234 });
  let row = health.get('tab-1');
  assert.equal(row.state, 'UNRESPONSIVE');
  assert.equal(row.detail.reason, 'renderer-hung');
  assert.equal(row.detail.process_id, 1234);
  assert.equal(row.authority_effect, false);

  now += 100;
  health.mark('tab-1', 'HEALTHY');
  row = health.get('tab-1');
  assert.equal(row.state, 'HEALTHY');
  assert.equal(health.snapshot().authority_effect, false);
});

test('liveness runtime binds exact tab to webContents and ignores aborted/subframe load failures', () => {
  const runtime = new TabLivenessRuntime();
  const wc = new EventEmitter();
  wc.id = 77;
  wc.getOSProcessId = () => 4321;
  runtime.wire('tab-exact', wc);

  wc.emit('did-start-loading');
  assert.equal(runtime.tabSnapshot('tab-exact').health.state, 'LOADING');
  wc.emit('unresponsive');
  assert.equal(runtime.tabSnapshot('tab-exact').health.state, 'UNRESPONSIVE');
  assert.equal(runtime.tabSnapshot('tab-exact').health.detail.process_id, 4321);
  wc.emit('responsive');
  assert.equal(runtime.tabSnapshot('tab-exact').health.state, 'HEALTHY');

  wc.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://chatgpt.com/', true, 4321, 1);
  assert.equal(runtime.tabSnapshot('tab-exact').health.state, 'HEALTHY');
  wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://chatgpt.com/', false, 4321, 1);
  assert.equal(runtime.tabSnapshot('tab-exact').health.state, 'HEALTHY');
  wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://chatgpt.com/', true, 4321, 1);
  assert.equal(runtime.tabSnapshot('tab-exact').health.state, 'LOAD_FAILED');

  wc.emit('render-process-gone', {}, { reason: 'crashed', exitCode: -1 });
  const gone = runtime.tabSnapshot('tab-exact');
  assert.equal(gone.health.state, 'RENDERER_GONE');
  assert.equal(gone.webcontents_id, 77);
  assert.equal(gone.authority_effect, false);

  runtime.remove('tab-exact');
  assert.equal(runtime.tabSnapshot('tab-exact').health, null);
  assert.equal(runtime.tabSnapshot('tab-exact').webcontents_id, null);
});
