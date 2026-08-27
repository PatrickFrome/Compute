import crypto from 'node:crypto';
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
let currentDraft = 'original';
let generating = true;
let scrollY = 100;
let mousePresses = 0;
let mouseReleases = 0;
let insertTextCalls = 0;
let screenshotBytes = Buffer.from('stable-frame');
let hitMode = 'safe';
let backendNodeId = 42;

function assert(condition, message) { if (!condition) throw new Error(message); }
function storage(map) {
  return {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => map.has(k)).map((k) => [k, map.get(k)]));
    }
  };
}
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const chrome = {
  runtime: {
    id: 'extid',
    getURL: (p = '') => `chrome-extension://extid/${p}`,
    onMessage: { addListener(fn) { listeners.push(fn); } }
  },
  storage: { local: storage(local) },
  tabs: {
    async query() { return tabs.map((t) => ({ ...t })); },
    async get(tabId) { return { ...tabs.find((tab) => Number(tab.id) === Number(tabId)) }; },
    async sendMessage(tabId, message) {
      if (message?.type !== 'GET_CHAT_SNAPSHOT') throw new Error('unexpected tab message');
      return { ok: true, snapshot: { platform: tabId === 1 ? 'CHATGPT' : 'GLM_ZAI', generating, composer_text: currentDraft } };
    }
  }
};

async function sessionSend(method, params = {}) {
  if (method === 'Runtime.enable' || method === 'Page.enable' || method === 'DOM.enable') return {};
  if (method === 'Page.captureScreenshot') return { data: screenshotBytes.toString('base64') };
  if (method === 'DOM.getNodeForLocation') return { backendNodeId, frameId: 'main-frame', nodeId: 5 };
  if (method === 'DOM.describeNode') {
    return { node: { backendNodeId, nodeName: 'BUTTON', localName: 'button', attributes: ['id', backendNodeId === 42 ? 'safe' : 'replacement', 'role', 'button'] } };
  }
  if (method === 'Runtime.evaluate') {
    const expression = String(params.expression || '');
    if (expression.includes('anchor_download') && expression.includes('elementFromPoint')) {
      if (hitMode === 'external') return { result: { value: { ok: true, tag: 'A', disabled: false, input_type: null, anchor_download: false, anchor_href: 'https://evil.example/' } } };
      if (hitMode === 'download') return { result: { value: { ok: true, tag: 'A', disabled: false, input_type: null, anchor_download: true, anchor_href: 'https://chatgpt.com/file' } } };
      if (hitMode === 'file') return { result: { value: { ok: true, tag: 'INPUT', disabled: false, input_type: 'file', anchor_download: false, anchor_href: null } } };
      return { result: { value: { ok: true, tag: 'BUTTON', id: 'safe', disabled: false, input_type: null, anchor_download: false, anchor_href: null, bounds: [100, 120, 80, 60] } } };
    }
    if (expression.includes('stop_not_found') || expression.includes('stop_ambiguous')) return { result: { value: { ok: true, x: 400, y: 300 } } };
    if (expression.includes('scrollX') && expression.includes('innerWidth')) return { result: { value: { x: 0, y: scrollY, w: 800, h: 600 } } };
    return { result: { value: { ok: true, text: currentDraft, tag: 'DIV', contenteditable: true, x: 300, y: 500 } } };
  }
  if (method === 'Input.dispatchKeyEvent') return {};
  if (method === 'Input.insertText') { insertTextCalls += 1; currentDraft = String(params.text || ''); return {}; }
  if (method === 'Input.dispatchMouseEvent') {
    if (params.type === 'mousePressed') mousePresses += 1;
    if (params.type === 'mouseReleased' && params.button === 'left') { mouseReleases += 1; generating = false; }
    if (params.type === 'mouseWheel') scrollY += Number(params.deltaY || 0);
    return {};
  }
  throw new Error(`unexpected CDP method ${method}`);
}

