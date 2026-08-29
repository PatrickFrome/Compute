import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(path.resolve('coordination/chat-control-plane/extension/operator-typed-click-outcome.js'), 'utf8');
const listeners = [];
const calls = [];
let debuggerRuns = 0;
let liveMode = 'normal';
let pressMode = 'ok';
let releaseMode = 'ok';
let operatorDisabled = false;
let semanticEnabled = true;

const capturedAt = new Date().toISOString();
const perceptionCache = new Map([['CHATGPT', {
  platform: 'CHATGPT',
  tab_id: 1,
  captured_at: capturedAt,
  url: 'https://chatgpt.com/c/mock',
  accessibility: [
    { ignored: false, role: 'button', name: 'Run', backend_dom_node_id: 101 },
    { ignored: false, role: 'button', name: 'Danger Link', backend_dom_node_id: 404 },
  ],
}]]);

function liveNodes(role, name) {
  if (role !== 'button') return [];
  if (name === 'Run') {
    const row = { role: { value: 'button' }, name: { value: 'Run' }, backendDOMNodeId: liveMode === 'replaced' ? 999 : 101 };
    return liveMode === 'ambiguous' ? [row, { ...row, backendDOMNodeId: 102 }] : [row];
  }
  if (name === 'Danger Link') return [{ role: { value: 'button' }, name: { value: 'Danger Link' }, backendDOMNodeId: 404 }];
  return [];
}

function describedNode(id) {
  if (id === 404) return { nodeName: 'A', attributes: ['href', 'https://example.com/'] };
  return { nodeName: 'BUTTON', attributes: [] };
}

const session = {
  async send(method, params = {}) {
    calls.push([method, structuredClone(params)]);
    if (method === 'DOM.enable' || method === 'DOM.disable' || method === 'Accessibility.enable' || method === 'Accessibility.disable') return {};
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'Accessibility.queryAXTree') return { nodes: liveNodes(String(params.role), String(params.accessibleName)) };
    if (method === 'DOM.describeNode') return { node: describedNode(Number(params.backendNodeId)) };
    if (method === 'DOM.scrollIntoViewIfNeeded') return {};
    if (method === 'DOM.getBoxModel') return { model: { border: [10, 10, 30, 10, 30, 30, 10, 30] } };
    if (method === 'DOM.getNodeForLocation') return { backendNodeId: liveMode === 'hit-changed' ? 777 : 101 };
    if (method === 'Input.dispatchMouseEvent') {
      if (params.type === 'mousePressed' && pressMode === 'reject') throw new Error('transport_press_lost');
      if (params.type === 'mouseReleased' && releaseMode === 'reject') throw new Error('transport_release_lost');
      return {};
    }
    throw new Error(`unexpected_cdp:${method}`);
  },
};

function storage(values) {
  return {
    async get(keys) {
      const out = {};
      for (const key of keys || []) if (Object.prototype.hasOwnProperty.call(values, key)) out[key] = values[key];
      return out;
    },
  };
}

const chrome = {
  runtime: {
    id: 'extid',
    getURL: (value = '') => `chrome-extension://extid/${value}`,
    onMessage: { addListener(fn) { listeners.push(fn); } },
  },
  storage: { local: storage({ chatgptUrl: 'https://chatgpt.com/c/mock', zaiUrl: '' }) },
  tabs: { async query() { return [{ id: 1, url: 'https://chatgpt.com/c/mock' }]; } },
};

const context = vm.createContext({
  chrome,
  globalThis: null,
  console,
  URL,
  Date,
  Map,
  Set,
  Promise,
  structuredClone,
  A2_OPERATOR_PERCEPTION_CACHE: perceptionCache,
  A2_COMPAT_GET(name, fallback) {
    if (name === 'kill_switches.operator_actions_disabled') return operatorDisabled;
    if (name === 'features.semantic_actions_enabled') return semanticEnabled;
    return fallback;
  },
  A2_DEBUGGER_RUN: async (_tabId, _owner, operation) => {
    debuggerRuns += 1;
    return operation(session);
  },
});
context.globalThis = context;
vm.runInContext(source, context, { filename: 'operator-typed-click-outcome.js' });
const run = context.A2_OPERATOR_TYPED_CLICK_V1;
assert.equal(typeof run, 'function');

function request(overrides = {}) {
  return {
    action_id: 'act-001',
    platform: 'CHATGPT',
    perception_captured_at: capturedAt,
    role: 'button',
    accessible_name: 'Run',
    ...overrides,
  };
}
function reset() {
  calls.length = 0;
  debuggerRuns = 0;
  liveMode = 'normal';
  pressMode = 'ok';
  releaseMode = 'ok';
  operatorDisabled = false;
  semanticEnabled = true;
}
function dispatches() { return calls.filter(([method]) => method === 'Input.dispatchMouseEvent'); }
function assertPrivate(result) {
  const text = JSON.stringify(result);
  for (const forbidden of ['backendNodeId', 'backend_node_id', 'tab_id', 'sessionId', 'processId']) assert.ok(!text.includes(forbidden), `response leaked ${forbidden}`);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.authority_effect, false);
  assert.equal(result.actuation_eligible, false);
}

