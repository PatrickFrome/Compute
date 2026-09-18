import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { captureSemanticFrame, executeSemanticCommand } from '../src/native-browser-control.mjs';

function ax(role, name, id, value = null) {
  const node = {
    nodeId: `ax-${id}`,
    ignored: false,
    role: { value: role },
    backendDOMNodeId: id,
    frameId: 'frame-root',
  };
  if (name != null) node.name = { value: name };
  if (value != null) node.value = { value };
  return node;
}

let nextWebContentsId = 7100;
function fakeZai({ submitWorks = true, navigateOnSubmit = false } = {}) {
  let attached = false;
  let url = 'https://chat.z.ai/';
  let composerValue = '';
  let axReads = 0;
  const calls = [];
  const listeners = new Map();
  const webContentsId = nextWebContentsId++;
  const debuggerApi = {
    isAttached: () => attached,
    attach: () => { attached = true; },
    detach: () => { attached = false; },
    on(name, fn) { const rows = listeners.get(name) || new Set(); rows.add(fn); listeners.set(name, rows); },
    off(name, fn) { listeners.get(name)?.delete(fn); },
    emitMessage(method, params = {}) { for (const fn of listeners.get('message') || []) fn({}, method, params, null); },
    async sendCommand(method, params = {}) {
      calls.push([method, structuredClone(params)]);
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-root', url } } };
      if (method === 'Runtime.enable') {
        this.emitMessage('Runtime.executionContextCreated', { context: { id: 1, uniqueId: `context-${webContentsId}`, auxData: { frameId: 'frame-root', isDefault: true } } });
        return {};
      }
      if (['Page.enable','DOM.enable','Accessibility.enable','Page.setLifecycleEventsEnabled','Network.enable','Target.setAutoAttach','DOM.getDocument'].includes(method)) return {};
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 1200, clientHeight: 800 } };
      if (method === 'Accessibility.getFullAXTree') {
        axReads += 1;
        return { nodes: [
          ax('textbox', '', 3, composerValue),
          ax('button', 'Select a model', 5),
        ] };
      }
      if (method === 'DOM.focus' || method === 'Input.insertText') {
        if (method === 'Input.insertText') composerValue = String(params.text || '');
        return {};
      }
      if (method === 'Input.dispatchKeyEvent') {
        if (params.key === 'Enter' && params.type === 'rawKeyDown' && submitWorks) {
          composerValue = '';
          if (navigateOnSubmit) url = 'https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db';
        }
        return {};
      }
      if (method === 'DOM.getBoxModel') {
        return { model: { content: [10, 10, 110, 10, 110, 60, 10, 60] } };
      }
      if (method === 'Input.dispatchMouseEvent') return {};
      throw new Error(`unexpected_debugger_command:${method}`);
    },
  };
  return {
    calls,
    counts: () => ({
      axReads,
      enterDispatched: calls.some(([m, p]) => m === 'Input.dispatchKeyEvent' && p.key === 'Enter'),
    }),
    webContents: {
      id: webContentsId,
      debugger: debuggerApi,
      isDestroyed: () => false,
      getURL: () => url,
      getTitle: () => 'Z.ai',
      getOSProcessId: () => 18000 + webContentsId,
      getOrCreateDevToolsTargetId: () => `target-${webContentsId}`,
    },
  };
}

test('perception exposes the unnamed GLM composer as a semantic-ref-addressable target', async () => {
  const h = fakeZai();
  const frame = await captureSemanticFrame(h.webContents);
  assert.equal(frame.unnamed_text_inputs_addressable_by_backend_node_id, true);
  const composer = frame.semantic_targets.find((row) => row.role === 'textbox');
  assert.ok(composer);
  assert.equal(composer.name, null);
  assert.equal(composer.selector_mode, 'BACKEND_NODE_ID_REQUIRED');
  assert.ok(composer.semantic_ref);
  const modelButton = frame.semantic_targets.find((row) => row.role === 'button');
  assert.equal(modelButton.name, 'Select a model');
  assert.equal(modelButton.selector_mode, 'ROLE_NAME_OR_BACKEND_NODE_ID');
});

test('GLM composer submits with Enter and proves the composer cleared, zero geometry', async () => {
  const h = fakeZai();
  const prompt = 'METAENGINE GLM AGENT PLATFORM TEST TASK';
  const frame = await captureSemanticFrame(h.webContents);
  const composer = frame.semantic_targets.find((row) => row.role === 'textbox');
  const beforeEffect = h.calls.length;
  const result = await executeSemanticCommand(h.webContents, {
    action: 'SEMANTIC_TYPE',
    platform: 'GLM_ZAI',
    payload: {
      role: 'textbox',
      accessible_name: null,
      semantic_ref: composer.semantic_ref,
      text: prompt,
      replace_existing: true,
      submit_after_type: true,
    },
  });

  assert.equal(result.platform, 'GLM_ZAI');
  assert.equal(result.submit_after_type, true);
  assert.equal(result.effect_state, 'PROVEN_COMPOSER_CLEARED');
  assert.equal(result.composer_cleared, true);
  assert.equal(result.stop_observed, false);
  assert.equal(result.new_conversation_observed, false);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.prompt_included, false);
  assert.equal(result.prompt_sha256, crypto.createHash('sha256').update(prompt).digest('hex'));
  assert.equal('text' in result, false);
  assert.ok(h.calls.some(([m, p]) => m === 'Input.dispatchKeyEvent' && p.key === 'Enter' && p.type === 'rawKeyDown'));
  assert.ok(h.calls.some(([m, p]) => m === 'Input.dispatchKeyEvent' && p.key === 'Enter' && p.type === 'keyUp'));
  const effectCalls = h.calls.slice(beforeEffect);
  assert.equal(effectCalls.some(([m]) => m === 'DOM.getBoxModel'), false);
  assert.equal(effectCalls.some(([m]) => m === 'Input.dispatchMouseEvent'), false);
  assert.equal(effectCalls.some(([m]) => m === 'Page.getLayoutMetrics'), false);
});

