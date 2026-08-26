import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(path.resolve('coordination/chat-control-plane/extension/operator-actions.js'), 'utf8');
const local = new Map([
  ['chatgptUrl', 'https://chatgpt.com/c/mock'],
  ['zaiUrl', 'https://chat.z.ai/c/mock']
]);
const listeners = [];
const tabs = [
  { id: 1, url: 'https://chatgpt.com/c/mock' },
  { id: 2, url: 'https://chat.z.ai/c/mock' }
];
let attachedTab = null;
let busyTab = null;
let currentDraft = 'original';
let generating = true;
let scrollY = 100;
let stopPresses = 0;
let stopReleases = 0;
let insertTextCalls = 0;

function assert(condition, message) { if (!condition) throw new Error(message); }
function storage(map) {
  return {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => map.has(k)).map((k) => [k, map.get(k)]));
    }
  };
}

const chrome = {
  runtime: {
    id: 'extid',
    getURL: (p = '') => `chrome-extension://extid/${p}`,
    onMessage: { addListener(fn) { listeners.push(fn); } }
  },
  storage: { local: storage(local) },
  tabs: {
    async query() { return tabs.map((t) => ({ ...t })); },
    async sendMessage(tabId, message) {
      if (message?.type !== 'GET_CHAT_SNAPSHOT') throw new Error('unexpected tab message');
      return { ok: true, snapshot: { platform: tabId === 1 ? 'CHATGPT' : 'GLM_ZAI', generating, composer_text: currentDraft } };
    }
  },
  debugger: {
    async getTargets() { return tabs.map((tab) => ({ tabId: tab.id, attached: Number(tab.id) === Number(busyTab) })); },
    async attach({ tabId }) {
      if (Number(tabId) === Number(busyTab)) throw new Error('busy');
      if (attachedTab != null) throw new Error('already attached');
      attachedTab = tabId;
    },
    async detach({ tabId }) { if (Number(attachedTab) === Number(tabId)) attachedTab = null; },
    async sendCommand({ tabId }, method, params = {}) {
      assert(Number(tabId) === Number(attachedTab), `${method} without owned debugger`);
      if (method === 'Runtime.enable' || method === 'Page.enable') return {};
      if (method === 'Runtime.evaluate') {
        const expression = String(params.expression || '');
        if (expression.includes('stop_not_found') || expression.includes('stop_ambiguous')) {
          return { result: { value: { ok: true, x: 400, y: 300 } } };
        }
        if (expression.includes('scrollX') && expression.includes('innerWidth')) {
          return { result: { value: { x: 0, y: scrollY, w: 800, h: 600 } } };
        }
        return { result: { value: { ok: true, text: currentDraft, tag: 'DIV', contenteditable: true, x: 300, y: 500 } } };
      }
      if (method === 'Input.dispatchKeyEvent') return {};
      if (method === 'Input.insertText') {
        insertTextCalls += 1;
        currentDraft = String(params.text || '');
        return {};
      }
      if (method === 'Input.dispatchMouseEvent') {
        if (params.type === 'mousePressed') stopPresses += 1;
        if (params.type === 'mouseReleased' && params.button === 'left') {
          stopReleases += 1;
          generating = false;
        }
        if (params.type === 'mouseWheel') scrollY += Number(params.deltaY || 0);
        return {};
      }
      throw new Error(`unexpected CDP method ${method}`);
    }
  }
};

const context = vm.createContext({
  chrome, globalThis: null, console, URL, Date, Map, Set, Promise, setTimeout, clearTimeout
});
context.globalThis = context;
vm.runInContext(source, context, { filename: 'operator-actions.js' });

async function dispatch(message, sender) {
  for (const listener of listeners) {
    let resolveResponse;
    const responsePromise = new Promise((resolve) => { resolveResponse = resolve; });
    let immediate = false, value;
    const ret = listener(message, sender, (response) => { immediate = true; value = response; resolveResponse(response); });
    if (immediate) return value;
    if (ret === true) return await Promise.race([responsePromise, new Promise((_, reject) => setTimeout(() => reject(new Error('response timeout')), 2000))]);
  }
  return null;
}

const sidePanel = { id: 'extid', url: 'chrome-extension://extid/sidepanel.html' };
const options = { id: 'extid', url: 'chrome-extension://extid/options.html' };

// Trusted draft replacement is exact and never sends Enter/click.
let rewrite = await context.A2_OPERATOR_TRUSTED_REPLACE_DRAFT(1, 'CHATGPT', 'rewritten exact');
assert(rewrite?.ok === true && rewrite.exact_readback === true, 'trusted rewrite failed');
assert(currentDraft === 'rewritten exact' && insertTextCalls === 1, 'trusted rewrite did not use Input.insertText exactly once');
assert(stopPresses === 0 && stopReleases === 0, 'rewrite accidentally actuated mouse send');

// Untrusted extension pages cannot use operator actions.
let response = await dispatch({ type: 'A2_OPERATOR_ACTION', platform: 'CHATGPT', action: 'SCROLL', delta_y: 300 }, options);
assert(response?.ok === false && response.error === 'operator_sender_not_trusted', 'untrusted page ran operator action');

// Scroll is bounded trusted wheel input.
response = await dispatch({ type: 'A2_OPERATOR_ACTION', platform: 'CHATGPT', action: 'SCROLL', delta_y: 700 }, sidePanel);
assert(response?.ok === true && response.result.action === 'SCROLL', 'scroll action failed');
assert(response.result.before_scroll_y === 100 && response.result.after_scroll_y === 800, 'scroll readback mismatch');

// Stop performs one press/release and verifies generating false.
generating = true;
response = await dispatch({ type: 'A2_OPERATOR_ACTION', platform: 'CHATGPT', action: 'STOP_GENERATION' }, sidePanel);
assert(response?.ok === true && response.result.clicked_stop === true, 'stop action failed');
assert(response.result.generating_before === true && response.result.generating_after === false, 'stop generation verification failed');
assert(stopPresses === 1 && stopReleases === 1, 'stop did not actuate exactly one press/release pair');

// Duplicate exact target blocks before debugger ownership/action.
tabs.push({ id: 3, url: 'https://chatgpt.com/c/mock' });
const pressesBeforeDuplicate = stopPresses;
response = await dispatch({ type: 'A2_OPERATOR_ACTION', platform: 'CHATGPT', action: 'STOP_GENERATION' }, sidePanel);
assert(response?.ok === false && String(response.error).includes('operator_action_duplicate_target_tabs'), 'duplicate target failed open');
assert(stopPresses === pressesBeforeDuplicate, 'duplicate target actuated input');
tabs.pop();

// Foreign debugger ownership blocks before action.
busyTab = 1;
response = await dispatch({ type: 'A2_OPERATOR_ACTION', platform: 'CHATGPT', action: 'SCROLL', delta_y: -300 }, sidePanel);
assert(response?.ok === false && response.error === 'operator_action_debugger_target_busy', 'foreign debugger ownership was inherited');
busyTab = null;

// Invalid primitives are rejected.
response = await dispatch({ type: 'A2_OPERATOR_ACTION', platform: 'CHATGPT', action: 'EXECUTE_JS', code: 'alert(1)' }, sidePanel);
assert(response?.ok === false && response.error === 'operator_action_invalid', 'arbitrary remote executable action was accepted');

console.log('A2 v0.6 Operator Actions Lab: PASS', JSON.stringify({
  draft: currentDraft,
  insert_text_calls: insertTextCalls,
  stop_presses: stopPresses,
  stop_releases: stopReleases,
  scroll_y: scrollY
}));
