import assert from 'node:assert/strict';
import test from 'node:test';

import { openCdpOutcomeLatch } from '../src/browser-cdp-outcome-latch.mjs';
import { PersistentBrowserCdpSessionPool } from '../src/browser-persistent-cdp-session.mjs';

function fakeEventlessWebContents() {
  let attached = false;
  let entered = false;
  let inspections = 0;
  const debuggerShim = {
    isAttached: () => attached,
    attach: () => { attached = true; },
    detach: () => { attached = false; },
    async sendCommand(method, params = {}) {
      if (method === 'Input.dispatchKeyEvent' && params.type === 'keyUp' && params.key === 'Enter') entered = true;
      if (method === 'Accessibility.getFullAXTree') {
        inspections += 1;
        return { nodes: [{ entered }] };
      }
      return {};
    },
  };
  return {
    id: 77,
    debugger: debuggerShim,
    isDestroyed: () => false,
    getOSProcessId: () => 7077,
    getOrCreateDevToolsTargetId: () => 'target-eventless-77',
    once() {},
    off() {},
    entered: () => entered,
    inspections: () => inspections,
  };
}

test('eventless debugger shim resolves from one synthetic post-dispatch edge without polling', async () => {
  const wc = fakeEventlessWebContents();
  const pool = new PersistentBrowserCdpSessionPool();
  await pool.ensure(wc);

  const latch = openCdpOutcomeLatch({
    subscribe: (listener) => pool.subscribe(wc, listener),
    inspect: async () => {
      const tree = await pool.send(wc, 'Accessibility.getFullAXTree');
      return { resolved: tree.nodes?.[0]?.entered === true };
    },
    isResolved: (row) => row?.resolved === true,
    onDeadline: () => ({ resolved: false, effect_state: 'AMBIGUOUS', automatic_retry_allowed: false }),
    eventFilter: () => false,
    timeoutMs: 1000,
  });

  await Promise.resolve();
  assert.equal(wc.entered(), false);
  const before = wc.inspections();

  await pool.send(wc, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter' });
  await pool.send(wc, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter' });
  const result = await latch.wait();

  assert.equal(result.resolved, true);
  assert.equal(wc.entered(), true);
  assert.ok(wc.inspections() >= before + 1);
  assert.equal(latch.snapshot().poll_timer_required, false);
  assert.equal(latch.snapshot().signals, 1);
  assert.equal(pool.snapshot().event_stream_count, 0);
  assert.equal(pool.snapshot().eventless_post_dispatch_polling_required, false);
  pool.release(wc);
});