test('GLM submit on a fresh conversation proves the /c/ transition', async () => {
  const h = fakeZai({ submitWorks: true, navigateOnSubmit: true });
  const frame = await captureSemanticFrame(h.webContents);
  const composer = frame.semantic_targets.find((row) => row.role === 'textbox');
  const result = await executeSemanticCommand(h.webContents, {
    action: 'SEMANTIC_TYPE',
    platform: 'GLM_ZAI',
    payload: {
      role: 'textbox',
      accessible_name: null,
      semantic_ref: composer.semantic_ref,
      text: 'task',
      replace_existing: true,
      submit_after_type: true,
    },
  });
  assert.equal(result.effect_state, 'PROVEN_COMPOSER_CLEARED');
  assert.equal(result.composer_cleared, true);
  assert.equal(result.new_conversation_observed, true);
  assert.match(String(result.post_url_sha256 || ''), /^[a-f0-9]{64}$/);
});

test('GLM submit that provably did not happen stays ambiguous and never clicks', async () => {
  const h = fakeZai({ submitWorks: false });
  const frame = await captureSemanticFrame(h.webContents);
  const composer = frame.semantic_targets.find((row) => row.role === 'textbox');
  const beforeEffect = h.calls.length;
  const result = await executeSemanticCommand(h.webContents, {
    action: 'SEMANTIC_TYPE',
    platform: 'GLM_ZAI',
    payload: {
      role: 'textbox',
      accessible_name: null,
      semantic_ref: composer.semantic_ref,
      text: 'task',
      replace_existing: true,
      submit_after_type: true,
    },
  });
  assert.equal(result.effect_state, 'AMBIGUOUS_AFTER_ENTER');
  assert.equal(result.composer_cleared, false);
  assert.equal(result.new_conversation_observed, false);
  assert.equal(result.automatic_retry_allowed, false);
  // Live-observed logged-out behaviour: the prompt stays in the composer and no
  // unnamed click fallback may exist.
  const effectCalls = h.calls.slice(beforeEffect);
  assert.equal(effectCalls.some(([m]) => m === 'DOM.getBoxModel'), false);
  assert.equal(effectCalls.some(([m]) => m === 'Input.dispatchMouseEvent'), false);
});

test('GLM submit gate fails closed off the chat.z.ai host', async () => {
  const h = fakeZai();
  const originalGetURL = h.webContents.getURL;
  h.webContents.getURL = () => 'https://chatgpt.com/';
  try {
    const frame = await captureSemanticFrame(h.webContents);
    const composer = frame.semantic_targets.find((row) => row.role === 'textbox');
    await assert.rejects(() => executeSemanticCommand(h.webContents, {
      action: 'SEMANTIC_TYPE',
      platform: 'GLM_ZAI',
      payload: {
        role: 'textbox',
        accessible_name: null,
        semantic_ref: composer.semantic_ref,
        text: 'task',
        replace_existing: true,
        submit_after_type: true,
      },
    }), /native_semantic_submit_requires_exact_glm_composer/);
  } finally {
    h.webContents.getURL = originalGetURL;
  }
});

test('GLM STOP requires an exact semantic-ref button target', async () => {
  const h = fakeZai();
  const frame = await captureSemanticFrame(h.webContents);
  await assert.rejects(() => executeSemanticCommand(h.webContents, {
    action: 'STOP_GENERATION',
    platform: 'GLM_ZAI',
    payload: { role: 'button', accessible_name: 'Select a model' },
  }), /native_glm_stop_requires_semantic_ref_button/);
});

test('GLM STOP clicks the exact semantic-ref button through the backend node', async () => {
  const h = fakeZai();
  const frame = await captureSemanticFrame(h.webContents);
  const stopButton = frame.semantic_targets.find((row) => row.role === 'button');
  const result = await executeSemanticCommand(h.webContents, {
    action: 'STOP_GENERATION',
    platform: 'GLM_ZAI',
    payload: {
      role: 'button',
      accessible_name: stopButton.name,
      semantic_ref: stopButton.semantic_ref,
    },
  });
  assert.equal(result.platform, 'GLM_ZAI');
  assert.equal(result.target.role, 'button');
  assert.ok(h.calls.some(([m, p]) => m === 'Input.dispatchMouseEvent' && p.type === 'mousePressed' && p.button === 'left'));
});

test('ChatGPT submit contract is unchanged for the legacy operator lane', async () => {
  const h = fakeZai();
  const frame = await captureSemanticFrame(h.webContents);
  const composer = frame.semantic_targets.find((row) => row.role === 'textbox');
  await assert.rejects(() => executeSemanticCommand(h.webContents, {
    action: 'SEMANTIC_TYPE',
    platform: 'CHATGPT',
    payload: {
      role: 'textbox',
      accessible_name: null,
      semantic_ref: composer.semantic_ref,
      text: 'task',
      replace_existing: true,
      submit_after_type: true,
    },
  }), /native_semantic_submit_requires_exact_chatgpt_composer/);
});
