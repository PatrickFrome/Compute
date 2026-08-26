import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { setTimeout as sleep } from 'node:timers/promises';
import { webcrypto } from 'node:crypto';

const source = fs.readFileSync(path.resolve('coordination/chat-control-plane/extension/debugger-broker.js'), 'utf8');
const eventListeners = [];
const detachListeners = [];
const removedListeners = [];
const attached = new Set();
const calls = [];
let attachCalls = 0;
let detachCalls = 0;
let failAttachFor = null;
const eventOrder = [];

const chrome = {
  debugger: {
    async attach({ tabId }) {
      attachCalls += 1;
      if (Number(tabId) === Number(failAttachFor)) throw new Error('foreign debugger busy');
      if (attached.has(tabId)) throw new Error('duplicate attach');
      attached.add(tabId);
      calls.push(['attach', tabId]);
    },
    async detach({ tabId }) {
      detachCalls += 1;
      attached.delete(tabId);
      calls.push(['detach', tabId]);
    },
    async sendCommand(target, method, params = {}) {
      assert.ok(attached.has(target.tabId), `${method} sent without broker attachment`);
      calls.push(['command', target, method, params]);
      eventOrder.push(`send:${target.tabId}:${target.sessionId || 'root'}:${method}:${params.marker || ''}`);
      return { ok: true };
    },
    onEvent: { addListener(fn) { eventListeners.push(fn); } },
    onDetach: { addListener(fn) { detachListeners.push(fn); } }
  },
  tabs: { onRemoved: { addListener(fn) { removedListeners.push(fn); } } },
  storage: { local: { async set() {} } }
};

const context = vm.createContext({
  chrome,
  globalThis: null,
  console,
  Map,
  Promise,
  Date,
  setTimeout,
  clearTimeout,
  crypto: webcrypto
});
context.globalThis = context;
vm.runInContext(source, context, { filename: 'debugger-broker.js' });

const run = context.A2_DEBUGGER_RUN;
const hold = context.A2_DEBUGGER_HOLD;
const status = context.A2_DEBUGGER_STATUS;
assert.equal(typeof run, 'function');
assert.equal(typeof hold, 'function');

// Same-tab transient operations serialize and reuse one extension-owned root attach.
const p1 = run(1, 'first', async (session) => {
  eventOrder.push('first:start');
  await session.send('Runtime.evaluate', { marker: 'first' });
  await sleep(80);
  eventOrder.push('first:end');
  return 'one';
});
const p2 = run(1, 'second', async (session) => {
  eventOrder.push('second:start');
  await session.send('Page.enable', { marker: 'second' });
  eventOrder.push('second:end');
  return 'two';
});
const results = await Promise.all([p1, p2]);
assert.equal(results.join(','), 'one,two');
assert.ok(eventOrder.indexOf('first:end') < eventOrder.indexOf('second:start'), 'same-tab operations overlapped');
assert.equal(attachCalls, 1, 'back-to-back broker tasks should reuse one attachment');
await sleep(1350);
assert.equal(detachCalls, 1, 'idle root should detach after transient work');

// Long-lived GLM hold shares the same root with perception/action work and suppresses idle detach.
const lease = await hold(7, 'glm-monitor');
assert.equal(attachCalls, 2);
await run(7, 'perception', (session) => session.send('Runtime.enable'));
assert.equal(attachCalls, 2, 'hold + transient work must share one root attachment');
assert.equal(status().find((row) => row.tab_id === 7)?.hold_count, 1);
await sleep(1350);
assert.equal(detachCalls, 1, 'active hold must suppress idle detach');

// Chrome 125+ flat child sessions: target events become addressable tabId+sessionId sessions.
await lease.enableChildTargets();
for (const listener of eventListeners) {
  listener(
    { tabId: 7 },
    'Target.attachedToTarget',
    { sessionId: 'child-1', targetInfo: { targetId: 'target-1', type: 'iframe', url: 'https://frame.example/' }, waitingForDebugger: false }
  );
}
assert.equal(lease.childSessions().length, 1);
await lease.sendChild('child-1', 'Runtime.enable');
assert.ok(calls.some((row) => row[0] === 'command' && row[1]?.tabId === 7 && row[1]?.sessionId === 'child-1' && row[2] === 'Runtime.enable'));
await lease.disableChildTargets();
assert.equal(lease.childSessions().length, 0);
assert.ok(calls.some((row) => row[0] === 'command' && row[2] === 'Target.setAutoAttach' && row[3]?.autoAttach === false));

// Last hold release permits normal idle detach.
await lease.release();
await sleep(1350);
assert.equal(detachCalls, 2);

// Foreign debugger attach failure remains fail-closed.
failAttachFor = 2;
await assert.rejects(() => run(2, 'blocked', async () => 'unexpected'), /debugger_broker_attach_failed/);
failAttachFor = null;

// External DevTools detach invalidates generation and every previously-issued lease.
const staleLease = await hold(3, 'detach-event');
const generationBeforeDetach = staleLease.generation;
for (const listener of detachListeners) listener({ tabId: 3 }, 'canceled_by_user');
const detached = status().find((row) => row.tab_id === 3);
assert.equal(detached?.attached, false);
assert.equal(detached?.hold_count, 0);
assert.ok(Number(detached?.generation) > Number(generationBeforeDetach));
await assert.rejects(() => staleLease.send('Runtime.enable'), /debugger_broker_lease_stale/);

// Fresh generation can recover, then removed tab drops broker state entirely.
await run(3, 'post-detach-recovery', (session) => session.send('Runtime.enable'));
for (const listener of removedListeners) listener(3);
assert.ok(!status().some((row) => row.tab_id === 3));

console.log('A2 v0.6 Debugger Broker Lab: PASS', JSON.stringify({
  attach_calls: attachCalls,
  detach_calls: detachCalls,
  child_session_tested: true,
  stale_lease_rejected: true
}));
