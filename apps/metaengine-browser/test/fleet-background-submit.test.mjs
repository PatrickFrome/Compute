import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { executeSemanticCommand } from '../src/native-browser-control.mjs';

function fakeChat({
  composerName = 'Чат с ChatGPT',
  sendPresent = true,
  stopAfterEnter = true,
  urlAfterEnter = 'https://chatgpt.com/c/11111111-1111-4111-8111-111111111111',
} = {}) {
  const calls = [];
  let attached = false;
  let entered = false;
  let url = 'https://chatgpt.com/';
  const composer = {
    ignored: false,
    backendDOMNodeId: 101,
    role: { value: 'textbox' },
    name: { value: composerName },
    value: { value: '' },
  };
  const send = {
    ignored: false,
    backendDOMNodeId: 202,
    role: { value: 'button' },
    name: { value: 'Send prompt' },
  };
  const stop = {
    ignored: false,
    backendDOMNodeId: 303,
    role: { value: 'button' },
    name: { value: 'Stop response' },
  };
  const webContents = {
    id: 55,
    isDestroyed: () => false,
    getURL: () => url,
    getTitle: () => 'ChatGPT',
    debugger: {
      isAttached: () => attached,
      attach: () => { attached = true; },
      detach: () => { attached = false; },
      sendCommand: async (method, params = {}) => {
        calls.push([method, params]);
        if (method === 'Accessibility.getFullAXTree') {
          const nodes = [composer];
          if (!entered && sendPresent) nodes.push(send);
          if (entered && stopAfterEnter) nodes.push(stop);
          return { nodes };
        }
        if (method === 'DOM.focus') return {};
        if (method === 'Input.insertText') {
          composer.value.value = String(params.text || '');
          return {};
        }
        if (method === 'Input.dispatchKeyEvent') {
          if (params.key === 'Enter' && params.type === 'rawKeyDown') {
            entered = true;
            url = urlAfterEnter;
            composer.value.value = '';
          }
          return {};
        }
        if (method === 'DOM.getBoxModel') return { model: { content: [0,0,100,0,100,30,0,30] } };
        if (method === 'Input.dispatchMouseEvent') return {};
        if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 1280, clientHeight: 720 } };
        throw new Error(`unexpected_debugger_command:${method}`);
      },
    },
  };
  return { webContents, calls };
}

test('hidden fleet ChatGPT composer submits with Enter and no viewport or mouse geometry', async () => {
  const h = fakeChat();
  const prompt = 'continue development';
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

test('GLM submit fails closed when routed to a ChatGPT WebContents target', async () => {
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
  }), /native_semantic_submit_requires_exact_glm_backend_target/);
  assert.equal(h.calls.some(([method, params]) => method === 'Input.dispatchKeyEvent' && params.key === 'Enter'), false);
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
