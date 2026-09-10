import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserEffectBindingPreparation } from '../src/browser-effect-binding-preparation.mjs';

const COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000';
const TAB_ID = 'tab_123e4567-e89b-42d3-a456-426614174001';
const PROCESS_ID = '223e4567-e89b-42d3-a456-426614174000';

function command(overrides = {}) {
  return {
    command_id: COMMAND_ID,
    action: 'SEMANTIC_TYPE',
    platform: 'CHATGPT',
    payload: { tab_id: TAB_ID, text: 'secret user text must not echo' },
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

function frame(overrides = {}) {
  return {
    tab_id: TAB_ID,
    process_incarnation_id: PROCESS_ID,
    target_id: 'webcontents:42',
    runtime_observation_id: `obs_${'a'.repeat(32)}`,
    captured_at: new Date().toISOString(),
    text: 'page content must not cross boundary',
    inputs: [{ value: 'private input' }],
    screenshot: 'base64-image-data',
    ...overrides,
  };
}

test('preparation exposes only runtime binding identifiers, never captured page data', async () => {
  let captured = null;
  const runtime = new BrowserEffectBindingPreparation({
    captureCommand: async (value) => { captured = value; return frame(); },
  });
  const result = await runtime.prepare(command());

  assert.deepEqual(captured, { action: 'CAPTURE', platform: 'CHATGPT', payload: { tab_id: TAB_ID } });
  assert.equal(result.command_id, COMMAND_ID);
  assert.equal(result.action, 'SEMANTIC_TYPE');
  assert.equal(result.tab_id, TAB_ID);
  assert.equal(result.process_incarnation_id, PROCESS_ID);
  assert.equal(result.target_id, 'webcontents:42');
  assert.equal(result.runtime_observation_id, `obs_${'a'.repeat(32)}`);
  assert.equal(result.page_text_exposed, false);
  assert.equal(result.input_values_exposed, false);
  assert.equal(result.screenshot_exposed, false);
  assert.equal(Object.hasOwn(result, 'text'), false);
  assert.equal(Object.hasOwn(result, 'inputs'), false);
  assert.equal(Object.hasOwn(result, 'screenshot'), false);
  assert.equal(JSON.stringify(result).includes('page content must not cross boundary'), false);
  assert.equal(JSON.stringify(result).includes('private input'), false);
});

test('only effect-binding actions with exact tab and live expiry are accepted', async () => {
  const runtime = new BrowserEffectBindingPreparation({ captureCommand: async () => frame() });
  await assert.rejects(() => runtime.prepare(command({ action: 'BACK' })), /action_denied:BACK/);
  await assert.rejects(() => runtime.prepare(command({ payload: {} })), /exact_tab_required/);
  await assert.rejects(() => runtime.prepare(command({ expires_at: new Date(Date.now() - 1).toISOString() })), /command_expired/);
});

test('observation must stay bound to exact tab, process, target and runtime observation', async () => {
  await assert.rejects(
    () => new BrowserEffectBindingPreparation({ captureCommand: async () => frame({ tab_id: 'tab_323e4567-e89b-42d3-a456-426614174001' }) }).prepare(command()),
    /tab_drift/,
  );
  await assert.rejects(
    () => new BrowserEffectBindingPreparation({ captureCommand: async () => frame({ process_incarnation_id: 'bad' }) }).prepare(command()),
    /process_incarnation_invalid/,
  );
  await assert.rejects(
    () => new BrowserEffectBindingPreparation({ captureCommand: async () => frame({ target_id: 'page:42' }) }).prepare(command()),
    /target_invalid/,
  );
  await assert.rejects(
    () => new BrowserEffectBindingPreparation({ captureCommand: async () => frame({ runtime_observation_id: 'bad' }) }).prepare(command()),
    /runtime_observation_invalid/,
  );
});

test('expiry is rechecked after capture before preparation leaves Browser', async () => {
  let calls = 0;
  const runtime = new BrowserEffectBindingPreparation({
    captureCommand: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 35));
      return frame();
    },
  });
  await assert.rejects(() => runtime.prepare(command({ expires_at: new Date(Date.now() + 25).toISOString() })), /command_expired/);
  assert.equal(calls, 1);
});

test('aborted preparation does not claim cancellation of any effect', async () => {
  const controller = new AbortController();
  controller.abort('cancelled');
  let calls = 0;
  const runtime = new BrowserEffectBindingPreparation({ captureCommand: async () => { calls += 1; return frame(); } });
  await assert.rejects(() => runtime.prepare(command(), { signal: controller.signal }), /prepare_aborted/);
  assert.equal(calls, 0);
  assert.equal(runtime.snapshot().effect_binding_sealing, false);
  assert.equal(runtime.snapshot().command_leasing, false);
});
