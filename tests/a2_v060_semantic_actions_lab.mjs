import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = fs.readFileSync(path.resolve('coordination/chat-control-plane/extension/operator-semantic-actions.js'), 'utf8');
const local = new Map([
  ['chatgptUrl', 'https://chatgpt.com/c/mock'],
  ['zaiUrl', 'https://chat.z.ai/c/mock'],
]);
const sessionStorage = new Map();
const runtimeListeners = [];
const calls = [];
let operatorDisabled = false;
let semanticEnabled = true;
let liveMode = 'normal';
let focusedBackendNodeId = null;
let selectedAll = false;
const nodeText = new Map([[202, ''], [303, 'secret']]);

function storage(map) {
  return {
    async get(keys) {
      if (keys == null) return Object.fromEntries(map);
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(names.filter((key) => map.has(key)).map((key) => [key, map.get(key)]));
    },
    async set(values) { for (const [key, value] of Object.entries(values || {})) map.set(key, structuredClone(value)); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) map.delete(key); }
  };
}

const capturedAt = new Date().toISOString();
const perception = {
  platform: 'CHATGPT',
  tab_id: 1,
  captured_at: capturedAt,
  url: 'https://chatgpt.com/c/mock',
  accessibility: [
    { ignored: false, role: 'button', name: 'Run', backend_dom_node_id: 101 },
    { ignored: false, role: 'textbox', name: 'Prompt', backend_dom_node_id: 202 },
    { ignored: false, role: 'textbox', name: 'Password', backend_dom_node_id: 303 },
    { ignored: false, role: 'button', name: 'Danger Link', backend_dom_node_id: 404 },
  ]
};
const perceptionCache = new Map([['CHATGPT', perception]]);

function liveNode(role, name) {
  const rows = {
    'button|Run': { role: { value: 'button' }, name: { value: 'Run' }, backendDOMNodeId: liveMode === 'replaced' ? 999 : 101 },
    'textbox|Prompt': { role: { value: 'textbox' }, name: { value: 'Prompt' }, backendDOMNodeId: 202 },
    'textbox|Password': { role: { value: 'textbox' }, name: { value: 'Password' }, backendDOMNodeId: 303 },
    'button|Danger Link': { role: { value: 'button' }, name: { value: 'Danger Link' }, backendDOMNodeId: 404 },
  };
  const row = rows[`${role}|${name}`];
  if (!row) return [];
  if (liveMode === 'ambiguous' && name === 'Run') return [row, { ...row, backendDOMNodeId: 102 }];
  return [row];
}

function describedNode(id) {
  if (id === 101 || id === 999) return { nodeName: 'BUTTON', attributes: [] };
  if (id === 202) return { nodeName: 'INPUT', attributes: ['type', 'text'] };
  if (id === 303) return { nodeName: 'INPUT', attributes: ['type', 'password'] };
  if (id === 404) return { nodeName: 'A', attributes: ['href', 'https://example.com/'] };
  return { nodeName: 'DIV', attributes: [] };
}

const debuggerSession = {
  async send(method, params = {}) {
    calls.push([method, structuredClone(params)]);
    if (method === 'Runtime.enable' || method === 'DOM.enable' || method === 'Accessibility.enable' || method === 'Accessibility.disable' || method === 'DOM.disable' || method === 'Runtime.releaseObjectGroup') return {};
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'Accessibility.queryAXTree') return { nodes: liveNode(String(params.role), String(params.accessibleName)) };
    if (method === 'DOM.describeNode') return { node: describedNode(Number(params.backendNodeId)) };
    if (method === 'DOM.scrollIntoViewIfNeeded') return {};
    if (method === 'DOM.focus') { focusedBackendNodeId = Number(params.backendNodeId); return {}; }
    if (method === 'DOM.resolveNode') return { object: { objectId: `node-${Number(params.backendNodeId)}` } };
    if (method === 'Runtime.callFunctionOn') {
      const id = Number(String(params.objectId || '').replace('node-', ''));
      return { result: { value: { text: nodeText.get(id) || '', focused: focusedBackendNodeId === id, tag: describedNode(id).nodeName, type: '', contenteditable: false } } };
    }
    if (method === 'DOM.getBoxModel') return { model: { border: [10, 10, 30, 10, 30, 30, 10, 30] } };
    if (method === 'DOM.getNodeForLocation') return { backendNodeId: liveMode === 'hit-changed' ? 777 : 101 };
    if (method === 'Input.dispatchMouseEvent') return {};
    if (method === 'Input.dispatchKeyEvent') {
      if (params.type === 'rawKeyDown' && params.key === 'a' && Number(params.modifiers) === 2) selectedAll = true;
      return {};
    }
    if (method === 'Input.insertText') {
      if (!Number.isInteger(focusedBackendNodeId)) throw new Error('insert_without_focus');
      const old = nodeText.get(focusedBackendNodeId) || '';
      nodeText.set(focusedBackendNodeId, selectedAll ? String(params.text || '') : old + String(params.text || ''));
      selectedAll = false;
      return {};
    }
    throw new Error(`unexpected_cdp_method:${method}`);
  }
};

