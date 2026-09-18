import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto, randomUUID } from 'node:crypto';

const source = fs.readFileSync(path.resolve('coordination/chat-control-plane/extension/operator-control.js'), 'utf8');
const local = new Map([['bridgeSecret', 'must-never-appear-in-status']]);
const session = new Map();
const runtimeListeners = [];
const tabRemovedListeners = [];
const tabUpdatedListeners = [];
const sentToTabs = [];
let panelBehavior = null;
const tabs = new Map([[1, { id: 1, url: 'https://chatgpt.com/c/mock' }]]);

function assert(condition, message) { if (!condition) throw new Error(message); }
function makeStorage(map) {
  return {
    async get(keys) {
      if (keys == null) return Object.fromEntries(map);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => map.has(key)).map((key) => [key, map.get(key)]));
    },
    async set(values) { for (const [key, value] of Object.entries(values || {})) map.set(key, value); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) map.delete(key); }
  };
}

const chrome = {
  runtime: {
    id: 'extid',
    getURL: (p = '') => `chrome-extension://extid/${p}`,
    getManifest: () => ({ version: '0.6.0' }),
    onMessage: { addListener(fn) { runtimeListeners.push(fn); } }
  },
  storage: { local: makeStorage(local), session: makeStorage(session) },
  tabs: {
    async query() { return [...tabs.values()]; },
    async get(id) { if (!tabs.has(id)) throw new Error('No tab'); return tabs.get(id); },
    async sendMessage(tabId, message) {
      sentToTabs.push({ tabId, message: structuredClone(message) });
      if (!tabs.has(tabId)) throw new Error('No tab');
      return { ok: true, action: message?.action || null };
    },
    onRemoved: { addListener(fn) { tabRemovedListeners.push(fn); } },
    onUpdated: { addListener(fn) { tabUpdatedListeners.push(fn); } }
  },
  sidePanel: {
    async setPanelBehavior(value) { panelBehavior = value; }
  }
};

const context = vm.createContext({
  chrome,
  globalThis: null,
  console,
  URL,
  Date,
  TextEncoder,
  setTimeout,
  clearTimeout,
  Promise,
  structuredClone,
  crypto: { subtle: webcrypto.subtle, randomUUID },
  A2_OPERATOR_RUNTIME: '0.6.0-dev.1'
});
context.globalThis = context;
vm.runInContext(source, context, { filename: 'operator-control.js' });
await new Promise((resolve) => setTimeout(resolve, 10));

