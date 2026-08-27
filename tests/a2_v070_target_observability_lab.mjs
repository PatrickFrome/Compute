import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('coordination/chat-control-plane/extension/target-observability.js', 'utf8');
const sessionState = {};
const listeners = [];
const bindings = new Map([
  ['gpt_primary', { target_id: 'gpt_primary', tab_id: 11, conversation_epoch: 1 }],
  ['gpt_critic', { target_id: 'gpt_critic', tab_id: 12, conversation_epoch: 1 }]
]);
const bindCalls = [];
const targets = [
  { target_id: 'gpt_primary', provider: 'OPENAI', platform: 'CHATGPT', surface: 'WEB_CHAT', role: 'OPERATOR_PRIMARY', conversation_epoch: 1, conversation_url: 'https://chatgpt.com/c/alpha', status: 'ACTIVE' },
  { target_id: 'gpt_critic', provider: 'OPENAI', platform: 'CHATGPT', surface: 'WEB_CHAT', role: 'CRITIC', conversation_epoch: 1, conversation_url: 'https://chatgpt.com/c/beta', status: 'ACTIVE' },
  { target_id: 'glm_primary', provider: 'ZAI', platform: 'GLM_ZAI', surface: 'WEB_CHAT', role: 'OPERATOR_PREDECESSOR', conversation_epoch: 1, conversation_url: 'https://chat.z.ai/c/glm', status: 'ACTIVE' }
];

