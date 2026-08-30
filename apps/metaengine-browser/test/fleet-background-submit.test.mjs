import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { executeSemanticCommand } from '../src/native-browser-control.mjs';

function ax(role, name, id) {
  return {
    ignored: false,
    role: { value: role },
    name: { value: name },
    backendDOMNodeId: id,
  };
}

function fakeChat({ sendPresent = true, proveStop = true } = {}) {
  let attached = false;
  let url = 'https://chatgpt.com/';
  let axReads = 0;
  const calls = [];
  const debuggerApi = {
    isAttached: () => attached,
    attach: () => { attached = true; },
    detach: () => { attached = false; },
    async sendCommand(method, params = {}) {
      calls.push([method, structuredClone(params)]);
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
      debugger: debuggerApi,
      isDestroyed: () => false,
      getURL: () => url,
      getTitle: () => 'ChatGPT',
    },
  };
}

test('hidden fleet ChatGPT composer submits with Enter and no viewport or mouse geometry', async () => {
  const h = fakeChat();
  const prompt = 'METAENGINE FLEET TEST TASK';
  const result = await executeSemanticCommand(h.webContents, {
    action: 'SEMANTIC_TYPE',
    platform: 'CHATGPT',
    payload: {
      role: 'textbox',
      accessible_name: 'Чат с ChatGPT',
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
  assert.equal(h.calls.some(([method]) => method === 'DOM.getBoxModel'), false);
  assert.equal(h.calls.some(([method]) => method === 'Input.dispatchMouseEvent'), false);
  assert.equal(h.calls.some(([method]) => method === 'Page.getLayoutMetrics'), false);
});

test('submit-after-type fails closed outside exact ChatGPT composer', async () => {
  const h = fakeChat();
  await assert.rejects(() => executeSemanticCommand(h.webContents, {
    action: 'SEMANTIC_TYPE',
    platform: 'GLM_ZAI',
    payload: {
      role: 'textbox',
      accessible_name: 'Чат с ChatGPT',
      text: 'task',
      submit_after_type: true,
    },
  }), /native_semantic_submit_requires_exact_chatgpt_composer/);
});

test('submit-after-type requires a unique visible semantic Send control before Enter', async () => {
  const h = fakeChat({ sendPresent: false });
  await assert.rejects(() => executeSemanticCommand(h.webContents, {
    action: 'SEMANTIC_TYPE',
    platform: 'CHATGPT',
    payload: {
      role: 'textbox',
      accessible_name: 'Чат с ChatGPT',
      text: 'task',
      submit_after_type: true,
    },
  }), /native_semantic_send_target_not_found/);
  assert.equal(h.calls.some(([method, params]) => method === 'Input.dispatchKeyEvent' && params.key === 'Enter'), false);
});
