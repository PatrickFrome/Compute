import assert from 'node:assert/strict';
import test from 'node:test';
import { createSupervisorSendBoundaryExecutor } from '../src/supervisor-lifecycle-runtime.mjs';

const URL = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function nativeFrame({ tabId = 'tab1', processId = 'process-1', targetId = 'webcontents:11', width = 900, height = 600 } = {}) {
  return {
    schema: 'metaengine.native-browser.perception.v1',
    tab_id: tabId,
    process_incarnation_id: processId,
    target_id: targetId,
    url: URL,
    title: 'ChatGPT',
    text_excerpt: '',
    viewport: { width, height, page_x: 0, page_y: 0, scale: 1 },
    semantic_targets: [
      { role: 'textbox', name: 'Message ChatGPT' },
      { role: 'button', name: 'Send' },
    ],
    authority_effect: false,
  };
}

const sendCommand = () => ({
  action: 'TYPED_CLICK',
  payload: { tab_id: 'tab1', role: 'button', accessible_name: 'Send' },
  platform: null,
});

test('native Send is preceded by exact SELECT_TAB, incarnation revalidation and positive viewport', async () => {
  let selected = false;
  let clicks = 0;
  const actions = [];
  const raw = async (command) => {
    actions.push(command.action);
    if (command.action === 'CAPTURE') return nativeFrame();
    if (command.action === 'SELECT_TAB') { selected = true; return { ok: true, tab_id: 'tab1' }; }
    if (command.action === 'TYPED_CLICK') { clicks += 1; return { ok: true, authority_effect: true }; }
    throw new Error(`unexpected:${command.action}`);
  };
  const execute = createSupervisorSendBoundaryExecutor({
    getState: async () => ({ tabs: [{ tab_id: 'tab1', url: URL, selected }] }),
    executeCommand: raw,
  });

  const result = await execute(sendCommand());
  assert.equal(result.ok, true);
  assert.equal(clicks, 1);
  assert.deepEqual(actions, ['CAPTURE', 'SELECT_TAB', 'CAPTURE', 'TYPED_CLICK']);
});

test('zero viewport suppresses the physical Send click after SELECT_TAB', async () => {
  let selected = false;
  let captures = 0;
  let clicks = 0;
  const raw = async (command) => {
    if (command.action === 'CAPTURE') {
      captures += 1;
      return nativeFrame({ width: captures === 1 ? 900 : 0 });
    }
    if (command.action === 'SELECT_TAB') { selected = true; return { ok: true, tab_id: 'tab1' }; }
    if (command.action === 'TYPED_CLICK') { clicks += 1; return { ok: true }; }
    throw new Error(`unexpected:${command.action}`);
  };
  const execute = createSupervisorSendBoundaryExecutor({
    getState: async () => ({ tabs: [{ tab_id: 'tab1', url: URL, selected }] }),
    executeCommand: raw,
  });

  const result = await execute(sendCommand());
  assert.equal(result.suppressed, true);
  assert.equal(result.reason, 'SUPERVISOR_VIEWPORT_NOT_VISIBLE');
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(clicks, 0);
});

test('target or process incarnation drift suppresses the physical Send click', async () => {
  let selected = false;
  let captures = 0;
  let clicks = 0;
  const raw = async (command) => {
    if (command.action === 'CAPTURE') {
      captures += 1;
      return nativeFrame({ targetId: captures === 1 ? 'webcontents:11' : 'webcontents:12' });
    }
    if (command.action === 'SELECT_TAB') { selected = true; return { ok: true, tab_id: 'tab1' }; }
    if (command.action === 'TYPED_CLICK') { clicks += 1; return { ok: true }; }
    throw new Error(`unexpected:${command.action}`);
  };
  const execute = createSupervisorSendBoundaryExecutor({
    getState: async () => ({ tabs: [{ tab_id: 'tab1', url: URL, selected }] }),
    executeCommand: raw,
  });

  const result = await execute(sendCommand());
  assert.equal(result.suppressed, true);
  assert.equal(result.reason, 'SUPERVISOR_TARGET_INCARNATION_CHANGED');
  assert.equal(clicks, 0);
});

test('same prompt is not retyped and an ambiguous click is never physically repeated', async () => {
  let selected = false;
  let types = 0;
  let clicks = 0;
  const raw = async (command) => {
    if (command.action === 'CAPTURE') return nativeFrame();
    if (command.action === 'SELECT_TAB') { selected = true; return { ok: true, tab_id: 'tab1' }; }
    if (command.action === 'SEMANTIC_TYPE') { types += 1; return { ok: true, authority_effect: true }; }
    if (command.action === 'TYPED_CLICK') { clicks += 1; throw new Error('transport_lost_after_dispatch'); }
    throw new Error(`unexpected:${command.action}`);
  };
  const execute = createSupervisorSendBoundaryExecutor({
    getState: async () => ({ tabs: [{ tab_id: 'tab1', url: URL, selected }] }),
    executeCommand: raw,
  });

  await execute({ action: 'CAPTURE', payload: { tab_id: 'tab1' }, platform: null });
  const type = { action: 'SEMANTIC_TYPE', payload: { tab_id: 'tab1', role: 'textbox', accessible_name: 'Message ChatGPT', text: 'METAENGINE_SUPERVISOR_WAKE_V1\nwake_id=wake_test', replace_existing: true }, platform: null };
  await execute(type);
  const duplicateType = await execute(type);
  assert.equal(types, 1);
  assert.equal(duplicateType.reason, 'DUPLICATE_PROMPT_TYPE_SUPPRESSED');

  const firstClick = await execute(sendCommand());
  assert.equal(firstClick.reason, 'SEND_CLICK_EFFECT_AMBIGUOUS');
  assert.equal(clicks, 1);
  const duplicateClick = await execute(sendCommand());
  assert.equal(duplicateClick.reason, 'SEND_CLICK_ALREADY_ATTEMPTED');
  assert.equal(clicks, 1);
});

test('non-native mock executors retain the established lifecycle test path', async () => {
  let clicks = 0;
  const execute = createSupervisorSendBoundaryExecutor({
    getState: async () => ({ tabs: [] }),
    executeCommand: async (command) => {
      if (command.action === 'CAPTURE') return { semantic_targets: [{ role: 'button', name: 'Send' }] };
      if (command.action === 'TYPED_CLICK') { clicks += 1; return { ok: true }; }
      throw new Error(`unexpected:${command.action}`);
    },
  });
  const result = await execute(sendCommand());
  assert.equal(result.ok, true);
  assert.equal(clicks, 1);
});
