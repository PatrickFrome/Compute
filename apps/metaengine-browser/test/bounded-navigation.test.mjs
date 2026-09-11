import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { boundedNavigation } from '../src/bounded-navigation.mjs';

class FakeWebContents extends EventEmitter {
  constructor(url = 'https://before.test/') {
    super();
    this.url = url;
    this.destroyed = false;
    this.stopCount = 0;
    this.load = null;
  }
  isDestroyed() { return this.destroyed; }
  getURL() { return this.url; }
  stop() { this.stopCount += 1; }
  loadURL(url) {
    if (this.load) return this.load(url);
    this.url = url;
    queueMicrotask(() => this.emit('did-finish-load'));
    return Promise.resolve();
  }
}

test('confirmed navigation returns bounded evidence and removes listeners', async () => {
  const wc = new FakeWebContents();
  const out = await boundedNavigation(wc, 'https://after.test/', { timeout_ms: 1000 });
  assert.equal(out.state, 'CONFIRMED');
  assert.equal(out.post_url, 'https://after.test/');
  assert.equal(out.automatic_retry_allowed, false);
  assert.equal(out.authority_effect, true);
  assert.equal(wc.listenerCount('did-finish-load'), 0);
  assert.equal(wc.listenerCount('did-fail-load'), 0);
});

test('deadline stops pending navigation and classifies outcome as ambiguous', async () => {
  const wc = new FakeWebContents();
  wc.load = () => new Promise(() => {});
  const out = await boundedNavigation(wc, 'https://hung.test/', { timeout_ms: 250 });
  assert.equal(out.state, 'AMBIGUOUS');
  assert.equal(out.reason, 'DEADLINE_EXCEEDED');
  assert.equal(out.stopped, true);
  assert.equal(wc.stopCount, 1);
  assert.equal(out.automatic_retry_allowed, false);
});

test('abort before visible navigation change is safely classified cancelled', async () => {
  const wc = new FakeWebContents();
  wc.load = () => new Promise(() => {});
  const controller = new AbortController();
  const pending = boundedNavigation(wc, 'https://cancelled.test/', { timeout_ms: 1000, signal: controller.signal });
  controller.abort();
  const out = await pending;
  assert.equal(out.state, 'CANCELLED');
  assert.equal(out.reason, 'ABORTED');
  assert.equal(out.stopped, true);
  assert.equal(out.authority_effect, false);
});

test('failed navigation after URL changed is ambiguous rather than retryable failure', async () => {
  const wc = new FakeWebContents();
  wc.load = (url) => {
    wc.url = url;
    queueMicrotask(() => wc.emit('did-fail-load', {}, -105, 'NAME_NOT_RESOLVED', url, true));
    return new Promise(() => {});
  };
  const out = await boundedNavigation(wc, 'https://unknown.test/', { timeout_ms: 1000 });
  assert.equal(out.state, 'AMBIGUOUS');
  assert.match(out.reason, /^DID_FAIL_LOAD:/);
  assert.equal(out.automatic_retry_allowed, false);
});

test('renderer loss during navigation is always ambiguous and never retried automatically', async () => {
  const wc = new FakeWebContents();
  wc.load = () => {
    queueMicrotask(() => wc.emit('render-process-gone', {}, { reason: 'crashed' }));
    return new Promise(() => {});
  };
  const out = await boundedNavigation(wc, 'https://renderer.test/', { timeout_ms: 1000 });
  assert.equal(out.state, 'AMBIGUOUS');
  assert.equal(out.reason, 'RENDER_PROCESS_GONE:crashed');
  assert.equal(out.automatic_retry_allowed, false);
});
