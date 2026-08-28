import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const compilerSource = fs.readFileSync(path.resolve('coordination/chat-control-plane/extension/semantic-perception-compiler.js'), 'utf8');
const adapterSource = fs.readFileSync(path.resolve('coordination/chat-control-plane/extension/semantic-perception-extension-adapter.js'), 'utf8');

function assert(condition, message) { if (!condition) throw new Error(message); }
const listeners = [];
const session = new Map();
const brokerTabs = [];
const cdpMethods = [];
let axEnable = 0;
let axDisable = 0;

function storage(map) {
  return {
    async get(keys) {
      if (keys == null) return Object.fromEntries([...map.entries()].map(([key, value]) => [key, structuredClone(value)]));
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => map.has(key)).map((key) => [key, structuredClone(map.get(key))]));
    },
    async set(values) { for (const [key, value] of Object.entries(values || {})) map.set(key, structuredClone(value)); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) map.delete(key); }
  };
}

const targets = {
  gpt_research: { target_id: 'gpt_research', platform: 'CHATGPT', conversation_epoch: 7, conversation_url: 'https://chatgpt.com/c/research' },
  gpt_coder: { target_id: 'gpt_coder', platform: 'CHATGPT', conversation_epoch: 3, conversation_url: 'https://chatgpt.com/c/coder' }
};
const tabs = {
  gpt_research: { id: 101, url: targets.gpt_research.conversation_url },
  gpt_coder: { id: 102, url: targets.gpt_coder.conversation_url }
};

function semanticDom(tabId) {
  const label = tabId === 101 ? 'Research Send' : 'Coder Send';
  const strings = ['', 'BUTTON', 'TEXTAREA', label, 'aria-label', 'Message', 'Send'];
  return {
    strings,
    documents: [{
      nodes: {
        nodeName: [2, 1],
        nodeValue: [0, 0],
        attributes: [[4, 5], [4, 6]],
        backendNodeId: [tabId * 10 + 1, tabId * 10 + 2],
        parentIndex: [-1, -1]
      },
      layout: { nodeIndex: [0, 1], bounds: [[10, 100, 500, 80], [540, 100, 80, 40]] }
    }]
  };
}

function semanticAx(tabId) {
  return {
    nodes: [
      { nodeId: `ax-${tabId}-message`, backendDOMNodeId: tabId * 10 + 1, role: { value: 'textbox' }, name: { value: 'Message' }, properties: [{ name: 'focusable', value: { value: true } }] },
      { nodeId: `ax-${tabId}-send`, backendDOMNodeId: tabId * 10 + 2, role: { value: 'button' }, name: { value: 'Send' }, properties: [{ name: 'focusable', value: { value: true } }] }
    ]
  };
}

async function sessionSend(tabId, method) {
  cdpMethods.push(`${tabId}:${method}`);
  if (method === 'Page.enable') return {};
  if (method === 'Accessibility.enable') { axEnable += 1; return {}; }
  if (method === 'Accessibility.disable') { axDisable += 1; return {}; }
  if (method === 'Accessibility.getFullAXTree') return semanticAx(tabId);
  if (method === 'DOMSnapshot.captureSnapshot') return semanticDom(tabId);
  if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 800, clientHeight: 600 }, cssLayoutViewport: { clientWidth: 800, clientHeight: 600 } };
  if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: `frame-${tabId}`, loaderId: `loader-${tabId}` } } };
  throw new Error(`unexpected_cdp_method:${method}`);
}

const chrome = {
  runtime: {
    id: 'extid',
    getURL: (value = '') => `chrome-extension://extid/${value}`,
    onMessage: { addListener(fn) { listeners.push(fn); } }
  },
  storage: { session: storage(session) }
};

const context = vm.createContext({
  chrome, globalThis: null, console, URL, Date, TextEncoder, Map, Set, Promise, structuredClone
});
context.globalThis = context;
context.A2_TARGET_REGISTRY = {
  ready: Promise.resolve(),
  async resolveLiveTab(selector) {
    const raw = String(selector || '');
    const id = raw === 'CHATGPT' ? 'gpt_research' : raw;
    const target = targets[id];
    if (!target) throw new Error('target_not_found');
    return {
      target: structuredClone(target),
      tab: structuredClone(tabs[id]),
      binding: { target_id: id, tab_id: tabs[id].id, browser_session_nonce: 'session-nonce-1' }
    };
  }
};
context.A2_DEBUGGER_RUN = async (tabId, owner, operation) => {
  brokerTabs.push({ tab_id: tabId, owner });
  return operation({ tabId, owner, send: (method, params) => sessionSend(tabId, method, params) });
};
vm.runInContext(compilerSource, context, { filename: 'semantic-perception-compiler.js' });
vm.runInContext(adapterSource, context, { filename: 'semantic-perception-extension-adapter.js' });

