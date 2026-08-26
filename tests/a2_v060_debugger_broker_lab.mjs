import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(path.resolve('coordination/chat-control-plane/extension/debugger-broker.js'), 'utf8');
const detachListeners = [];
const removedListeners = [];
const attached = new Set();
let attachCalls = 0;
let detachCalls = 0;
let failAttachFor = null;
const eventOrder = [];

function assert(condition, message) { if (!condition) throw new Error(message); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = {
  debugger: {
    async attach({ tabId }) {
      attachCalls += 1;
      if (Number(tabId) === Number(failAttachFor)) throw new Error('foreign debugger busy');
      if (attached.has(tabId)) throw new Error('duplicate attach');
      attached.add(tabId);
    },
    async detach({ tabId }) { detachCalls += 1; attached.delete(tabId); },
    async sendCommand({ tabId }, method, params = {}) {
      assert(attached.has(tabId), `${method} sent without broker attachment`);
      eventOrder.push(`send:${tabId}:${method}:${params.marker || ''}`);
      return { ok: true };
    },
    onDetach: { addListener(fn) { detachListeners.push(fn); } }
  },
  tabs: { onRemoved: { addListener(fn) { removedListeners.push(fn); } } },
  storage: { local: { async set() {} } }
};

const context = vm.createContext({ chrome, globalThis: null, console, Map, Promise, Date, setTimeout, clearTimeout });
context.globalThis = context;
vm.runInContext(source, context, { filename: 'debugger-broker.js' });

const p1 = context.A2_DEBUGGER_RUN(1, 'first', async (session) => {
  eventOrder.push('first:start');
  await session.send('Runtime.evaluate', { marker: 'first' });
  await sleep(80);
  eventOrder.push('first:end');
  return 'one';
});
const p2 = context.A2_DEBUGGER_RUN(1, 'second', async (session) => {
  eventOrder.push('second:start');
  await session.send('Page.enable', { marker: 'second' });
  eventOrder.push('second:end');
  return 'two';
});

const results = await Promise.all([p1, p2]);
assert(results.join(',') === 'one,two', 'broker result ordering failed');
assert(eventOrder.indexOf('first:end') < eventOrder.indexOf('second:start'), 'same-tab operations overlapped');
assert(attachCalls === 1, `back-to-back broker tasks should reuse one attachment, got ${attachCalls}`);
assert(context.A2_DEBUGGER_STATUS()[0]?.pending === 0, 'broker pending count did not drain');

await sleep(1350);
assert(detachCalls === 1 && attached.size === 0, 'broker did not idle-detach exactly once');

failAttachFor = 2;
let failed = false;
try { await context.A2_DEBUGGER_RUN(2, 'blocked', async () => 'unexpected'); }
catch (error) { failed = String(error?.message || error).includes('debugger_broker_attach_failed'); }
assert(failed, 'broker attach failure did not fail closed');
failAttachFor = null;

await context.A2_DEBUGGER_RUN(3, 'detach-event', async (session) => {
  await session.send('Runtime.enable');
  for (const listener of detachListeners) listener({ tabId: 3 }, 'canceled_by_user');
});
assert(context.A2_DEBUGGER_STATUS().find((row) => row.tab_id === 3)?.attached === false, 'external detach was not reflected in broker state');

for (const listener of removedListeners) listener(3);
assert(!context.A2_DEBUGGER_STATUS().some((row) => row.tab_id === 3), 'removed tab remained in broker state');

console.log('A2 v0.6 Debugger Broker Lab: PASS', JSON.stringify({ attach_calls: attachCalls, detach_calls: detachCalls, order: eventOrder }));
