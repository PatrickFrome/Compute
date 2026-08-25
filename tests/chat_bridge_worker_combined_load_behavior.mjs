import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXT = path.join(ROOT, 'coordination', 'chat-control-plane', 'extension');
const REMOTE = 'https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-chat-bridge-remote';
const ZAI = 'https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db';

const storage = new Map([
  ['bridgeSecret', 'x'.repeat(64)],
  ['daemonUrl', REMOTE],
  ['armed', false],
  ['autoOpenTabs', true],
  ['pollMs', 2500],
  ['chatgptUrl', ''],
  ['zaiUrl', ZAI],
]);
const listeners = {
  runtimeMessage: [], installed: [], startup: [], alarm: [], action: [], storage: [],
};
let fetchCalls = 0;
let lastFetch = null;

const chrome = {
  storage: {
    local: {
      async get(keys) {
        if (typeof keys === 'string') return { [keys]: storage.get(keys) };
        const out = {};
        const names = Array.isArray(keys) ? keys : Object.keys(keys || {});
        for (const key of names) if (storage.has(key)) out[key] = storage.get(key);
        return out;
      },
      async set(obj) {
        for (const [key, value] of Object.entries(obj || {})) storage.set(key, value);
      },
      async setAccessLevel() {},
    },
    onChanged: { addListener(fn) { listeners.storage.push(fn); } },
  },
  action: {
    async setBadgeText() {},
    async setBadgeBackgroundColor() {},
    async setTitle() {},
    onClicked: { addListener(fn) { listeners.action.push(fn); } },
  },
  alarms: {
    async create() {},
    onAlarm: { addListener(fn) { listeners.alarm.push(fn); } },
  },
  tabs: {
    async query() { return []; },
    async sendMessage() { return null; },
    async create() { throw new Error('unexpected tab create'); },
    async get() { throw new Error('unexpected tab get'); },
  },
  runtime: {
    onInstalled: { addListener(fn) { listeners.installed.push(fn); } },
    onStartup: { addListener(fn) { listeners.startup.push(fn); } },
    onMessage: { addListener(fn) { listeners.runtimeMessage.push(fn); } },
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
  crypto: webcrypto,
  chrome,
  setTimeout,
  clearTimeout,
  fetch: async (input, init = {}) => {
    fetchCalls += 1;
    lastFetch = { input: String(input), headers: new Headers(init.headers || {}) };
    return new Response(JSON.stringify({ command: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
});
context.globalThis = context;
context.importScripts = (...scripts) => {
  for (const relative of scripts) {
    const file = path.resolve(EXT, relative);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
};

vm.runInContext(
  fs.readFileSync(path.join(EXT, 'background-entry.js'), 'utf8'),
  context,
  { filename: 'background-entry.js' },
);
await new Promise((resolve) => setTimeout(resolve, 80));

assert.equal(listeners.runtimeMessage.length, 1, 'runtime message listener not registered');
assert.equal(listeners.installed.length, 1, 'install listener not registered');
assert.equal(listeners.alarm.length, 1, 'alarm listener not registered');
assert.ok(fetchCalls >= 1, 'initial remote poll did not reach wrapped fetch chain');
assert.ok(lastFetch?.input.endsWith('/v1/commands/next'), 'initial poll did not reach commands/next');
assert.equal(lastFetch?.headers.get('x-a2-chat-bridge-secret'), 'x'.repeat(64), 'pairing header was not chained through wrappers');
console.log('classic-worker-combined-load: PASS', { fetchCalls });
