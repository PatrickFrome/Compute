import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = fs.readFileSync(path.resolve('coordination/chat-control-plane/extension/operator-perception.js'), 'utf8');
const local = new Map([
  ['chatgptUrl', 'https://chatgpt.com/c/mock'],
  ['zaiUrl', 'https://chat.z.ai/c/mock']
]);
const session = new Map();
const listeners = [];
const tabs = [
  { id: 1, url: 'https://chatgpt.com/c/mock' },
  { id: 2, url: 'https://chat.z.ai/c/mock' }
];
let screenshotEnabled = true;
let brokerRuns = 0;
let axEnableCalls = 0;
let axDisableCalls = 0;

function assert(condition, message) { if (!condition) throw new Error(message); }
function storage(map) {
  return {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => map.has(k)).map((k) => [k, map.get(k)]));
    },
    async set(values) { for (const [k, v] of Object.entries(values || {})) map.set(k, structuredClone(v)); },
    async remove(keys) { for (const k of (Array.isArray(keys) ? keys : [keys])) map.delete(k); }
  };
}

const strings = ['', 'DIV', 'BUTTON', 'hello visible', 'id', 'send', 'data-testid', 'send-button'];
const domSnapshot = {
  strings,
  documents: [{
    nodes: {
      nodeName: [1, 2],
      nodeValue: [3, 0],
      attributes: [[4, 5], [6, 7]],
      backendNodeId: [10, 11],
      parentIndex: [-1, 0]
    },
    layout: { nodeIndex: [0, 1], bounds: [[0, 0, 800, 600], [700, 540, 80, 40]] }
  }]
};
const axTree = {
  nodes: [
    { nodeId: '1', backendDOMNodeId: 10, role: { value: 'document' }, name: { value: 'Mock' }, childIds: ['2'] },
    { nodeId: '2', backendDOMNodeId: 11, role: { value: 'button' }, name: { value: 'Send' }, properties: [{ name: 'focusable', value: { value: true } }] }
  ]
};
const pageReadback = {
  url: 'https://chatgpt.com/c/mock', title: 'Mock Chat', visibility_state: 'visible', has_focus: true,
  body_text: 'hello visible\nSend', body_text_length: 18, body_text_truncated: false,
  selection_text: '', scroll: { x: 0, y: 0 }, viewport: { width: 800, height: 600, device_pixel_ratio: 1 },
  active_element: { tag: 'DIV', id: 'prompt-textarea', role: 'textbox', bounds: [0, 500, 650, 100] }
};
const tinyJpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');

async function sessionSend(method) {
  if (method === 'Runtime.enable' || method === 'Page.enable') return {};
  if (method === 'Accessibility.enable') { axEnableCalls += 1; return {}; }
  if (method === 'Accessibility.disable') { axDisableCalls += 1; return {}; }
  if (method === 'Runtime.evaluate') return { result: { value: { ...pageReadback } } };
  if (method === 'Accessibility.getFullAXTree') return axTree;
  if (method === 'DOMSnapshot.captureSnapshot') return domSnapshot;
  if (method === 'Page.getLayoutMetrics') return { cssLayoutViewport: { clientWidth: 800, clientHeight: 600 }, cssVisualViewport: { clientWidth: 800, clientHeight: 600 }, contentSize: { width: 800, height: 1200 } };
  if (method === 'Page.captureScreenshot') return { data: tinyJpegBase64 };
  throw new Error(`unexpected CDP method ${method}`);
}

const chrome = {
  runtime: {
    id: 'extid',
    getURL: (p = '') => `chrome-extension://extid/${p}`,
    onMessage: { addListener(fn) { listeners.push(fn); } }
  },
  storage: { local: storage(local), session: storage(session) },
  tabs: { async query() { return tabs.map((t) => ({ ...t })); } }
};

const context = vm.createContext({
  chrome, globalThis: null, console, URL, Date, TextEncoder, Uint8Array, Map, Set, Promise,
  structuredClone, atob, crypto: webcrypto
});
context.globalThis = context;
context.A2_DEBUGGER_RUN = async (tabId, owner, operation) => {
  brokerRuns += 1;
  return operation({ tabId, owner, send: sessionSend });
};
context.A2_COMPAT_GET = (key, fallback) => {
  if (key === 'features.screenshot_sensor_enabled') return screenshotEnabled;
  if (key === 'timeouts.frame_max_age_ms') return 45000;
  return fallback;
};
vm.runInContext(source, context, { filename: 'operator-perception.js' });

async function dispatch(message, sender) {
  for (const listener of listeners) {
    let resolveResponse;
    const responsePromise = new Promise((resolve) => { resolveResponse = resolve; });
    let immediate = false, immediateValue;
    const ret = listener(message, sender, (value) => { immediate = true; immediateValue = value; resolveResponse(value); });
    if (immediate) return immediateValue;
    if (ret === true) return await Promise.race([responsePromise, new Promise((_, reject) => setTimeout(() => reject(new Error('response timeout')), 1000))]);
  }
  return null;
}