function normUrl(value) {
  try {
    const u = new URL(String(value || ''));
    u.hash = ''; u.search = ''; u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.origin}${u.pathname}`;
  } catch { return ''; }
}
function platformOf(value) {
  try {
    const host = new URL(String(value || '')).hostname.toLowerCase();
    if (host === 'chatgpt.com' || host === 'chat.openai.com') return 'CHATGPT';
    if (host === 'chat.z.ai') return 'GLM_ZAI';
  } catch {}
  return 'UNKNOWN';
}

const chrome = {
  storage: {
    session: {
      async get(key) {
        if (typeof key === 'string') return Object.prototype.hasOwnProperty.call(sessionState, key) ? { [key]: structuredClone(sessionState[key]) } : {};
        return structuredClone(sessionState);
      },
      async set(values) { for (const [key, value] of Object.entries(values || {})) sessionState[key] = structuredClone(value); }
    }
  },
  runtime: {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    getURL(path = '') { return `chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/${String(path).replace(/^\//, '')}`; },
    onMessage: { addListener(fn) { listeners.push(fn); } }
  }
};

const registry = {
  ready: Promise.resolve(),
  normUrl,
  platformOf,
  async listTargets({ includeRetired = false } = {}) { return structuredClone(targets.filter((t) => includeRetired || t.status !== 'RETIRED')); },
  async getBinding(targetId) { return bindings.has(targetId) ? structuredClone(bindings.get(targetId)) : null; },
  async bindObservedTab(tab) { bindCalls.push({ ...tab }); return { tab_id: tab.id }; }
};

const context = vm.createContext({
  chrome, globalThis: null, console, URL, Date, Promise, JSON, String, Number, Boolean, Object, Array, Error, structuredClone
});
context.globalThis = context;
context.A2_TARGET_REGISTRY = registry;
vm.runInContext(source, context, { filename: 'target-observability.js' });

const secretMessage = 'DO_NOT_PERSIST_FULL_MESSAGE_TEXT';
const alphaSnapshot = {
  schema: 'metaengine.chat-dom-snapshot.v3',
  platform: 'CHATGPT',
  url: 'https://chatgpt.com/c/alpha?ignored=1',
  captured_at: '2026-08-27T20:00:00.000Z',
  generating: true,
  processing_active: false,
  generation_signal: 'STOP_CONTROL',
  composer_present: true,
  composer_text: 'draft text',
  dom_pair_error: null,
  message_count: 7,
  messages: [{ role: 'assistant', text: secretMessage }],
  visibility_state: 'visible'
};

let entry = await context.A2_TARGET_OBSERVABILITY.observe({ id: 11, url: 'https://chatgpt.com/c/alpha' }, alphaSnapshot);
assert.equal(entry.target_id, 'gpt_primary');
assert.equal(entry.observed_tab_id, 11);
assert.equal(entry.generating, true);
assert.equal(entry.composer_present, true);
assert.equal(entry.composer_empty, false);
assert.equal(entry.composer_length, 'draft text'.length);
assert.equal(entry.message_count, 7);
assert.equal(entry.conversation_epoch, 1);
assert.equal(entry.authority_effect, false);
assert.equal(entry.tainted_page_data, true);
assert.equal(Object.hasOwn(entry, 'messages'), false);
assert.equal(Object.hasOwn(entry, 'composer_text'), false);
assert.equal(JSON.stringify(sessionState).includes(secretMessage), false, 'full message text leaked into observability index');
assert.equal(JSON.stringify(sessionState).includes('draft text'), false, 'composer text leaked into observability index');

entry = await context.A2_TARGET_OBSERVABILITY.observe({ id: 12, url: 'https://chatgpt.com/c/beta' }, {
  ...alphaSnapshot,
  url: 'https://chatgpt.com/c/beta',
  generating: false,
  composer_text: '',
  message_count: 3
});
assert.equal(entry.target_id, 'gpt_critic');
assert.equal(entry.composer_empty, true);

assert.equal(await context.A2_TARGET_OBSERVABILITY.observe({ id: 11, url: 'https://chatgpt.com/c/alpha' }, { ...alphaSnapshot, platform: 'GLM_ZAI' }), null, 'claimed platform spoof was accepted');
assert.equal(await context.A2_TARGET_OBSERVABILITY.observe({ id: 11, url: 'https://chatgpt.com/c/alpha' }, { ...alphaSnapshot, url: 'https://chatgpt.com/c/beta' }), null, 'snapshot URL mismatch was accepted');
assert.equal(await context.A2_TARGET_OBSERVABILITY.observe({ id: 99, url: 'https://chatgpt.com/c/unregistered' }, { ...alphaSnapshot, url: 'https://chatgpt.com/c/unregistered' }), null, 'unregistered tab produced health state');

let inventory = await context.A2_TARGET_OBSERVABILITY.inventory();
assert.equal(inventory.length, 3);
assert.equal(inventory.find((row) => row.target.target_id === 'gpt_primary').health.target_id, 'gpt_primary');
assert.equal(inventory.find((row) => row.target.target_id === 'gpt_critic').health.target_id, 'gpt_critic');
assert.equal(inventory.find((row) => row.target.target_id === 'glm_primary').health, null);
assert.equal(inventory.find((row) => row.target.target_id === 'gpt_primary').health_fresh_for_epoch, true);

// Rollover makes old observation stale without deleting historical health.
targets.find((t) => t.target_id === 'gpt_primary').conversation_epoch = 2;
targets.find((t) => t.target_id === 'gpt_primary').conversation_url = 'https://chatgpt.com/c/alpha-next';
inventory = await context.A2_TARGET_OBSERVABILITY.inventory();
assert.equal(inventory.find((row) => row.target.target_id === 'gpt_primary').health_fresh_for_epoch, false);

// CHAT_SNAPSHOT listener is passive and must never own acknowledgement semantics.
const snapshotListener = listeners.find((listener) => listener({ type: 'CHAT_SNAPSHOT', snapshot: alphaSnapshot }, { tab: { id: 11, url: 'https://chatgpt.com/c/alpha' } }, () => {}) === false);
assert.ok(snapshotListener, 'observability did not register a passive CHAT_SNAPSHOT listener');

async function dispatch(message, sender) {
  for (const listener of listeners) {
    let responseSet = false;
    let responseValue;
    let resolver;
    const response = new Promise((resolve) => { resolver = resolve; });
    const returned = listener(message, sender, (value) => { responseSet = true; responseValue = value; resolver(value); });
    if (responseSet) return responseValue;
    if (returned === true) return Promise.race([response, new Promise((_, reject) => setTimeout(() => reject(new Error('response timeout')), 1000))]);
  }
  return null;
}

const sidePanel = { id: chrome.runtime.id, url: chrome.runtime.getURL('sidepanel.html') };
const webPage = { id: 'not-extension', url: 'https://chatgpt.com/' };
let response = await dispatch({ type: 'A2_TARGET_OBSERVABILITY_LIST' }, webPage);
assert.equal(response?.ok, false);
assert.equal(response?.error, 'target_observability_sender_not_trusted');
response = await dispatch({ type: 'A2_TARGET_OBSERVABILITY_LIST' }, sidePanel);
assert.equal(response?.ok, true);
assert.equal(response.result.length, 3);

assert.ok(bindCalls.length >= 2, 'observed trusted tabs were not offered to target registry binding');
console.log('A2 v0.7.0 target observability contract: PASS', {
  health_entries: Object.keys(sessionState.a2TargetObservabilityV1.entries).length,
  logical_targets: inventory.length,
  bind_calls: bindCalls.length
});
