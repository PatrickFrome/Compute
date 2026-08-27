import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = fs.readFileSync('coordination/chat-control-plane/extension/target-registry.js', 'utf8');

function area(initial, onChanged, areaName) {
  const state = structuredClone(initial || {});
  return {
    state,
    async get(keys) {
      if (keys == null) return structuredClone(state);
      const out = {};
      const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
      for (const key of list) {
        if (Object.prototype.hasOwnProperty.call(state, key)) out[key] = structuredClone(state[key]);
        else if (keys && typeof keys === 'object' && !Array.isArray(keys) && typeof keys !== 'string') out[key] = keys[key];
      }
      return out;
    },
    async set(values) {
      const changes = {};
      for (const [key, value] of Object.entries(values || {})) {
        const oldValue = structuredClone(state[key]);
        state[key] = structuredClone(value);
        changes[key] = { oldValue, newValue: structuredClone(value) };
      }
      for (const listener of onChanged) listener(changes, areaName);
    },
    async remove(keys) {
      for (const key of (Array.isArray(keys) ? keys : [keys])) delete state[key];
    }
  };
}

function harness({ localInitial = {}, sessionInitial = {}, tabs = [] } = {}) {
  const storageListeners = [];
  const runtimeListeners = [];
  const removedListeners = [];
  const updatedListeners = [];
  const local = area(localInitial, storageListeners, 'local');
  const session = area(sessionInitial, storageListeners, 'session');
  const tabRows = tabs.map((tab) => ({ ...tab }));
  const chrome = {
    storage: {
      local,
      session,
      onChanged: { addListener(fn) { storageListeners.push(fn); } }
    },
    runtime: {
      id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      getURL(path = '') { return `chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/${String(path).replace(/^\//, '')}`; },
      onMessage: { addListener(fn) { runtimeListeners.push(fn); } }
    },
    tabs: {
      async query() { return tabRows.map((row) => ({ ...row })); },
      async get(id) {
        const row = tabRows.find((tab) => Number(tab.id) === Number(id));
        if (!row) throw new Error('No tab with id');
        return { ...row };
      },
      onRemoved: { addListener(fn) { removedListeners.push(fn); } },
      onUpdated: { addListener(fn) { updatedListeners.push(fn); } }
    }
  };
  const context = vm.createContext({
    chrome,
    crypto: webcrypto,
    URL,
    Date,
    Promise,
    JSON,
    String,
    Number,
    Boolean,
    Object,
    Array,
    Set,
    Error,
    console,
    globalThis: null
  });
  context.globalThis = context;
  vm.runInContext(source, context, { filename: 'target-registry.js' });
  return { context, chrome, local, session, tabRows, runtimeListeners, removedListeners, updatedListeners };
}

const h = harness({
  localInitial: {
    chatgptUrl: 'https://chatgpt.com/c/alpha?junk=1#hash',
    zaiUrl: 'https://chat.z.ai/c/glm-alpha/'
  },
  tabs: [
    { id: 11, url: 'https://chatgpt.com/c/alpha' },
    { id: 22, url: 'https://chat.z.ai/c/glm-alpha' }
  ]
});

await h.context.A2_TARGET_REGISTRY.ready;
let targets = await h.context.A2_TARGET_REGISTRY.listTargets();
assert.equal(targets.length, 2);
assert.equal(JSON.stringify([...targets].map((t) => t.target_id).sort()), JSON.stringify(['glm_primary', 'gpt_primary']));
const gpt = targets.find((t) => t.target_id === 'gpt_primary');
assert.equal(gpt.platform, 'CHATGPT');
assert.equal(gpt.provider, 'OPENAI');
assert.equal(gpt.conversation_url, 'https://chatgpt.com/c/alpha');
assert.equal(gpt.conversation_epoch, 1);
assert.equal(Object.hasOwn(gpt, 'tab_id'), false, 'persistent logical target must not contain tab_id');

const resolvedLegacy = await h.context.A2_TARGET_REGISTRY.resolveSelector('CHATGPT');
assert.equal(resolvedLegacy.target_id, 'gpt_primary');
const live = await h.context.A2_TARGET_REGISTRY.resolveLiveTab('gpt_primary');
assert.equal(live.tab.id, 11);
assert.equal(live.binding.target_id, 'gpt_primary');
assert.equal(live.binding.tab_id, 11);
assert.equal(live.binding.conversation_epoch, 1);

const persistent = h.local.state.a2TargetRegistryV1;
assert.ok(persistent);
assert.equal(JSON.stringify(persistent).includes('"tab_id"'), false, 'tab ids must not leak into chrome.storage.local registry');
const sessionBindings = structuredClone(h.session.state.a2TargetBindingsV1);
assert.equal(sessionBindings.bindings.gpt_primary.tab_id, 11);
assert.ok(sessionBindings.browser_session_nonce);

const worker2 = await h.context.A2_TARGET_REGISTRY.createTarget({
  platform: 'CHATGPT',
  role: 'CRITIC',
  conversation_url: 'https://chatgpt.com/c/beta'
});
assert.match(worker2.target_id, /^gpt_[a-f0-9]{20}$/);
assert.equal(worker2.platform, 'CHATGPT');
assert.equal(worker2.conversation_epoch, 1);
targets = await h.context.A2_TARGET_REGISTRY.listTargets();
assert.equal(targets.filter((t) => t.platform === 'CHATGPT').length, 2, 'multiple GPT logical targets must coexist');

