import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(path.resolve('coordination/chat-control-plane/extension/update-manager.js'), 'utf8');
const STATE_KEY = 'a2OperatorUpdateStateV060';
const PENDING_KEY = 'a2BridgePendingCommandV0523';
const local = new Map([
  [STATE_KEY, {
    status: 'WAITING_SAFE_BOUNDARY',
    target_version: '0.7.2',
    blocked_by: ['pending_command:restart-pending'],
    updated_at: new Date().toISOString()
  }],
  [PENDING_KEY, { command_id: 'restart-pending' }]
]);
const session = new Map();
const alarmListeners = [];
const alarms = new Map();
const baseCalls = [];
let reloadCalls = 0;

function assert(condition, message) { if (!condition) throw new Error(message); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function storage(map) {
  return {
    async get(keys) {
      const list = keys == null ? [...map.keys()] : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => map.has(key)).map((key) => [key, map.get(key)]));
    },
    async set(items) { for (const [key, value] of Object.entries(items || {})) map.set(key, value); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) map.delete(key); }
  };
}

const chrome = {
  storage: { local: storage(local), session: storage(session) },
  runtime: {
    getManifest: () => ({ version: '0.7.1' }),
    onUpdateAvailable: { addListener() {} },
    onInstalled: { addListener() {} },
    reload() { reloadCalls += 1; }
  },
  alarms: {
    async create(name, options) { alarms.set(name, options); },
    async clear(name) { return alarms.delete(name); },
    onAlarm: { addListener(fn) { alarmListeners.push(fn); } }
  }
};

const context = vm.createContext({
  chrome,
  globalThis: null,
  console,
  Date,
  Map,
  Set,
  Promise,
  Response,
  JSON,
  setTimeout,
  clearTimeout
});
context.globalThis = context;
context.A2_BRIDGE_REQUEST = async (route, init = {}) => {
  baseCalls.push({ route, init });
  return new Response(JSON.stringify({ source: 'base', route }), { status: 200, headers: { 'content-type': 'application/json' } });
};
context.A2_DEBUGGER_STATUS = () => [];

vm.runInContext(source, context, { filename: 'update-manager.js' });
await context.A2_UPDATE_DRAIN_READY;
await sleep(20);

assert(context.A2_UPDATE_DRAIN_ACTIVE() === true, 'persisted update drain was not restored after worker restart');
assert(alarms.has('a2-operator-update-drain'), 'drain alarm was not restored after worker restart');
assert(local.get(STATE_KEY)?.status === 'WAITING_SAFE_BOUNDARY', 'restart recovery lost waiting-safe-boundary state');
assert(String(local.get(STATE_KEY)?.blocked_by || '').includes('pending_command'), 'restart recovery did not re-evaluate durable blocker');
assert(reloadCalls === 0, 'restart recovery reloaded across a pending command');

const response = await context.A2_BRIDGE_REQUEST('/v1/commands/next', { method: 'POST' });
const body = await response.json();
assert(body.command === null && body.update_drain === true, 'rehydrated drain did not suppress new command lease');
assert(!baseCalls.some((call) => call.route === '/v1/commands/next'), 'rehydrated drain leaked command-next to backend');

local.delete(PENDING_KEY);
for (const listener of alarmListeners) listener({ name: 'a2-operator-update-drain' });
await sleep(20);
assert(reloadCalls === 1, 'rehydrated drain did not reload at first safe boundary');
assert(local.get(STATE_KEY)?.status === 'SAFE_RELOAD', 'rehydrated drain did not persist safe reload state');

console.log('A2 v0.7.1 Update Manager Restart Lab: PASS', JSON.stringify({
  rehydrated: true,
  suppressed_command_next: true,
  reload_calls: reloadCalls,
  final_status: local.get(STATE_KEY)?.status
}));