const sidePanel = { id: 'extid', url: 'chrome-extension://extid/sidepanel.html' };
const options = { id: 'extid', url: 'chrome-extension://extid/options.html' };

let response = await dispatch({ type: 'A2_OPERATOR_CAPTURE_PERCEPTION', platform: 'CHATGPT', options: { body_limit: 5, ax_limit: 1, dom_limit: 1, include_screenshot: true } }, options);
assert(response?.ok === false && response.error === 'operator_sender_not_trusted', 'untrusted extension page captured screen');

response = await dispatch({ type: 'A2_OPERATOR_CAPTURE_PERCEPTION', platform: 'CHATGPT', options: { body_limit: 5, ax_limit: 1, dom_limit: 1, include_screenshot: true } }, sidePanel);
assert(response?.ok === true, 'trusted capture failed');
assert(response.perception.schema.endsWith('perception-preview.v2'), 'capture did not return v2 bounded preview');
assert(response.perception.frame_token?.length === 64, 'pixel frame token missing');
assert(response.perception.frame_max_age_ms === 45000, 'signed frame timeout not reflected');
assert(response.perception.page.body_text_excerpt.length <= 5, 'body preview exceeded requested budget');
assert(response.perception.accessibility.length === 1 && response.perception.accessibility_total === 2, 'AX preview limit failed');
assert(response.perception.dom_snapshot.records.length === 1 && response.perception.dom_snapshot.visible_record_count === 2, 'DOM preview limit failed');
assert(response.perception.screenshot.base64 === tinyJpegBase64, 'screenshot preview missing');
assert(brokerRuns === 1, 'perception did not use debugger broker exactly once');
assert(axEnableCalls === 1 && axDisableCalls === 1, 'Accessibility domain was not disabled after capture');

const meta = session.get('a2OperatorPerceptionMeta:CHATGPT');
assert(meta?.body_text_sha256?.length === 64 && meta?.screenshot_sha256?.length === 64, 'perception hashes not persisted');
assert(meta?.frame_token?.length === 64, 'frame token metadata missing');
assert(!JSON.stringify(Object.fromEntries(session)).includes(tinyJpegBase64), 'screenshot persisted in session storage');
assert(!JSON.stringify(Object.fromEntries(session)).includes('hello visible\nSend'), 'full visible body text persisted in session storage');

response = await dispatch({ type: 'A2_OPERATOR_PERCEPTION_PREVIEW', platform: 'CHATGPT', options: { include_screenshot: false, body_limit: 8, ax_limit: 2, dom_limit: 2 } }, sidePanel);
assert(response?.ok === true && response.perception.screenshot.omitted === true && !response.perception.screenshot.base64, 'cached screenshot omission failed');
assert(response.perception.page.body_text_excerpt.length <= 8, 'cached body preview exceeded requested budget');

// Signed pixel kill-switch must preserve structural perception while removing frame actuation proof.
screenshotEnabled = false;
response = await dispatch({ type: 'A2_OPERATOR_CAPTURE_PERCEPTION', platform: 'CHATGPT', options: { include_screenshot: true } }, sidePanel);
assert(response?.ok === true, 'structural perception failed when screenshots disabled');
assert(response.perception.screenshot.available === false && !response.perception.screenshot.base64, 'pixel kill-switch leaked screenshot');
assert(response.perception.frame_token === null && response.perception.hashes.screenshot_sha256 === null, 'pixel-disabled capture still created actionable frame');
assert(response.perception.accessibility_total === 2 && response.perception.dom_snapshot.visible_record_count === 2, 'structural sensors were disabled with pixels');
assert(axEnableCalls === 2 && axDisableCalls === 2, 'Accessibility lifecycle leaked after pixel-disabled capture');
screenshotEnabled = true;

// Duplicate exact target must fail closed before broker execution.
tabs.push({ id: 3, url: 'https://chatgpt.com/c/mock' });
const brokerBeforeDuplicate = brokerRuns;
response = await dispatch({ type: 'A2_OPERATOR_CAPTURE_PERCEPTION', platform: 'CHATGPT' }, sidePanel);
assert(response?.ok === false && String(response.error).includes('perception_duplicate_target_tabs'), 'duplicate target did not fail closed');
assert(brokerRuns === brokerBeforeDuplicate, 'duplicate target reached debugger broker');
tabs.pop();

console.log('A2 v0.6 Perception Lab: PASS', JSON.stringify({
  body_hash: meta.body_text_sha256,
  screenshot_hash: meta.screenshot_sha256,
  ax_nodes: meta.ax_node_count,
  dom_records: meta.dom_visible_record_count,
  broker_runs: brokerRuns,
  ax_enable_calls: axEnableCalls,
  ax_disable_calls: axDisableCalls,
  session_keys: [...session.keys()].sort()
}));
