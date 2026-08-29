import assert from 'node:assert/strict';
import test from 'node:test';
import { TabHealthRegistry } from '../src/tab-health-registry.mjs';
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