await assert.rejects(
  h.context.A2_TARGET_REGISTRY.createTarget({ platform: 'CHATGPT', conversation_url: 'https://chatgpt.com/c/alpha' }),
  /target_registry_duplicate_active_url/
);

const rolled = await h.context.A2_TARGET_REGISTRY.updateConversation('gpt_primary', 'https://chatgpt.com/c/alpha-next');
assert.equal(rolled.target_id, 'gpt_primary', 'rollover must preserve logical identity');
assert.equal(rolled.conversation_epoch, 2);
assert.equal(rolled.conversation_url, 'https://chatgpt.com/c/alpha-next');
assert.equal(h.local.state.chatgptUrl, 'https://chatgpt.com/c/alpha-next', 'legacy alias must stay compatible');
assert.equal((await h.context.A2_TARGET_REGISTRY.getBinding('gpt_primary')), null, 'rollover must invalidate ephemeral binding');

h.tabRows[0].url = 'https://chatgpt.com/c/alpha-next';
let rebound = await h.context.A2_TARGET_REGISTRY.resolveLiveTab('CHATGPT');
assert.equal(rebound.target.target_id, 'gpt_primary');
assert.equal(rebound.binding.conversation_epoch, 2);

// A legacy config change may not steal another logical target's exact URL.
h.local.state.chatgptUrl = 'https://chatgpt.com/c/beta';
await assert.rejects(
  h.context.A2_TARGET_REGISTRY.syncLegacySeeds(),
  new RegExp(`target_registry_legacy_url_conflict:CHATGPT:${worker2.target_id}`)
);
assert.equal(h.local.state.chatgptUrl, 'https://chatgpt.com/c/alpha-next', 'conflicting legacy URL was not rolled back');
assert.equal(h.local.state.a2TargetRegistryLastError?.code, 'LEGACY_URL_CONFLICT');
assert.equal(h.local.state.a2TargetRegistryLastError?.conflicting_target_id, worker2.target_id);
assert.equal((await h.context.A2_TARGET_REGISTRY.resolveSelector('CHATGPT')).conversation_epoch, 2, 'conflict mutated logical epoch');

// Clearing a legacy URL invalidates the old physical binding but must not reuse its epoch later.
h.local.state.chatgptUrl = '';
await h.context.A2_TARGET_REGISTRY.syncLegacySeeds();
let unbound = await h.context.A2_TARGET_REGISTRY.resolveSelector('CHATGPT');
assert.equal(unbound.status, 'UNBOUND');
assert.equal(unbound.conversation_url, null);
assert.equal(unbound.conversation_epoch, 2);
assert.equal(await h.context.A2_TARGET_REGISTRY.getBinding('gpt_primary'), null, 'legacy unbind left stale physical binding');

h.local.state.chatgptUrl = 'https://chatgpt.com/c/alpha-next';
await h.context.A2_TARGET_REGISTRY.syncLegacySeeds();
const reboundLogical = await h.context.A2_TARGET_REGISTRY.resolveSelector('CHATGPT');
assert.equal(reboundLogical.target_id, 'gpt_primary');
assert.equal(reboundLogical.conversation_epoch, 3, 'reappearing conversation reused an old epoch');
assert.equal(reboundLogical.status, 'ACTIVE');
assert.equal(h.local.state.a2TargetRegistryLastError, undefined, 'successful reconciliation did not clear diagnostic');
rebound = await h.context.A2_TARGET_REGISTRY.resolveLiveTab('gpt_primary');
assert.equal(rebound.binding.conversation_epoch, 3);

await h.context.A2_TARGET_REGISTRY.retireTarget(worker2.target_id);
targets = await h.context.A2_TARGET_REGISTRY.listTargets();
assert.equal(targets.some((t) => t.target_id === worker2.target_id), false);
assert.equal((await h.context.A2_TARGET_REGISTRY.listTargets({ includeRetired: true })).some((t) => t.target_id === worker2.target_id), true);

const localSnapshot = structuredClone(h.local.state);
const h2 = harness({ localInitial: localSnapshot, sessionInitial: {}, tabs: [{ id: 101, url: 'https://chatgpt.com/c/alpha-next' }, { id: 202, url: 'https://chat.z.ai/c/glm-alpha' }] });
await h2.context.A2_TARGET_REGISTRY.ready;
const gptAfterRestart = await h2.context.A2_TARGET_REGISTRY.resolveSelector('CHATGPT');
assert.equal(gptAfterRestart.target_id, 'gpt_primary');
assert.equal(gptAfterRestart.conversation_epoch, 3);
assert.equal(await h2.context.A2_TARGET_REGISTRY.getBinding('gpt_primary'), null, 'browser restart must not restore prior tab binding');
const reboundAfterRestart = await h2.context.A2_TARGET_REGISTRY.resolveLiveTab('gpt_primary');
assert.equal(reboundAfterRestart.tab.id, 101);
assert.equal(reboundAfterRestart.binding.conversation_epoch, 3);
assert.notEqual(h2.session.state.a2TargetBindingsV1.browser_session_nonce, h.session.state.a2TargetBindingsV1.browser_session_nonce);

console.log('A2 v0.7.0 target registry contract: PASS', {
  logical_targets: (await h2.context.A2_TARGET_REGISTRY.listTargets({ includeRetired: true })).length,
  gpt_target_id: gptAfterRestart.target_id,
  epoch: gptAfterRestart.conversation_epoch,
  rebound_tab_id: reboundAfterRestart.tab.id
});