const chrome = {
  runtime: {
    id: 'extid',
    getURL: (p = '') => `chrome-extension://extid/${p}`,
    onMessage: { addListener(fn) { runtimeListeners.push(fn); } },
  },
  storage: { local: storage(local), session: storage(sessionStorage) },
  tabs: {
    async query() { return [{ id: 1, url: 'https://chatgpt.com/c/mock' }]; }
  }
};

const context = vm.createContext({
  chrome,
  globalThis: null,
  console,
  URL,
  Date,
  TextEncoder,
  Uint8Array,
  Map,
  Set,
  Promise,
  structuredClone,
  crypto: webcrypto,
  A2_OPERATOR_PERCEPTION_CACHE: perceptionCache,
  A2_COMPAT_GET(pathName, fallback) {
    if (pathName === 'kill_switches.operator_actions_disabled') return operatorDisabled;
    if (pathName === 'features.semantic_actions_enabled') return semanticEnabled;
    return fallback;
  },
  A2_DEBUGGER_RUN: async (_tabId, _owner, operation) => operation(debuggerSession),
});
context.globalThis = context;
vm.runInContext(source, context, { filename: 'operator-semantic-actions.js' });

const run = context.A2_OPERATOR_SEMANTIC_ACTION;
assert.equal(typeof run, 'function');

function resetCalls() { calls.length = 0; focusedBackendNodeId = null; selectedAll = false; liveMode = 'normal'; }
function methods() { return calls.map((row) => row[0]); }

// Focus-only must use DOM.focus and never synthesize a mouse click.
resetCalls();
let result = await run({ action: 'FOCUS_SEMANTIC', platform: 'CHATGPT', perception_captured_at: capturedAt, role: 'button', accessible_name: 'Run' });
assert.equal(result.ok, true);
assert.ok(methods().includes('DOM.focus'));
assert.ok(!methods().includes('Input.dispatchMouseEvent'), 'focus-only activated the target with a mouse event');
assert.equal(result.verification, 'LIVE_AX_BACKEND_NODE_DOM_FOCUSED_NO_ACTIVATION');
assert.ok(methods().includes('Accessibility.disable') && methods().includes('DOM.disable'), 'focus cleanup did not close CDP domains');

// Typing must focus without mouse activation and use trusted Input.insertText.
resetCalls();
result = await run({ action: 'TYPE_SEMANTIC', platform: 'CHATGPT', perception_captured_at: capturedAt, role: 'textbox', accessible_name: 'Prompt', text: 'hello', replace_existing: true });
assert.equal(result.ok, true);
assert.equal(result.exact_readback, true);
assert.equal(nodeText.get(202), 'hello');
assert.ok(methods().includes('DOM.focus') && methods().includes('Input.insertText'));
assert.ok(!methods().includes('Input.dispatchMouseEvent'), 'semantic type activated target with mouse');

// Explicit click is the only semantic action allowed to dispatch physical mouse events.
resetCalls();
result = await run({ action: 'CLICK_SEMANTIC', platform: 'CHATGPT', perception_captured_at: capturedAt, role: 'button', accessible_name: 'Run' });
assert.equal(result.ok, true);
assert.equal(methods().filter((m) => m === 'Input.dispatchMouseEvent').length, 2);
assert.ok(methods().indexOf('Accessibility.queryAXTree') < methods().indexOf('Input.dispatchMouseEvent'), 'click happened before live AX revalidation');
assert.ok(methods().indexOf('DOM.getNodeForLocation') < methods().indexOf('Input.dispatchMouseEvent'), 'click happened before backend-node hit test');

