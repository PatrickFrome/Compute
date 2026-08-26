import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = fs.readFileSync('coordination/chat-control-plane/extension/operator-oopif-perception.js', 'utf8');
const listeners = [];
const sessionWrites = [];
const childCommands = [];
let childTargetsDisabled = false;

const childSession = {
  session_id: 'child-1',
  target_id: 'target-1',
  type: 'iframe',
  url: 'https://frame.example/app'
};

const brokerSession = {
  async enableChildTargets() {},
  async disableChildTargets() { childTargetsDisabled = true; },
  childSessions() { return [childSession]; },
  async sendChild(sessionId, method, params = {}) {
    childCommands.push([sessionId, method, params]);
    if (method === 'Runtime.enable' || method === 'Accessibility.enable' || method === 'Accessibility.disable') return {};
    if (method === 'Runtime.evaluate') {
      return { result: { value: {
        url: 'https://frame.example/app', title: 'Cross origin frame', visibility_state: 'visible',
        body_text: 'frame body text', body_text_length: 15, body_text_truncated: false,
        viewport: { width: 400, height: 300, device_pixel_ratio: 1 }
      } } };
    }
    if (method === 'Accessibility.getFullAXTree') {
      return { nodes: [{ backendDOMNodeId: 11, ignored: false, role: { value: 'button' }, name: { value: 'Continue' }, properties: [] }] };
    }
    if (method === 'DOMSnapshot.captureSnapshot') {
      return {
        strings: ['', 'BUTTON', 'Continue', 'role', 'button'],
        documents: [{
          nodes: { nodeName: [1], nodeValue: [2], attributes: [[3, 4]], backendNodeId: [11] },
          layout: { nodeIndex: [0], bounds: [[10, 20, 80, 30]] }
        }]
      };
    }
    throw new Error(`unexpected child command: ${method}`);
  }
};

const chrome = {
  runtime: {
    id: 'ext-id',
    getURL(path) { return `chrome-extension://ext-id/${path}`; },
    onMessage: { addListener(fn) { listeners.push(fn); } }
  },
  storage: {
    local: { async get() { return { chatgptUrl: 'https://chatgpt.com/c/test', zaiUrl: 'https://chat.z.ai/c/test' }; } },
    session: { async set(value) { sessionWrites.push(value); } }
  },
  tabs: {
    async query() { return [{ id: 7, url: 'https://chatgpt.com/c/test' }]; }
  }
};

const context = vm.createContext({
  chrome,
  console,
  crypto: webcrypto,
  TextEncoder,
  Uint8Array,
  URL,
  setTimeout,
  clearTimeout,
  Promise,
  globalThis: null
});
context.globalThis = context;
context.A2_DEBUGGER_RUN = async (tabId, owner, operation) => {
  assert.equal(tabId, 7);
  assert.match(owner, /oopif-perception/);
  return operation(brokerSession);
};
vm.runInContext(source, context, { filename: 'operator-oopif-perception.js' });

assert.equal(typeof context.A2_OPERATOR_CAPTURE_OOPIF, 'function');
const capture = await context.A2_OPERATOR_CAPTURE_OOPIF('CHATGPT');
assert.equal(capture.child_frame_count, 1);
assert.equal(capture.child_frames[0].title, 'Cross origin frame');
assert.equal(capture.child_frames[0].accessibility[0].role, 'button');
assert.equal(capture.child_frames[0].dom_snapshot.records[0].node_name, 'BUTTON');
assert.equal(childTargetsDisabled, true, 'child auto-attach must be disabled after bounded capture');
assert.ok(childCommands.some((row) => row[1] === 'Accessibility.disable'), 'Accessibility must be disabled after child capture');
assert.ok(sessionWrites.length === 1);
const persistedJson = JSON.stringify(sessionWrites[0]);
assert.ok(!persistedJson.includes('frame body text'), 'persistent/session metadata must not contain full child-frame text');
assert.ok(!persistedJson.includes('Continue'), 'persistent/session metadata must not contain AX page content');

const listener = listeners[0];
const trustedSender = { id: 'ext-id', url: 'chrome-extension://ext-id/sidepanel.html' };
const untrustedSender = { id: 'ext-id', url: 'chrome-extension://ext-id/options.html' };
let untrustedResponse = null;
listener({ type: 'A2_OPERATOR_CAPTURE_OOPIF', platform: 'CHATGPT' }, untrustedSender, (value) => { untrustedResponse = value; });
assert.equal(untrustedResponse?.ok, false);
assert.equal(untrustedResponse?.error, 'operator_sender_not_trusted');

let trustedResponse = null;
const asyncFlag = listener({ type: 'A2_OPERATOR_CAPTURE_OOPIF', platform: 'CHATGPT' }, trustedSender, (value) => { trustedResponse = value; });
assert.equal(asyncFlag, true);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(trustedResponse?.ok, true);
assert.equal(trustedResponse?.perception?.child_frame_count, 1);

console.log('A2 v0.6 OOPIF Perception Lab: PASS', JSON.stringify({
  child_frames: capture.child_frame_count,
  accessibility_disabled: true,
  child_auto_attach_disabled: childTargetsDisabled,
  metadata_only_storage: true
}));
