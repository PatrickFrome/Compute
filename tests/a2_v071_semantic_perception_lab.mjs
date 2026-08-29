import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

function assert(condition, message) { if (!condition) throw new Error(message); }
const stage = path.resolve(process.env.A2_EXTENSION_STAGE || 'dist/a2-browser-operator-r4/stage-a');
const compilerSource = fs.readFileSync(path.join(stage, 'semantic-perception-compiler.js'), 'utf8');
const adapterSource = fs.readFileSync(path.resolve('coordination/chat-control-plane/extension/operator-semantic-perception.js'), 'utf8');
const listeners = [];
const sessionStore = new Map();
let brokerRuns = 0;
let badEpoch = false;
const cdpMethods = [];

const target = {
  target_id: 'gpt_worker_2', platform: 'CHATGPT', role: 'RESEARCHER',
  conversation_url: 'https://chatgpt.com/c/worker-2', conversation_epoch: 4, status: 'ACTIVE'
};
const tab = { id: 22, url: target.conversation_url };
const binding = { target_id: target.target_id, tab_id: 22, conversation_epoch: 4, url: target.conversation_url };

const strings = ['HTML','TEXTAREA','BUTTON','','id','msg','data-testid','composer','aria-label','Send message'];
const domSnapshot = {
  strings,
  documents: [{
    nodes: {
      nodeName: [0,1,2], nodeValue: [3,3,3], backendNodeId: [1,2,3], parentIndex: [-1,0,0],
      attributes: [[], [4,5,6,7], [8,9]]
    },
    layout: { nodeIndex: [0,1,2], bounds: [[0,0,1000,800],[20,700,700,60],[750,700,120,60]] }
  }]
};
const axTree = { nodes: [
  { nodeId: 'ax-root', backendDOMNodeId: 1, ignored: false, role: { value: 'RootWebArea' }, name: { value: 'Chat worker' }, properties: [] },
  { nodeId: 'ax-text', backendDOMNodeId: 2, ignored: false, role: { value: 'textbox' }, name: { value: 'Message' }, properties: [{ name: 'focusable', value: { value: true } }] },
  { nodeId: 'ax-button', backendDOMNodeId: 3, ignored: false, role: { value: 'button' }, name: { value: 'Send message' }, properties: [{ name: 'focusable', value: { value: true } }] }
] };

async function sessionSend(method) {
  cdpMethods.push(method);
  if (method === 'Page.enable' || method === 'Accessibility.enable' || method === 'Accessibility.disable') return {};
  if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main-frame', loaderId: 'loader-77', url: target.conversation_url } } };
  if (method === 'Accessibility.getFullAXTree') return axTree;
  if (method === 'DOMSnapshot.captureSnapshot') return domSnapshot;
  if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 1280, clientHeight: 800, pageX: 0, pageY: 0, scale: 1 } };
  throw new Error(`unexpected_semantic_cdp:${method}`);
}

const chrome = {
  runtime: {
    id: 'extid',
    getURL: (p = '') => `chrome-extension://extid/${p}`,
    onMessage: { addListener(fn) { listeners.push(fn); } }
  },
  storage: {
    session: {
      async set(values) { for (const [k,v] of Object.entries(values || {})) sessionStore.set(k, structuredClone(v)); }
    }
  }
};
const cryptoCompat = { subtle: webcrypto.subtle, randomUUID: () => '00000000-0000-4000-8000-000000000071' };
const context = vm.createContext({ chrome, globalThis: null, console, URL, Date, TextEncoder, Uint8Array, Map, Set, Promise, structuredClone, BigInt, crypto: cryptoCompat });
context.globalThis = context;
context.A2_TARGET_REGISTRY = {
  async resolveLiveTab(selector) {
    assert(selector === 'gpt_worker_2' || selector === 'CHATGPT', 'unexpected target selector');
    return { target: structuredClone(target), tab: structuredClone(tab), binding: { ...binding, conversation_epoch: badEpoch ? 3 : 4 } };
  },
  async getBinding() { return structuredClone(binding); }
};
context.A2_DEBUGGER_RUN = async (tabId, owner, operation) => {
  brokerRuns += 1;
  assert(tabId === 22, 'semantic broker used wrong tab');
  assert(owner === 'semantic-perception:gpt_worker_2', 'semantic broker owner not target-scoped');
  return operation({ tabId, owner, send: sessionSend });
};

