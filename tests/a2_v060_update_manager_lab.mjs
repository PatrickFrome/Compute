import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(path.resolve('coordination/chat-control-plane/extension/update-manager.js'), 'utf8');
const local = new Map();
const session = new Map();
const updateListeners = [];
const installedListeners = [];
const alarmListeners = [];
const alarms = new Map();
let baseCalls = [];
let reloadCalls = 0;

function assert(condition, message) { if (!condition) throw new Error(message); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function storage(map) {
  return {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => map.has(key)).map((key) => [key, map.get(key)]));
    },
    async set(items) { for (const [key, value] of Object.entries(items || {})) map.set(key, value); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) map.delete(key); }
  };
}

const chrome = {
  storage: { local: storage(local), session: storage(session) },
  runtime: {
    getManifest: () => ({ version: '0.6.0' }),
    onUpdateAvailable: { addListener(fn) { updateListeners.push(fn); } },
    onInstalled: { addListener(fn) { installedListeners.push(fn); } },
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

local.set('a2BridgePendingCommandV0523', { command_id: 'pending-1' });
for (const listener of updateListeners) listener({ version: '0.6.1' });
await sleep(25);

assert(context.A2_UPDATE_DRAIN_ACTIVE() === true, 'update drain did not activate');
assert(alarms.has('a2-operator-update-drain'), 'update drain alarm not created');
assert(local.get('a2OperatorUpdateStateV060')?.status === 'WAITING_SAFE_BOUNDARY', 'pending command did not block reload');
assert(reloadCalls === 0, 'extension reloaded across pending command');

const nextResponse = await context.A2_BRIDGE_REQUEST('/v1/commands/next', { method: 'POST' });
const nextBody = await nextResponse.json();
assert(nextBody.command === null && nextBody.update_drain === true, 'new command lease was not suppressed while draining');
assert(!baseCalls.some((call) => call.route === '/v1/commands/next'), 'suppressed command-next still reached backend');

await context.A2_BRIDGE_REQUEST('/v1/commands/abc/result', { method: 'POST' });
assert(baseCalls.some((call) => call.route.includes('/result')), 'result delivery was incorrectly blocked by update drain');

local.delete('a2BridgePendingCommandV0523');
local.set('a2GlmTransportV0523', [{ state: 'ACTUATED', command_id: 'glm-1' }]);
for (const listener of alarmListeners) listener({ name: 'a2-operator-update-drain' });
await sleep(20);
assert(reloadCalls === 0, 'extension reloaded during active GLM transport');
assert(String(local.get('a2OperatorUpdateStateV060')?.blocked_by || '').includes('glm_transport'), 'GLM transport was not reported as update blocker');

local.set('a2GlmTransportV0523', [{ state: 'RELEASED', command_id: 'glm-1' }]);
session.set('a2OperatorHeldPromptIntentV060', { intent_id: 'intent-1' });
for (const listener of alarmListeners) listener({ name: 'a2-operator-update-drain' });
await sleep(20);
assert(reloadCalls === 0, 'extension reloaded while prompt intent was held');

session.delete('a2OperatorHeldPromptIntentV060');
for (const listener of alarmListeners) listener({ name: 'a2-operator-update-drain' });
await sleep(20);
assert(reloadCalls === 1, 'extension did not reload at first safe transaction boundary');
assert(local.get('a2OperatorUpdateStateV060')?.status === 'SAFE_RELOAD', 'safe reload state was not persisted');

console.log('A2 v0.6 Update Manager Lab: PASS', JSON.stringify({ reload_calls: reloadCalls, base_calls: baseCalls.map((call) => call.route) }));
