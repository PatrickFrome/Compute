import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function bridge() {
  const exposed = {};
  const calls = [];
  const listeners = new Map();
  const ipcRenderer = {
    invoke: async (...args) => { calls.push(args); return { ok: false, reason: 'fleet_unavailable' }; },
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel, listener) => { if (listeners.get(channel) === listener) listeners.delete(channel); },
  };
  runInNewContext(readFileSync(new URL('../src/preload.cjs', import.meta.url), 'utf8'), {
    require: name => { assert.equal(name, 'electron'); return {
      contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } }, ipcRenderer,
    }; }, process: { platform: 'test' },
  });
  return { exposed, calls, listeners };
}

test('conversation bridge forwards native identities and preserves refusal results', async () => {
  const { exposed, calls } = bridge();
  const api = exposed.me2.webConversations;
  for (const result of [await api.list(), await api.open('https://chat.z.ai/c/example'), await api.focus('web-7'), await api.create()]) {
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'fleet_unavailable');
  }
  assert.deepEqual(calls, [
    ['me2:list-conversations'], ['me2:open-site', 'https://chat.z.ai/c/example'],
    ['me2:focus-conversation', 'web-7'], ['me2:new-conversation'],
  ]);
});

test('bridge subscriptions strip IPC event authority and clean up listeners', () => {
  const { exposed, listeners } = bridge();
  let received;
  const unsubscribe = exposed.me2.onTabActivated((...args) => { received = args; });
  listeners.get('me2:tab-activated')({ sender: 'privileged' }, { id: 'MAIN' });
  assert.deepEqual(received, [{ id: 'MAIN' }]);
  unsubscribe();
  assert.equal(listeners.size, 0);
});