vm.runInContext(compilerSource, context, { filename: 'semantic-perception-compiler.js' });
vm.runInContext(adapterSource, context, { filename: 'operator-semantic-perception.js' });
assert(context.A2_SEMANTIC_PERCEPTION?.schema === 'metaengine.a2-browser-operator.semantic-compiler.v1', 'generated compiler global missing');
assert(typeof context.A2_OPERATOR_SEMANTIC_CAPTURE === 'function', 'semantic capture global missing');

const semantic = await context.A2_OPERATOR_SEMANTIC_CAPTURE('gpt_worker_2', { max_nodes: 30, task_text: 'message send' });
assert(semantic.schema === 'metaengine.a2-browser-operator.semantic-frame.v1', 'semantic schema mismatch');
assert(semantic.target_id === 'gpt_worker_2' && semantic.context_id === 'extension_default', 'semantic logical identity mismatch');
assert(semantic.target?.conversation_epoch === 4, 'conversation epoch missing');
assert(semantic.document_epoch === 'main-frame:loader-77', 'loader document epoch mismatch');
assert(semantic.tainted_page_data === true && semantic.authority_effect === false, 'semantic taint/authority contract failed');
assert(semantic.adapter?.surface === 'A2_CHROME_EXTENSION' && semantic.adapter.page_script_evaluation === false, 'semantic extension adapter boundary failed');
assert(semantic.nodes.some((node) => node.role === 'textbox') && semantic.nodes.some((node) => node.role === 'button'), 'semantic actionable nodes missing');
assert(!cdpMethods.includes('Runtime.evaluate') && !cdpMethods.includes('Runtime.enable'), 'semantic path used page Runtime');
assert(brokerRuns === 1, 'semantic path did not use exactly one debugger broker lease');
const meta = sessionStore.get('a2SemanticPerceptionMeta:gpt_worker_2');
assert(meta?.target_id === 'gpt_worker_2' && meta?.page_script_evaluation === false, 'semantic metadata missing');
assert(!JSON.stringify(Object.fromEntries(sessionStore)).includes('Send message'), 'page text persisted in semantic metadata');
assert(!JSON.stringify(Object.fromEntries(sessionStore)).includes('backend_dom_node_id'), 'physical semantic binding persisted in session metadata');

badEpoch = true;
const brokerBeforeStale = brokerRuns;
let staleRejected = false;
try { await context.A2_OPERATOR_SEMANTIC_CAPTURE('gpt_worker_2'); }
catch (error) { staleRejected = String(error?.message || error) === 'semantic_target_epoch_binding_mismatch'; }
assert(staleRejected, 'stale target epoch was not rejected');
assert(brokerRuns === brokerBeforeStale, 'stale target epoch reached debugger broker');
badEpoch = false;

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
const optionsPage = { id: 'extid', url: 'chrome-extension://extid/options.html' };
let response = await dispatch({ type: 'A2_OPERATOR_SEMANTIC_CAPTURE', target_id: 'gpt_worker_2' }, optionsPage);
assert(response?.ok === false && response.error === 'semantic_operator_sender_not_trusted', 'untrusted extension page accessed semantic capture');
response = await dispatch({ type: 'A2_OPERATOR_SEMANTIC_PREVIEW', target_id: 'gpt_worker_2' }, sidePanel);
assert(response?.ok === true && response.semantic.target_id === 'gpt_worker_2', 'trusted semantic cached preview failed');

console.log('A2 v0.7.1 Semantic Perception Lab: PASS', JSON.stringify({
  target_id: semantic.target_id,
  document_epoch: semantic.document_epoch,
  nodes: semantic.nodes.length,
  broker_runs: brokerRuns,
  cdp_methods: [...new Set(cdpMethods)].sort(),
  compiler_source_sha256: context.A2_SEMANTIC_PERCEPTION.source_sha256
}));