async function dispatch(message, sender) {
  for (const listener of listeners) {
    let resolved = false;
    let response;
    let resolveAsync;
    const asyncResponse = new Promise((resolve) => { resolveAsync = resolve; });
    const ret = listener(message, sender, (value) => { resolved = true; response = value; resolveAsync(value); });
    if (resolved) return response;
    if (ret === true) return Promise.race([asyncResponse, new Promise((_, reject) => setTimeout(() => reject(new Error('response_timeout')), 1000))]);
  }
  return null;
}

const sidepanel = { id: 'extid', url: 'chrome-extension://extid/sidepanel.html' };
const optionsPage = { id: 'extid', url: 'chrome-extension://extid/options.html' };

let response = await dispatch({ type: 'A2_OPERATOR_CAPTURE_SEMANTIC_PERCEPTION', target_id: 'gpt_research' }, optionsPage);
assert(response?.ok === false && response.error === 'operator_sender_not_trusted', 'untrusted extension page used semantic perception');

const research1 = await dispatch({ type: 'A2_OPERATOR_CAPTURE_SEMANTIC_PERCEPTION', target_id: 'gpt_research', options: { node_budget: 20, task_terms: ['send'] } }, sidepanel);
const coder = await dispatch({ type: 'A2_OPERATOR_CAPTURE_SEMANTIC_PERCEPTION', target_id: 'gpt_coder', options: { node_budget: 20, task_terms: ['send'] } }, sidepanel);
const research2 = await dispatch({ type: 'A2_OPERATOR_CAPTURE_SEMANTIC_PERCEPTION', target_id: 'gpt_research', options: { node_budget: 20, task_terms: ['send'] } }, sidepanel);

assert(research1?.ok === true && coder?.ok === true && research2?.ok === true, 'semantic captures failed');
assert(research1.semantic_frame.target_id === 'gpt_research' && research1.semantic_frame.tab_id === 101, 'research target binding incorrect');
assert(coder.semantic_frame.target_id === 'gpt_coder' && coder.semantic_frame.tab_id === 102, 'coder target binding incorrect');
assert(research1.semantic_frame.platform === 'CHATGPT' && coder.semantic_frame.platform === 'CHATGPT', 'same-platform multi-target contract broken');
const researchSend = research1.semantic_frame.nodes.find((node) => node.name === 'Send');
const coderSend = coder.semantic_frame.nodes.find((node) => node.name === 'Send');
assert(researchSend && coderSend && researchSend.semantic_id !== coderSend.semantic_id, 'target identity did not scope semantic ids');
assert(research2.semantic_frame.nodes.some((node) => node.continuity === 'EXACT_BINDING'), 'same target did not retain snapshot continuity');
assert(research1.semantic_frame.semantic_authority === false && coder.semantic_frame.authority_effect === false, 'semantic perception acquired authority');
assert(!cdpMethods.some((row) => /Runtime\.evaluate|captureScreenshot/.test(row)), 'semantic adapter used forbidden page-eval/pixel path');
assert(axEnable === 3 && axDisable === 3, 'accessibility domain lifecycle leaked');
assert(brokerTabs.map((row) => row.tab_id).join(',') === '101,102,101', 'semantic adapter ignored target-specific tab binding');

const meta = await dispatch({ type: 'A2_OPERATOR_SEMANTIC_PERCEPTION_META' }, sidepanel);
assert(meta?.ok === true, 'semantic meta lookup failed');
assert(meta.meta['a2OperatorSemanticPerceptionMeta:gpt_research']?.tab_id === 101, 'research metadata missing');
assert(meta.meta['a2OperatorSemanticPerceptionMeta:gpt_coder']?.tab_id === 102, 'coder metadata missing');
const persisted = JSON.stringify(Object.fromEntries(session));
assert(!/cdp_target|backend_dom|ax-[0-9]|<html|body_text/i.test(persisted), 'semantic metadata persisted raw browser binding/content');

console.log('A2 v0.7.0 semantic perception target parity lab: PASS', JSON.stringify({
  target_ids: [research1.semantic_frame.target_id, coder.semantic_frame.target_id],
  same_platform: true,
  distinct_semantic_ids: true,
  exact_binding_on_repeat: true,
  forbidden_eval_or_screenshot_calls: 0,
  metadata_entries: Object.keys(meta.meta).length
}));