async function sendRuntime(message, sender) {
  for (const listener of runtimeListeners) {
    let responded = false;
    let responseValue;
    let resolveResponse;
    const responsePromise = new Promise((resolve) => { resolveResponse = resolve; });
    const ret = listener(message, sender, (value) => {
      responded = true;
      responseValue = value;
      resolveResponse(value);
    });
    if (responded) return responseValue;
    if (ret === true) return await Promise.race([
      responsePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout waiting for ${message.type}`)), 1000))
    ]);
  }
  return null;
}

const sidePanelSender = { id: 'extid', url: 'chrome-extension://extid/sidepanel.html' };
const optionsSender = { id: 'extid', url: 'chrome-extension://extid/options.html' };
const chatSender = { id: 'extid', tab: { id: 1, url: 'https://chatgpt.com/c/mock' }, url: 'https://chatgpt.com/c/mock' };

assert(local.get('operatorMode') === 'OBSERVE', 'default operator mode is not OBSERVE');
assert(panelBehavior?.openPanelOnActionClick === true, 'side panel action behavior not installed');

let response = await sendRuntime({ type: 'A2_OPERATOR_STATUS' }, optionsSender);
assert(response?.ok === false && response.error === 'operator_sender_not_trusted', 'untrusted extension page got operator status');

response = await sendRuntime({ type: 'A2_OPERATOR_STATUS' }, sidePanelSender);
assert(response?.ok === true, 'trusted side panel status failed');
assert(!JSON.stringify(response).includes('must-never-appear-in-status'), 'operator status leaked non-whitelisted persistent storage');

response = await sendRuntime({ type: 'A2_OPERATOR_SET_MODE', mode: 'GATE_SEND' }, sidePanelSender);
assert(response?.ok === true && local.get('operatorMode') === 'GATE_SEND', 'trusted mode transition failed');
assert(sentToTabs.some((x) => x.message?.type === 'A2_PROMPT_GATE_CONFIG' && x.message.mode === 'GATE_SEND'), 'mode was not broadcast to page gate');

response = await sendRuntime({ type: 'A2_PROMPT_GATE_READY', platform: 'CHATGPT', page_url: 'https://chatgpt.com/c/mock' }, chatSender);
assert(response?.ok === true && response.mode === 'GATE_SEND', 'page gate did not receive current mode');

response = await sendRuntime({
  type: 'A2_PROMPT_GATE_INTENT', platform: 'CHATGPT', page_url: 'https://chatgpt.com/c/mock', event_type: 'TRUSTED_ENTER', draft: 'hello'
}, chatSender);
assert(response?.ok === true && response.intent_id, 'prompt intent was not accepted');
const firstIntentId = response.intent_id;
assert(session.get('a2OperatorHeldPromptIntentV060')?.original_draft === 'hello', 'held prompt is not in session storage');
assert(![...local.values()].includes('hello'), 'held draft leaked into persistent local storage');

response = await sendRuntime({
  type: 'A2_PROMPT_GATE_INTENT', platform: 'CHATGPT', page_url: 'https://chatgpt.com/c/mock', event_type: 'TRUSTED_ENTER', draft: 'different'
}, chatSender);
assert(response?.ok === false && response.error === 'prompt_gate_intent_already_held', 'second different held intent was not rejected');

response = await sendRuntime({ type: 'A2_OPERATOR_RESOLVE_PROMPT', intent_id: firstIntentId, action: 'ALLOW_ONCE' }, sidePanelSender);
assert(response?.ok === true, 'trusted allow-once resolution failed');
assert(!session.has('a2OperatorHeldPromptIntentV060'), 'resolved prompt remained in session storage');
assert(sentToTabs.some((x) => x.message?.type === 'A2_PROMPT_GATE_RESOLUTION' && x.message.action === 'ALLOW_ONCE' && x.message.draft === 'hello'), 'original allow-once draft was not bound to held intent');

response = await sendRuntime({
  type: 'A2_PROMPT_GATE_INTENT', platform: 'CHATGPT', page_url: 'https://chatgpt.com/c/mock', event_type: 'TRUSTED_SEND_CLICK', draft: 'cancel-me'
}, chatSender);
assert(response?.ok === true, 'second prompt intent failed');
await sendRuntime({ type: 'A2_OPERATOR_SET_MODE', mode: 'OBSERVE' }, sidePanelSender);
assert(!session.has('a2OperatorHeldPromptIntentV060'), 'switching to OBSERVE did not clear held prompt');
assert(sentToTabs.some((x) => x.message?.type === 'A2_PROMPT_GATE_RESOLUTION' && x.message.action === 'CANCEL'), 'switching to OBSERVE did not cancel page intent');

response = await sendRuntime({ type: 'A2_OPERATOR_SET_ARM', armed: true }, sidePanelSender);
assert(response?.ok === true && local.get('armed') === true, 'side panel ARM control failed');

response = await sendRuntime({ type: 'A2_OPERATOR_SET_MODE', mode: 'GATE_SEND' }, chatSender);
assert(response?.ok === false && response.error === 'operator_sender_not_trusted', 'content script gained operator authority');

response = await sendRuntime({
  type: 'A2_PROMPT_GATE_INTENT', platform: 'GLM_ZAI', page_url: 'https://chatgpt.com/c/mock', event_type: 'TRUSTED_ENTER', draft: 'bad-platform'
}, chatSender);
assert(response?.ok === false && response.error === 'prompt_gate_sender_invalid', 'platform binding mismatch was accepted');

response = await sendRuntime({
  type: 'A2_PROMPT_GATE_SENSOR_ERROR', platform: 'CHATGPT', event_type: 'TRUSTED_ENTER', error: 'composer_ambiguous'
}, chatSender);
assert(response?.ok === true && local.get('operatorSensorLastError') === 'composer_ambiguous', 'redacted sensor error was not recorded');

console.log('A2 v0.6 Operator Control Lab: PASS', JSON.stringify({
  mode: local.get('operatorMode'),
  armed: local.get('armed'),
  tab_messages: sentToTabs.length,
  local_keys: [...local.keys()].sort(),
  session_keys: [...session.keys()].sort()
}));
