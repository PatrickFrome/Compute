import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { TabHealthRegistry } from '../src/tab-health-registry.mjs';

class FakeWebContents extends EventEmitter {
  constructor(id = 17) { super(); this.id = id; }
}

test('physical renderer events update zero-authority health state', () => {
  let now = Date.parse('2026-08-29T15:00:00Z');
  const health = new TabHealthRegistry({ clock: () => now });
  const wc = new FakeWebContents(17);
  health.bind('tab-a', wc);

  wc.emit('did-start-loading');
  assert.equal(health.get('tab-a').state, 'LOADING');

  now += 1000;
  wc.emit('did-finish-load');
  const loaded = health.get('tab-a');
  assert.equal(loaded.state, 'HEALTHY');
  assert.equal(loaded.webcontents_id, 17);
  assert.equal(loaded.authority_effect, false);

  now += 1000;
  wc.emit('unresponsive');
  assert.equal(health.get('tab-a').state, 'UNRESPONSIVE');

  now += 1000;
  wc.emit('responsive');
  assert.equal(health.get('tab-a').state, 'HEALTHY');

  now += 1000;
  wc.emit('render-process-gone', {}, { reason: 'crashed', processId: 991 });
  const gone = health.get('tab-a');
  assert.equal(gone.state, 'RENDERER_GONE');
  assert.equal(gone.renderer_incarnation, 1);
  assert.equal(gone.detail.reason, 'crashed');
  assert.equal(gone.detail.process_id, 991);

  const snap = health.snapshot();
  assert.equal(snap.page_content_observed, false);
  assert.equal(snap.page_content_authority, false);
  assert.equal(snap.browser_actuation_authority, false);
  assert.equal(snap.authority_effect, false);
});

test('subframe failure cannot degrade main-tab health', () => {
  const health = new TabHealthRegistry();
  const wc = new FakeWebContents(21);
  health.bind('tab-b', wc);
  wc.emit('did-finish-load');
  wc.emit('did-fail-load', {}, -3, 'ABORTED', 'https://example.invalid/frame', false);
  assert.equal(health.get('tab-b').state, 'HEALTHY');
  wc.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', 'https://chatgpt.com/', true);
  assert.equal(health.get('tab-b').state, 'LOAD_FAILED');
  assert.equal(health.get('tab-b').detail.error_code, -105);
});

test('binding is exact and unbind removes listeners and state', () => {
  const health = new TabHealthRegistry();
  const wc = new FakeWebContents(42);
  health.bind('tab-c', wc);
  assert.throws(() => health.bind('tab-c', wc), /tab_health_binding_exists/);
  health.unbind('tab-c');
  assert.equal(health.get('tab-c'), null);
  assert.equal(wc.listenerCount('render-process-gone'), 0);
  assert.equal(wc.listenerCount('unresponsive'), 0);
});
