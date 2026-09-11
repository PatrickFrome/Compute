import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserEffectBindingPreparation } from '../src/browser-effect-binding-preparation.mjs';

const COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000';
const TAB_ID = 'tab_123e4567-e89b-42d3-a456-426614174001';
const PROCESS_ID = '223e4567-e89b-42d3-a456-426614174000';
const CLIENT_ID = '323e4567-e89b-42d3-a456-426614174000';
const IDEMPOTENCY_KEY = 'effect-prepare:test:0001';

function command(overrides = {}) {
  return {
    command_id: COMMAND_ID,
    action: 'SEMANTIC_TYPE',
    platform: 'CHATGPT',
    payload: { tab_id: TAB_ID, text: 'secret user text must not echo' },
    idempotency_key: IDEMPOTENCY_KEY,
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

function runtime(overrides = {}) {
  return new BrowserEffectBindingPreparation({
    captureCommand: async () => frame(),
    identitySnapshot: async () => ({ client_id: CLIENT_ID }),
    buildBinding: async ({ command: localCommand, clientId, processIncarnationId, tabId, targetId, observedAt, runtimeObservationId }) => ({
      schema: 'metaengine.native-supervisor.effect-binding.v2',
      command_id: localCommand.command_id,
      idempotency_key: localCommand.idempotency_key,
      action: localCommand.action,
      client_id: clientId,
      process_incarnation_id: processIncarnationId,
      tab_id: tabId,
      target_id: targetId,
      observed_at: observedAt,
      runtime_observation_id: runtimeObservationId,
      page_data_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    }),
    ...overrides,
  });
}

test('preparation builds local v2 binding from process-local observation and never exposes captured page data', async () => {
  let captured = null;
  let buildArgs = null;
  const instance = runtime({
    captureCommand: async (value) => { captured = value; return frame(); },
    buildBinding: async (args) => {
      buildArgs = structuredClone(args);
      return {
        schema: 'metaengine.native-supervisor.effect-binding.v2',
        command_id: args.command.command_id,
        idempotency_key: args.command.idempotency_key,
        action: args.command.action,
        client_id: args.clientId,
        process_incarnation_id: args.processIncarnationId,
        tab_id: args.tabId,
        target_id: args.targetId,
        observed_at: args.observedAt,
        runtime_observation_id: args.runtimeObservationId,
        page_data_authority: false,
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    },
  });
  const result = await instance.prepare(command());

  assert.deepEqual(captured, { action: 'CAPTURE', platform: 'CHATGPT', payload: { tab_id: TAB_ID } });
  assert.equal(buildArgs.clientId, CLIENT_ID);
  assert.equal(buildArgs.processIncarnationId, PROCESS_ID);
  assert.equal(buildArgs.tabId, TAB_ID);
  assert.equal(buildArgs.targetId, 'webcontents:42');
  assert.equal(buildArgs.runtimeObservationId, `obs_${'a'.repeat(32)}`);
  assert.equal(buildArgs.command.payload.tab_id, TAB_ID);
  assert.equal(Object.hasOwn(buildArgs.command.payload, 'text'), false);
  assert.equal(buildArgs.command.idempotency_key, IDEMPOTENCY_KEY);

  assert.equal(result.command_id, COMMAND_ID);
  assert.equal(result.action, 'SEMANTIC_TYPE');
  assert.equal(result.tab_id, TAB_ID);
  assert.equal(result.process_incarnation_id, PROCESS_ID);
  assert.equal(result.target_id, 'webcontents:42');
  assert.equal(result.runtime_observation_id, `obs_${'a'.repeat(32)}`);
  assert.equal(result.binding.schema, 'metaengine.native-supervisor.effect-binding.v2');
  assert.equal(result.binding.client_id, CLIENT_ID);
  assert.equal(result.binding_built_in_browser_process, true);
  assert.equal(result.page_text_exposed, false);
  assert.equal(result.input_values_exposed, false);
  assert.equal(result.screenshot_exposed, false);
  assert.equal(Object.hasOwn(result, 'text'), false);
  assert.equal(Object.hasOwn(result, 'inputs'), false);
  assert.equal(Object.hasOwn(result, 'screenshot'), false);
  assert.equal(JSON.stringify(result).includes('page content must not cross boundary'), false);
  assert.equal(JSON.stringify(result).includes('private input'), false);
  assert.equal(JSON.stringify(result).includes('secret user text must not echo'), false);
});

test('only effect-binding actions with exact tab idempotency and live expiry are accepted', async () => {
  const instance = runtime();
  await assert.rejects(() => instance.prepare(command({ action: 'BACK' })), /action_denied:BACK/);
  await assert.rejects(() => instance.prepare(command({ payload: {} })), /exact_tab_required/);
  await assert.rejects(() => instance.prepare(command({ idempotency_key: 'short' })), /idempotency_key_invalid/);
  await assert.rejects(() => instance.prepare(command({ expires_at: new Date(Date.now() - 1).toISOString() })), /command_expired/);
});

test('observation must stay bound to exact tab process target and runtime observation', async () => {
  await assert.rejects(runtime({ captureCommand: async () => frame({ tab_id: 'tab_423e4567-e89b-42d3-a456-426614174001' }) }).prepare(command()), /tab_drift/);
  await assert.rejects(runtime({ captureCommand: async () => frame({ process_incarnation_id: 'bad' }) }).prepare(command()), /process_incarnation_invalid/);
  await assert.rejects(runtime({ captureCommand: async () => frame({ target_id: 'page:42' }) }).prepare(command()), /target_invalid/);
  await assert.rejects(runtime({ captureCommand: async () => frame({ runtime_observation_id: 'bad' }) }).prepare(command()), /runtime_observation_invalid/);
});

test('Browser identity client id is independently required for local binding construction', async () => {
  await assert.rejects(runtime({ identitySnapshot: async () => ({ client_id: 'bad' }) }).prepare(command()), /client_id_invalid/);
});

test('expiry is rechecked after capture before local binding leaves Browser', async () => {
  let calls = 0;
  const instance = runtime({
    captureCommand: async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 35));
      return frame();
    },
  });
  await assert.rejects(() => instance.prepare(command({ expires_at: new Date(Date.now() + 25).toISOString() })), /command_expired/);
  assert.equal(calls, 1);
});

test('aborted preparation does not build or seal an effect binding', async () => {
  const controller = new AbortController();
  controller.abort('cancelled');
  let captureCalls = 0;
  let buildCalls = 0;
  const instance = runtime({
    captureCommand: async () => { captureCalls += 1; return frame(); },
    buildBinding: async () => { buildCalls += 1; return {}; },
  });
  await assert.rejects(() => instance.prepare(command(), { signal: controller.signal }), /prepare_aborted/);
  assert.equal(captureCalls, 0);
  assert.equal(buildCalls, 0);
  assert.equal(instance.snapshot().effect_binding_sealing, false);
  assert.equal(instance.snapshot().command_leasing, false);
  assert.equal(instance.snapshot().runtime_observation_registry_process_local, true);
});