const frameToken = 'f'.repeat(64);
const perceptionCache = new Map([
  ['CHATGPT', {
    frame_token: frameToken,
    captured_at: new Date().toISOString(),
    tab_id: 1,
    url: 'https://chatgpt.com/c/mock',
    page: { viewport: { width: 800, height: 600 }, scroll: { x: 0, y: 0 } },
    dom_snapshot: { visible_records: [
      { backend_node_id: 42, node_name: 'BUTTON', attributes: { id: 'safe', role: 'button' }, bounds: [100, 120, 80, 60] }
    ] },
    hashes: { screenshot_sha256: sha256(screenshotBytes) }
  }]
]);

const context = vm.createContext({
  chrome,
  globalThis: null,
  console,
  URL,
  Date,
  Map,
  Set,
  Promise,
  Uint8Array,
  TextEncoder,
  atob,
  crypto: crypto.webcrypto,
  setTimeout,
  clearTimeout
});
context.globalThis = context;
context.A2_OPERATOR_PERCEPTION_CACHE = perceptionCache;
context.A2_DEBUGGER_RUN = async (tabId, owner, operation) => operation({ tabId, owner, send: sessionSend });
vm.runInContext(source, context, { filename: 'operator-actions.js' });

async function dispatch(message, sender) {
  for (const listener of listeners) {
    let resolveResponse;
    const responsePromise = new Promise((resolve) => { resolveResponse = resolve; });
    let immediate = false, value;
    const ret = listener(message, sender, (response) => { immediate = true; value = response; resolveResponse(response); });
    if (immediate) return value;
    if (ret === true) return await Promise.race([responsePromise, new Promise((_, reject) => setTimeout(() => reject(new Error('response timeout')), 2500))]);
  }
  return null;
}

const sidePanel = { id: 'extid', url: 'chrome-extension://extid/sidepanel.html' };
const options = { id: 'extid', url: 'chrome-extension://extid/options.html' };

let rewrite = await context.A2_OPERATOR_TRUSTED_REPLACE_DRAFT(1, 'CHATGPT', 'rewritten exact');
assert(rewrite?.ok === true && rewrite.exact_readback === true, 'trusted rewrite failed');
assert(currentDraft === 'rewritten exact' && insertTextCalls === 1, 'trusted rewrite did not use Input.insertText exactly once');
assert(mousePresses === 0 && mouseReleases === 0, 'rewrite accidentally actuated mouse input');

let response = await dispatch({ type: 'A2_OPERATOR_ACTION', platform: 'CHATGPT', action: 'SCROLL', delta_y: 300 }, options);
assert(response?.ok === false && response.error === 'operator_sender_not_trusted', 'untrusted page ran operator action');

response = await dispatch({ type: 'A2_OPERATOR_ACTION', platform: 'CHATGPT', action: 'SCROLL', delta_y: 700 }, sidePanel);
assert(response?.ok === true && response.result.action === 'SCROLL', 'scroll action failed');
assert(response.result.before_scroll_y === 100 && response.result.after_scroll_y === 800, 'scroll readback mismatch');

generating = true;
response = await dispatch({ type: 'A2_OPERATOR_ACTION', platform: 'CHATGPT', action: 'STOP_GENERATION' }, sidePanel);
assert(response?.ok === true && response.result.clicked_stop === true, 'stop action failed');
assert(response.result.generating_before === true && response.result.generating_after === false, 'stop generation verification failed');

// Node-bound click succeeds even if unrelated pixels changed, provided the exact
// backend DOM node under the point is still the same node from the perception frame.
const pressesBeforeClick = mousePresses;
screenshotBytes = Buffer.from('unrelated-animation-changed-frame');
response = await dispatch({ type: 'A2_OPERATOR_ACTION', platform: 'CHATGPT', action: 'CLICK_POINT', frame_token: frameToken, x: 120, y: 140 }, sidePanel);
assert(response?.ok === true && response.result.action === 'CLICK_POINT', 'node-bound point click failed');
assert(response.result.verification === 'BACKEND_NODE_BINDING_MATCHED_BEFORE_ACTUATION', 'point click did not use backend-node freshness');
assert(response.result.freshness.backend_node_id === 42, 'wrong backend node was bound');
assert(mousePresses === pressesBeforeClick + 1, 'point click did not actuate exactly one press');