// Success requires exactly press + release and is COMMITTED.
reset();
let result = await run(request());
assert.equal(result.outcome, 'COMMITTED');
assert.equal(result.physical_dispatch_started, true);
assert.equal(dispatches().length, 2);
assert.deepEqual(dispatches().map(([, p]) => p.type), ['mousePressed', 'mouseReleased']);
assertPrivate(result);

// Press transport rejection is already ambiguous: exactly one attempt, never cleanup/retry.
reset();
pressMode = 'reject';
result = await run(request({ action_id: 'act-press' }));
assert.equal(result.outcome, 'AMBIGUOUS');
assert.equal(result.physical_dispatch_started, true);
assert.equal(dispatches().length, 1);
assert.equal(dispatches()[0][1].type, 'mousePressed');
assertPrivate(result);

// Release rejection is ambiguous: exactly two attempts and no third cleanup release.
reset();
releaseMode = 'reject';
result = await run(request({ action_id: 'act-release' }));
assert.equal(result.outcome, 'AMBIGUOUS');
assert.equal(dispatches().length, 2);
assert.deepEqual(dispatches().map(([, p]) => p.type), ['mousePressed', 'mouseReleased']);
assertPrivate(result);

// Hit-target drift is NO_EFFECT before physical dispatch.
reset();
liveMode = 'hit-changed';
result = await run(request({ action_id: 'act-hit' }));
assert.equal(result.outcome, 'NO_EFFECT');
assert.equal(result.physical_dispatch_started, false);
assert.equal(dispatches().length, 0);
assertPrivate(result);

// Ambiguous/replaced/live-unsafe targets remain fail closed before actuation.
for (const mode of ['ambiguous', 'replaced']) {
  reset();
  liveMode = mode;
  result = await run(request({ action_id: `act-${mode}` }));
  assert.equal(result.outcome, 'NO_EFFECT');
  assert.equal(dispatches().length, 0);
}
reset();
result = await run(request({ action_id: 'act-danger', accessible_name: 'Danger Link' }));
assert.equal(result.outcome, 'NO_EFFECT');
assert.equal(dispatches().length, 0);

// Invalid action id is rejected before debugger acquisition.
reset();
result = await run(request({ action_id: '../bad id' }));
assert.equal(result.outcome, 'NO_EFFECT');
assert.equal(result.reason_code, 'typed_click_action_id_invalid');
assert.equal(debuggerRuns, 0);
assert.equal(dispatches().length, 0);

// Kill switch remains authoritative and pre-dispatch.
reset();
operatorDisabled = true;
result = await run(request({ action_id: 'act-disabled' }));
assert.equal(result.outcome, 'NO_EFFECT');
assert.equal(debuggerRuns, 0);
assert.equal(dispatches().length, 0);
operatorDisabled = false;
semanticEnabled = false;
result = await run(request({ action_id: 'act-feature-off' }));
assert.equal(result.outcome, 'NO_EFFECT');
assert.equal(dispatches().length, 0);

// External request fields are read once; stateful getters cannot rotate the causal selection mid-run.
reset();
const reads = new Map();
const once = (name, value, alternate) => ({
  enumerable: true,
  get() {
    reads.set(name, (reads.get(name) || 0) + 1);
    return reads.get(name) === 1 ? value : alternate;
  },
});
const getterRequest = {};
Object.defineProperties(getterRequest, {
  action_id: once('action_id', 'act-getter', '../changed'),
  platform: once('platform', 'CHATGPT', 'GLM_ZAI'),
  perception_captured_at: once('perception_captured_at', capturedAt, 'changed'),
  role: once('role', 'button', 'textbox'),
  accessible_name: once('accessible_name', 'Run', 'Danger Link'),
});
result = await run(getterRequest);
assert.equal(result.outcome, 'COMMITTED');
assert.equal(dispatches().length, 2);
for (const [name, count] of reads) assert.equal(count, 1, `${name} getter read ${count} times`);

// Message surface is sidepanel-only.
const listener = listeners.find((fn) => typeof fn === 'function');
assert.ok(listener);
let response;
listener({ type: 'A2_OPERATOR_TYPED_CLICK_V1', ...request() }, { id: 'extid', url: 'chrome-extension://extid/options.html' }, (value) => { response = value; });
assert.deepEqual(response, { ok: false, error: 'operator_sender_not_trusted' });

console.log('A2 R8C Typed Click Outcome Lab: PASS', JSON.stringify({
  committed_dispatches: 2,
  press_ambiguous_dispatches: 1,
  release_ambiguous_dispatches: 2,
  preflight_dispatches: 0,
  automatic_retry_allowed: false,
  request_snapshot_once: true,
}));
