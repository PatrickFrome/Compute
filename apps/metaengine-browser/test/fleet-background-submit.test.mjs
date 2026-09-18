import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { captureSemanticFrame, executeSemanticCommand } from '../src/native-browser-control.mjs';

function ax(role, name, id) {
  return {
    nodeId: `ax-${id}`,
    ignored: false,
    role: { value: role },
    name: { value: name },
    backendDOMNodeId: id,
    frameId: 'frame-root',
  };
}

let nextWebContentsId = 7000;
function fakeChat({ sendPresent = true, proveStop = true } = {}) {
  let attached = false;
  let url = 'https://chatgpt.com/';
  let axReads = 0;
  const calls = [];
  const listeners = new Map();
  const webContentsId = nextWebContentsId++;
  const debuggerApi = {
    isAttached: () => attached,
    attach: () => { attached = true; },
    detach: () => { attached = false; },
    on(name, fn) { const rows=listeners.get(name)||new Set(); rows.add(fn); listeners.set(name, rows); },
    off(name, fn) { listeners.get(name)?.delete(fn); },
    emitMessage(method, params={}) { for (const fn of listeners.get('message')||[]) fn({},method,params,null); },
    async sendCommand(method, params = {}) {
      calls.push([method, structuredClone(params)]);
      if (method === 'Page.getFrameTree') return { frameTree:{ frame:{ id:'frame-root', url } } };
      if (method === 'Runtime.enable') {
        this.emitMessage('Runtime.executionContextCreated',{context:{id:1,uniqueId:`context-${webContentsId}`,auxData:{frameId:'frame-root',isDefault:true}}});
        return {};
      }
      if (['Page.enable','DOM.enable','Accessibility.enable','Page.setLifecycleEventsEnabled','Network.enable','Target.setAutoAttach','DOM.getDocument'].includes(method)) return {};
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport:{ clientWidth:1200, clientHeight:800 } };
      if (method === 'Accessibility.getFullAXTree') {
        axReads += 1;
        if (axReads === 1) return { nodes: [ax('textbox', 'Чат с ChatGPT', 3)] };
        if (axReads === 2) {
          return { nodes: [
            ax('textbox', 'Чат с ChatGPT', 3),
            ...(sendPresent ? [ax('button', 'Отправить промпт', 7)] : []),
          ] };
        }
        return { nodes: proveStop ? [
          ax('textbox', 'Чат с ChatGPT', 3),
          ax('button', 'Остановить ответ', 9),
        ] : [ax('textbox', 'Чат с ChatGPT', 3), ax('button', 'Отправить промпт', 7)] };
      }
      if (method === 'DOM.focus' || method === 'Input.insertText') return {};
      if (method === 'Input.dispatchKeyEvent') {
        if (params.key === 'Enter' && params.type === 'rawKeyDown' && proveStop) {
          url = 'https://chatgpt.com/c/11111111-2222-3333-4444-555555555555';
        }
        return {};
      }
      throw new Error(`unexpected_debugger_command:${method}`);
    },
  };
  return {
    calls,
    webContents: {
      id: webContentsId,
      debugger: debuggerApi,
      isDestroyed: () => false,
      getURL: () => url,
      getTitle: () => 'ChatGPT',
      getOSProcessId: () => 17000 + webContentsId,
      getOrCreateDevToolsTargetId: () => `target-${webContentsId}`,
    },
  };
}

test('hidden fleet ChatGPT composer submits with Enter and no viewport or mouse geometry', async () => {
  const h = fakeChat();
  const prompt = 'METAENGINE FLEET TEST TASK';
  const frame = await captureSemanticFrame(h.webContents);
  const composer = frame.semantic_targets.find((row) => row.role === 'textbox');
  const beforeEffect = h.calls.length;
  const result = await executeSemanticCommand(h.webContents, {
    action: 'SEMANTIC_TYPE',
    platform: 'CHATGPT',
    payload: {
      role: 'textbox',
      accessible_name: 'Чат с ChatGPT',
      semantic_ref: composer.semantic_ref,
      text: prompt,
      replace_existing: true,
      submit_after_type: true,
    },
  });

  assert.equal(result.submit_after_type, true);
  assert.equal(result.effect_state, 'PROVEN_GENERATING');
  assert.equal(result.stop_observed, true);
  assert.equal(result.new_conversation_observed, true);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.prompt_included, false);
  assert.equal(result.prompt_sha256, crypto.createHash('sha256').update(prompt).digest('hex'));
  assert.equal('text' in result, false);
  assert.ok(h.calls.some(([method, params]) => method === 'Input.dispatchKeyEvent' && params.key === 'Enter' && params.type === 'rawKeyDown'));
  assert.ok(h.calls.some(([method, params]) => method === 'Input.dispatchKeyEvent' && params.key === 'Enter' && params.type === 'keyUp'));
  const effectCalls = h.calls.slice(beforeEffect);
  assert.equal(effectCalls.some(([method]) => method === 'DOM.getBoxModel'), false);
  assert.equal(effectCalls.some(([method]) => method === 'Input.dispatchMouseEvent'), false);
  assert.equal(effectCalls.some(([method]) => method === 'Page.getLayoutMetrics'), false);
});

test('submit-after-type fails closed outside exact ChatGPT composer', async () => {
  const h = fakeChat();
  const frame = await captureSemanticFrame(h.webContents);
  const composer = frame.semantic_targets.find((row) => row.role === 'textbox');
  // GLM agent platform (2026-09-19): a GLM_ZAI submit on a non-chat.z.ai host
  // fails the GLM composer gate (the composer's semantic_ref pins the node,
  // so a payload-name mismatch cannot reach the gate when a ref is present —
  // the platform field is the discriminating input).
  await assert.rejects(() => executeSemanticCommand(h.webContents, {
    action: 'SEMANTIC_TYPE',
    platform: 'GLM_ZAI',
    payload: {
      role: 'textbox',
      accessible_name: 'Чат с ChatGPT',
      semantic_ref: composer.semantic_ref,
      text: 'task',
      submit_after_type: true,
    },
  }), /native_semantic_submit_requires_exact_glm_composer/);
});

test('submit-after-type requires a unique visible semantic Send control before Enter', async () => {
  const h = fakeChat({ sendPresent: false });
  const frame = await captureSemanticFrame(h.webContents);
  const composer = frame.semantic_targets.find((row) => row.role === 'textbox');
  await assert.rejects(() => executeSemanticCommand(h.webContents, {
    action: 'SEMANTIC_TYPE',
    platform: 'CHATGPT',
    payload: {
      role: 'textbox',
      accessible_name: 'Чат с ChatGPT',
      semantic_ref: composer.semantic_ref,
      text: 'task',
      submit_after_type: true,
    },
  }), /native_semantic_send_target_not_found/);
  assert.equal(h.calls.some(([method, params]) => method === 'Input.dispatchKeyEvent' && params.key === 'Enter'), false);
});