// Replacement/overlay node at the same coordinate blocks before mousePressed.
const pressesBeforeReplacement = mousePresses;
backendNodeId = 99;
response = await dispatch({ type: 'A2_OPERATOR_ACTION', platform: 'CHATGPT', action: 'CLICK_POINT', frame_token: frameToken, x: 120, y: 140 }, sidePanel);
assert(response?.ok === false && String(response.error).includes('target_node_changed_recapture_required'), 'replacement node was accepted');
assert(mousePresses === pressesBeforeReplacement, 'replacement node actuated input');
backendNodeId = 42;

// A point that had no reliable DOMSnapshot record keeps the strict legacy
// screenshot fence instead of silently weakening freshness.
screenshotBytes = Buffer.from('stable-frame');
perceptionCache.get('CHATGPT').hashes.screenshot_sha256 = sha256(screenshotBytes);
response = await dispatch({ type: 'A2_OPERATOR_ACTION', platform: 'CHATGPT', action: 'CLICK_POINT', frame_token: frameToken, x: 400, y: 400 }, sidePanel);
assert(response?.ok === true && response.result.verification === 'FRAME_SHA256_MATCHED_BEFORE_ACTUATION', 'screenshot fallback did not verify');
const pressesBeforeStaleFallback = mousePresses;
screenshotBytes = Buffer.from('changed-fallback-frame');
response = await dispatch({ type: 'A2_OPERATOR_ACTION', platform: 'CHATGPT', action: 'CLICK_POINT', frame_token: frameToken, x: 400, y: 400 }, sidePanel);
assert(response?.ok === false && String(response.error).includes('frame_stale_recapture_required'), 'stale fallback frame was accepted');
assert(mousePresses === pressesBeforeStaleFallback, 'stale fallback frame actuated input');
screenshotBytes = Buffer.from('stable-frame');

for (const mode of ['external', 'download', 'file']) {
  hitMode = mode;
  const before = mousePresses;
  response = await dispatch({ type: 'A2_OPERATOR_ACTION', platform: 'CHATGPT', action: 'CLICK_POINT', frame_token: frameToken, x: 120, y: 140 }, sidePanel);
  assert(response?.ok === false, `${mode} hit unexpectedly succeeded`);
  assert(mousePresses === before, `${mode} safety fence actuated mouse input`);
}
hitMode = 'safe';

const beforeDouble = mousePresses;
response = await dispatch({ type: 'A2_OPERATOR_ACTION', platform: 'CHATGPT', action: 'DOUBLE_CLICK_POINT', frame_token: frameToken, x: 120, y: 140 }, sidePanel);
assert(response?.ok === true && mousePresses === beforeDouble + 2, 'double click did not use two press sequences');

tabs.push({ id: 3, url: 'https://chatgpt.com/c/mock' });
const pressesBeforeDuplicate = mousePresses;
response = await dispatch({ type: 'A2_OPERATOR_ACTION', platform: 'CHATGPT', action: 'STOP_GENERATION' }, sidePanel);
assert(response?.ok === false && String(response.error).includes('operator_action_duplicate_target_tabs'), 'duplicate target failed open');
assert(mousePresses === pressesBeforeDuplicate, 'duplicate target actuated input');
tabs.pop();

response = await dispatch({ type: 'A2_OPERATOR_ACTION', platform: 'CHATGPT', action: 'EXECUTE_JS', code: 'alert(1)' }, sidePanel);
assert(response?.ok === false && response.error === 'operator_action_invalid', 'arbitrary remote executable action was accepted');

console.log('A2 v0.6 Operator Actions Lab: PASS', JSON.stringify({
  draft: currentDraft,
  insert_text_calls: insertTextCalls,
  mouse_presses: mousePresses,
  mouse_releases: mouseReleases,
  scroll_y: scrollY,
  backend_node_binding: true,
  screenshot_fallback: true
}));
