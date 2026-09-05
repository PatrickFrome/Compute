import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureSemanticFrame,
  executeSemanticCommand,
} from '../src/native-browser-control.mjs';

function axNode({ id = 41, role = 'textbox', name = '', value = '' } = {}) {
  return {
    ignored: false,
    backendDOMNodeId: id,
    role: { value: role },
    name: { value: name },
    value: { value },
  };
}

function fakeWebContents({
  url = 'https://chat.z.ai/c/55fd8c37-00d0-4821-8e56-14f36c7be6db',
  nodeId = 41,
  role = 'textbox',
  name = '',
  mirrorInsertedText = true,
} = {}) {
  let attached = false;
  let value = '';
  let enterCount = 0;
  const calls = [];
  const debuggerApi = {
    isAttached: () => attached,
    attach: () => { attached = true; },
    detach: () => { attached = false; },
    sendCommand: async (method, params = {}) => {
      calls.push({ method, params });
      if (method === 'Accessibility.getFullAXTree') {
        return { nodes: [axNode({ id: nodeId, role, name, value })] };
      }
      if (method === 'Page.getLayoutMetrics') {
        return { cssVisualViewport: { clientWidth: 1280, clientHeight: 720, pageX: 0, pageY: 0, scale: 1 } };
      }
      if (method === 'DOM.focus') return {};
      if (method === 'Input.insertText') {
        if (mirrorInsertedText) value = String(params.text || '');
        return {};
      }
      if (method === 'Input.dispatchKeyEvent') {
        if (params.key === 'Enter' && params.type === 'rawKeyDown') {
          enterCount += 1;
          value = '';
        }
        return {};
      }
      if (method === 'DOM.getBoxModel') {
        return { model: { content: [0, 0, 100, 0, 100, 30, 0, 30] } };
      }
      if (method === 'Input.dispatchMouseEvent') return {};
      throw new Error(`unexpected_debugger_command:${method}`);
    },
  };
  return {
    id: 77,
    isDestroyed: () => false,
    getURL: () => url,
    getTitle: () => 'Z.ai - GLM',
    debugger: debuggerApi,
    calls,
    get enterCount() { return enterCount; },
    get value() { return value; },
  };
}

test('GLM capture retains unnamed composer as a backend-node-addressable text input', async () => {
  const wc = fakeWebContents({ nodeId: 59221, name: '' });
  const frame = await captureSemanticFrame(wc);
  const composer = frame.semantic_targets.find((target) => target.backend_node_id === 59221);
  assert.ok(composer, 'unnamed GLM composer must not be discarded');
  assert.equal(composer.role, 'textbox');
  assert.equal(composer.name, null);
  assert.equal(composer.semantic_target_id, 'ax:59221');
  assert.equal(composer.selector_mode, 'BACKEND_NODE_ID_REQUIRED');
  assert.equal(frame.unnamed_text_inputs_addressable_by_backend_node_id, true);
  assert.equal(frame.semantic_input_values_exposed, false);
});

test('GLM SEMANTIC_TYPE can bind to a fresh unnamed backend node without accessible_name', async () => {
  const wc = fakeWebContents({ nodeId: 60200 });
  const result = await executeSemanticCommand(wc, {
    action: 'SEMANTIC_TYPE',
    platform: 'GLM_ZAI',
    payload: {
      role: 'textbox',
      backend_node_id: 60200,
      text: 'hello glm',
      replace_existing: true,
      submit_after_type: false,
    },
  });
  assert.equal(result.target.backend_node_id, 60200);
  assert.equal(result.target.name, null);
  assert.equal(result.inserted_chars, 9);
  assert.equal(result.prompt_included, false);
  assert.equal(typeof result.prompt_sha256, 'string');
  assert.equal(wc.enterCount, 0);
});

test('GLM submit requires positive exact prompt readback before Enter and proves composer clear after Enter', async () => {
  const wc = fakeWebContents({ nodeId: 60300, mirrorInsertedText: true });
  const result = await executeSemanticCommand(wc, {
    action: 'SEMANTIC_TYPE',
    platform: 'GLM_ZAI',
    payload: {
      role: 'textbox',
      backend_node_id: 60300,
      text: 'prove this prompt',
      replace_existing: true,
      submit_after_type: true,
    },
  });
  assert.equal(wc.enterCount, 1);
  assert.equal(result.pre_submit_readback.exact_prompt_readback, true);
  assert.equal(result.pre_submit_readback.value_length, 'prove this prompt'.length);
  assert.equal(result.send_control.pre_submit_exact_readback, true);
  assert.equal(result.effect_state, 'PROVEN_COMPOSER_CLEARED');
  assert.equal(result.composer_cleared, true);
  assert.equal(result.automatic_retry_allowed, false);
});

test('GLM submit never presses Enter when inserted text cannot be independently read back', async () => {
  const wc = fakeWebContents({ nodeId: 60400, mirrorInsertedText: false });
  await assert.rejects(
    executeSemanticCommand(wc, {
      action: 'SEMANTIC_TYPE',
      platform: 'GLM_ZAI',
      payload: {
        role: 'textbox',
        backend_node_id: 60400,
        text: 'must not send ambiguously',
        replace_existing: true,
        submit_after_type: true,
      },
    }),
    /native_glm_pre_submit_input_unverified/,
  );
  assert.equal(wc.enterCount, 0, 'no physical submit effect is allowed without positive pre-submit readback');
});

test('stale GLM backend node id and role reuse fail closed', async () => {
  const missing = fakeWebContents({ nodeId: 60500 });
  await assert.rejects(
    executeSemanticCommand(missing, {
      action: 'SEMANTIC_TYPE',
      platform: 'GLM_ZAI',
      payload: { role: 'textbox', backend_node_id: 60501, text: 'x' },
    }),
    /native_semantic_backend_target_not_found/,
  );

  const changed = fakeWebContents({ nodeId: 60600, role: 'button', name: 'Something else' });
  await assert.rejects(
    executeSemanticCommand(changed, {
      action: 'SEMANTIC_TYPE',
      platform: 'GLM_ZAI',
      payload: { role: 'textbox', backend_node_id: 60600, text: 'x' },
    }),
    /native_semantic_target_role_changed:button/,
  );
});

test('GLM STOP_GENERATION cannot alias an arbitrary fresh button', async () => {
  const wc = fakeWebContents({ nodeId: 60700, role: 'button', name: 'Unknown button' });
  await assert.rejects(
    executeSemanticCommand(wc, {
      action: 'STOP_GENERATION',
      platform: 'GLM_ZAI',
      payload: { role: 'button', backend_node_id: 60700 },
    }),
    /native_glm_stop_requires_observed_typed_click/,
  );
  assert.equal(wc.calls.some((row) => row.method === 'Input.dispatchMouseEvent'), false);
});