// Dangerous and ambiguous targets are fail-closed before actuation.
resetCalls();
await assert.rejects(() => run({ action: 'TYPE_SEMANTIC', platform: 'CHATGPT', perception_captured_at: capturedAt, role: 'textbox', accessible_name: 'Password', text: 'nope' }), /semantic_password_input_blocked/);
assert.ok(!methods().includes('Input.insertText') && !methods().includes('Input.dispatchMouseEvent'));

resetCalls();
await assert.rejects(() => run({ action: 'CLICK_SEMANTIC', platform: 'CHATGPT', perception_captured_at: capturedAt, role: 'button', accessible_name: 'Danger Link' }), /semantic_navigation_or_download_blocked/);
assert.ok(!methods().includes('Input.dispatchMouseEvent'));

resetCalls();
liveMode = 'ambiguous';
await assert.rejects(() => run({ action: 'CLICK_SEMANTIC', platform: 'CHATGPT', perception_captured_at: capturedAt, role: 'button', accessible_name: 'Run' }), /semantic_live_target_ambiguous:2/);
assert.ok(methods().includes('Accessibility.disable') && methods().includes('DOM.disable'), 'ambiguity path leaked enabled CDP domains');
assert.ok(!methods().includes('Input.dispatchMouseEvent'));

resetCalls();
liveMode = 'replaced';
await assert.rejects(() => run({ action: 'FOCUS_SEMANTIC', platform: 'CHATGPT', perception_captured_at: capturedAt, role: 'button', accessible_name: 'Run' }), /semantic_target_replaced_recapture_required/);
assert.ok(!methods().includes('DOM.focus') && !methods().includes('Input.dispatchMouseEvent'));

resetCalls();
liveMode = 'hit-changed';
await assert.rejects(() => run({ action: 'CLICK_SEMANTIC', platform: 'CHATGPT', perception_captured_at: capturedAt, role: 'button', accessible_name: 'Run' }), /semantic_target_hit_changed/);
assert.ok(!methods().includes('Input.dispatchMouseEvent'));

// Signed compatibility controls remain authoritative.
operatorDisabled = true;
await assert.rejects(() => run({ action: 'FOCUS_SEMANTIC', platform: 'CHATGPT', perception_captured_at: capturedAt, role: 'button', accessible_name: 'Run' }), /compat_kill_switch_operator_actions_disabled/);
operatorDisabled = false;
semanticEnabled = false;
await assert.rejects(() => run({ action: 'FOCUS_SEMANTIC', platform: 'CHATGPT', perception_captured_at: capturedAt, role: 'button', accessible_name: 'Run' }), /compat_feature_semantic_actions_disabled/);
semanticEnabled = true;

// Runtime action surface is trusted-sidepanel-only.
const listener = runtimeListeners.find((fn) => typeof fn === 'function');
assert.ok(listener, 'semantic runtime listener missing');
let response;
listener({ type: 'A2_OPERATOR_SEMANTIC_ACTION', action: 'FOCUS_SEMANTIC' }, { id: 'extid', url: 'chrome-extension://extid/options.html' }, (value) => { response = value; });
assert.equal(response?.ok, false);
assert.equal(response?.error, 'operator_sender_not_trusted');

// Receipt is session-only and stores hashes rather than raw semantic name/text.
const receipt = sessionStorage.get('a2OperatorLastSemanticActionV060');
assert.ok(receipt?.accessible_name_sha256 && /^[0-9a-f]{64}$/.test(receipt.accessible_name_sha256));
assert.ok(!JSON.stringify(receipt).includes('Danger Link'));
assert.ok(!local.has('a2OperatorLastSemanticActionV060'));

console.log('A2 v0.6 Semantic AX Actions Lab: PASS', JSON.stringify({
  focus_no_activation: true,
  type_no_activation: true,
  click_live_revalidated: true,
  dangerous_targets_fail_closed: true,
  receipt_session_only: true,
}));
