import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXT = path.join(ROOT, 'coordination', 'chat-control-plane', 'extension');
const REMOTE = 'https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-chat-bridge-remote';
const ZAI = 'https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db';

const local = new Map([
  ['bridgeSecret', 'x'.repeat(64)],
  ['daemonUrl', REMOTE],
  ['armed', false],
  ['autoOpenTabs', true],
  ['pollMs', 2500],
  ['chatgptUrl', ''],
  ['zaiUrl', ZAI],
]);
const session = new Map();
const idbSecrets = new Map();
const listeners = {
  runtimeMessage: [], installed: [], startup: [], alarm: [], action: [], storage: [],
  updateAvailable: [], debuggerEvent: [], debuggerDetach: [], tabRemoved: [], tabUpdated: [],
};
const fetchCalls = [];

function makeStorage(map) {
  return {
    async get(keys) {
      if (typeof keys === 'string') return { [keys]: map.get(keys) };
      const out = {};
      const names = Array.isArray(keys) ? keys : Object.keys(keys || {});
      for (const key of names) if (map.has(key)) out[key] = map.get(key);
      return out;
    },
    async set(obj) { for (const [key, value] of Object.entries(obj || {})) map.set(key, value); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) map.delete(key); },
    async setAccessLevel() {},
  };
}

// Minimal asynchronous IndexedDB implementation sufficient for the extension's
// pairing-secret vault. This intentionally executes the real secret-vault.js.
const indexedDB = {
  open() {
    const request = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
    const db = {
      objectStoreNames: { contains: () => true },
      createObjectStore() {},
      transaction(_name, _mode) {
        const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
        tx.objectStore = () => ({
          get(key) {
            const op = { result: idbSecrets.get(key) };
            setTimeout(() => tx.oncomplete?.(), 0);
            return op;
          },
          put(value, key) {
            idbSecrets.set(key, value);
            const op = { result: value };
            setTimeout(() => tx.oncomplete?.(), 0);
            return op;
          }
        });
        return tx;
      },
      close() {}
    };
    request.result = db;
    setTimeout(() => {
      request.onupgradeneeded?.();
      request.onsuccess?.();
    }, 0);
    return request;
  }
};

const chrome = {
  storage: {
    local: makeStorage(local),
    session: makeStorage(session),
    onChanged: { addListener(fn) { listeners.storage.push(fn); } },
  },
  action: {
    async setBadgeText() {},
    async setBadgeBackgroundColor() {},
    async setTitle() {},
    onClicked: { addListener(fn) { listeners.action.push(fn); } },
  },
  sidePanel: { async setPanelBehavior() {} },
  alarms: {
    async create() {},
    onAlarm: { addListener(fn) { listeners.alarm.push(fn); } },
  },
  tabs: {
    async query() { return []; },
    async sendMessage() { return null; },
    async create() { throw new Error('unexpected tab create'); },
    async get() { throw new Error('unexpected tab get'); },
    async update() { throw new Error('unexpected tab update'); },
    onRemoved: { addListener(fn) { listeners.tabRemoved.push(fn); } },
    onUpdated: { addListener(fn) { listeners.tabUpdated.push(fn); } },
  },
  debugger: {
    async attach() { throw new Error('unexpected debugger attach during idle combined load'); },
    async detach() {},
    async sendCommand() { throw new Error('unexpected debugger command during idle combined load'); },
    onEvent: { addListener(fn) { listeners.debuggerEvent.push(fn); } },
    onDetach: { addListener(fn) { listeners.debuggerDetach.push(fn); } },
  },
  runtime: {
    id: 'combined-load-extension-id',
    getURL: (p = '') => `chrome-extension://combined-load-extension-id/${p}`,
    getManifest: () => ({ version: '0.6.0' }),
    async openOptionsPage() {},
    reload() {},
    onInstalled: { addListener(fn) { listeners.installed.push(fn); } },
    onStartup: { addListener(fn) { listeners.startup.push(fn); } },
    onMessage: { addListener(fn) { listeners.runtimeMessage.push(fn); } },
    onUpdateAvailable: { addListener(fn) { listeners.updateAvailable.push(fn); } },
  },
};

const context = vm.createContext({
  console,
  URL,
  Headers,
  Request,
  Response,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  crypto: webcrypto,
  indexedDB,
  chrome,
  setTimeout,
  clearTimeout,
  atob,
  btoa,
  fetch: async (input, init = {}) => {
    const call = { input: String(input), headers: new Headers(init.headers || {}), method: init.method || 'GET' };
    fetchCalls.push(call);
    if (call.input.includes('/v1/commands/next')) {
      return new Response(JSON.stringify({ command: null, ordering_policy: 'STRICT_GLM_FIRST_ACTUATED_V1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (call.input.includes('/v1/snapshots')) {
      return new Response(JSON.stringify({ accepted: true }), { status: 202, headers: { 'content-type': 'application/json' } });
    }
    // Compatibility/config fetches fail closed in this harness; runtime must
    // still load and continue with bundled last-known-good/default behavior.
    return new Response(JSON.stringify({ error: 'not configured in combined-load harness' }), { status: 404, headers: { 'content-type': 'application/json' } });
  },
});
context.globalThis = context;
context.importScripts = (...scripts) => {
  for (const relative of scripts) {
    const file = path.resolve(EXT, relative);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
};

vm.runInContext(fs.readFileSync(path.join(EXT, 'background-entry.js'), 'utf8'), context, { filename: 'background-entry.js' });
await new Promise((resolve) => setTimeout(resolve, 180));

assert.ok(listeners.runtimeMessage.length >= 4, `expected operator/runtime message listeners, got ${listeners.runtimeMessage.length}`);
assert.equal(listeners.installed.length, 1, 'install listener not registered');
assert.equal(listeners.alarm.length, 1, 'alarm listener not registered');
assert.ok(listeners.debuggerEvent.length >= 2, 'broker + GLM debugger event listeners not registered');
assert.ok(listeners.debuggerDetach.length >= 2, 'broker + GLM debugger detach listeners not registered');
assert.ok(listeners.tabRemoved.length >= 2, 'operator/broker tab removal listeners not registered');
assert.equal(context.A2_OPERATOR_RUNTIME, '0.6.0-dev.1');
assert.equal(typeof context.A2_DEBUGGER_RUN, 'function');
assert.equal(typeof context.A2_DEBUGGER_HOLD, 'function');
assert.equal(typeof context.A2_CHATGPT_TRUSTED_SEND, 'function');
assert.equal(typeof context.A2_GLM_TRUSTED_SEND, 'function');
assert.equal(typeof context.A2_OPERATOR_CAPTURE_PERCEPTION, 'function');
assert.equal(typeof context.A2_OPERATOR_CAPTURE_OOPIF, 'function');

const commandPoll = fetchCalls.find((call) => call.input.endsWith('/v1/commands/next'));
assert.ok(commandPoll, 'initial remote poll did not reach commands/next');
assert.equal(commandPoll.headers.get('x-a2-chat-bridge-secret'), 'x'.repeat(64), 'pairing header was not sourced from real IndexedDB vault');
assert.equal(local.has('bridgeSecret'), false, 'legacy pairing secret was not removed from chrome.storage.local');
assert.equal(idbSecrets.get('pairing_secret'), 'x'.repeat(64), 'pairing secret was not migrated into IndexedDB vault');

console.log('classic-worker-combined-load-v060: PASS', {
  fetchCalls: fetchCalls.length,
  runtimeMessageListeners: listeners.runtimeMessage.length,
  debuggerEventListeners: listeners.debuggerEvent.length,
  vaultMigrated: true,
});
