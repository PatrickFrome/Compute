import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LEASED_BROWSER_PLAN_MAX_BYTES,
  LEASED_BROWSER_PLAN_SCHEMA,
  LeasedBrowserPlanExecutor,
} from '../src/leased-browser-plan.mjs';

const COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000';
const TAB_ID = 'tab_123e4567-e89b-42d3-a456-426614174001';
const future = (ms = 60_000) => new Date(Date.now() + ms).toISOString();

function effectCommand(overrides = {}) {
  const command = {
    command_id: COMMAND_ID,
    action: 'SEMANTIC_TYPE',
    platform: 'CHATGPT',
    payload: { tab_id: TAB_ID, text: 'hello' },
    expires_at: future(),
    idempotency_key: 'leased-plan:test:00000001',
    effect_binding: {
      schema: 'metaengine.native-supervisor.effect-binding.v2',
      command_id: COMMAND_ID,
      action: 'SEMANTIC_TYPE',
      tab_id: TAB_ID,
      page_data_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    },
    effect_binding_sha256: 'a'.repeat(64),
    authority_effect: false,
    ...overrides,
  };
  return command;
}

function envelope(command = effectCommand(), overrides = {}) {
  return {
    schema: LEASED_BROWSER_PLAN_SCHEMA,
    plan_id: 'leased:test:0001',
    allowed_origins: ['https://chatgpt.com'],
    deadline_ms: 10_000,
    commands: [command],
    ...overrides,
  };
}

function executor(overrides = {}) {
  return new LeasedBrowserPlanExecutor({
    authorizeCommand: async () => ({ authorized: true, authority_effect: false }),
    executeCommand: async (command) => ({ ok: true, echoed_command_id: command.command_id }),
    verifyCommand: async () => ({ confirmed: true, authority_effect: false }),
    getCurrentUrl: async () => 'https://chatgpt.com/c/test',
    ...overrides,
  });
}

test('leased plan preserves the full DB command and sealed effect context through execution', async () => {
  const original = effectCommand({
    transport_marker: { source: 'DB_LEASE_BATCH', transport_delivery_is_authority: false },
  });
  let authorized = null;
  let executed = null;
  const runtime = executor({
    authorizeCommand: async (command) => { authorized = command; return { authorized: true, authority_effect: false }; },
    executeCommand: async (command) => { executed = command; return { effect_outcome: 'CONFIRMED' }; },
  });

  const receipt = await runtime.execute(envelope(original));

  assert.equal(receipt.state, 'COMPLETED');
  assert.equal(receipt.completed_commands, 1);
  assert.equal(receipt.transport_delivery_is_authority, false);
  assert.equal(receipt.browser_plan_is_authority, false);
  assert.equal(receipt.automatic_effect_retry_allowed, false);
  assert.deepEqual(authorized, executed);
  assert.equal(executed.command_id, original.command_id);
  assert.equal(executed.idempotency_key, original.idempotency_key);
  assert.deepEqual(executed.effect_binding, original.effect_binding);
  assert.equal(executed.effect_binding_sha256, original.effect_binding_sha256);
  assert.deepEqual(executed.transport_marker, original.transport_marker);
});

test('effect-bearing semantic mutation cannot enter execution without a binding', async () => {
  const command = effectCommand();
  delete command.effect_binding;
  let executions = 0;
  const runtime = executor({ executeCommand: async () => { executions += 1; return {}; } });
  await assert.rejects(() => runtime.execute(envelope(command)), /leased_browser_plan_effect_binding_required/);
  assert.equal(executions, 0);
});

test('effect binding must match exact command, tab and fail-closed safety flags structurally', async () => {
  const wrongCommand = effectCommand({ effect_binding: { ...effectCommand().effect_binding, command_id: '223e4567-e89b-42d3-a456-426614174000' } });
  await assert.rejects(() => executor().execute(envelope(wrongCommand)), /effect_binding_command_mismatch/);

  const wrongTab = effectCommand({ effect_binding: { ...effectCommand().effect_binding, tab_id: 'tab_223e4567-e89b-42d3-a456-426614174001' } });
  await assert.rejects(() => executor().execute(envelope(wrongTab)), /effect_binding_tab_mismatch/);

  const retryAllowed = effectCommand({ effect_binding: { ...effectCommand().effect_binding, automatic_retry_allowed: true } });
  await assert.rejects(() => executor().execute(envelope(retryAllowed)), /effect_binding_safety_flags_invalid/);

  const pageAuthority = effectCommand({ effect_binding: { ...effectCommand().effect_binding, page_data_authority: true } });
  await assert.rejects(() => executor().execute(envelope(pageAuthority)), /effect_binding_safety_flags_invalid/);
});

test('tab mutation without explicit exact tab is rejected before authorization', async () => {
  let authorizations = 0;
  const runtime = executor({ authorizeCommand: async () => { authorizations += 1; return { authorized: true }; } });
  const command = effectCommand({ action: 'BACK', payload: {}, effect_binding: undefined, effect_binding_sha256: undefined });
  await assert.rejects(() => runtime.execute(envelope(command)), /leased_browser_plan_exact_tab_required:BACK/);
  assert.equal(authorizations, 0);
});

test('authority, self-update and non-browser actions are denied', async () => {
  for (const action of ['ARM', 'DISARM', 'SET_SUPERVISOR_MODE', 'SELF_UPDATE_APPLY', 'GATE_DISABLE', 'CONTROL_CAPABILITIES']) {
    const command = effectCommand({ action, effect_binding: undefined, effect_binding_sha256: undefined });
    await assert.rejects(() => executor().execute(envelope(command)), /leased_browser_plan_action_denied/);
  }
});

test('expired commands are rejected at admission and rechecked immediately before effect', async () => {
  await assert.rejects(
    () => executor().execute(envelope(effectCommand({ expires_at: new Date(Date.now() - 1).toISOString() }))),
    /leased_browser_plan_command_expired/,
  );

  let executed = false;
  const command = effectCommand({ expires_at: future(25) });
  const runtime = executor({
    getCurrentUrl: async () => { await new Promise((resolve) => setTimeout(resolve, 35)); return 'https://chatgpt.com/c/test'; },
    executeCommand: async () => { executed = true; return {}; },
  });
  const receipt = await runtime.execute(envelope(command));
  assert.equal(receipt.state, 'NEEDS_REPLAN');
  assert.equal(receipt.reason, 'COMMAND_EXPIRED_BEFORE_EFFECT');
  assert.equal(executed, false);
});

test('local authorization denial prevents physical execution', async () => {
  let executed = false;
  const runtime = executor({
    authorizeCommand: async () => ({ authorized: false, reason: 'binding_generation_changed' }),
    executeCommand: async () => { executed = true; return {}; },
  });
  const receipt = await runtime.execute(envelope());
  assert.equal(receipt.state, 'NEEDS_REPLAN');
  assert.equal(receipt.reason, 'LOCAL_AUTHORIZATION_DENIED');
  assert.equal(executed, false);
});

test('unproven mutation is ambiguous and is never retried', async () => {
  let executions = 0;
  const runtime = executor({
    executeCommand: async () => { executions += 1; return { maybe_changed: true }; },
    verifyCommand: async () => ({ confirmed: false, no_effect_proven: false }),
  });
  const receipt = await runtime.execute(envelope());
  assert.equal(receipt.state, 'AMBIGUOUS');
  assert.equal(receipt.reason, 'POSTCONDITION_UNPROVEN');
  assert.equal(executions, 1);
  assert.equal(receipt.automatic_effect_retry_allowed, false);
});

test('proven no-effect mutation requests replan without retry', async () => {
  let executions = 0;
  const runtime = executor({
    executeCommand: async () => { executions += 1; return { changed: false }; },
    verifyCommand: async () => ({ confirmed: false, no_effect_proven: true }),
  });
  const receipt = await runtime.execute(envelope());
  assert.equal(receipt.state, 'NEEDS_REPLAN');
  assert.equal(receipt.reason, 'NO_EFFECT_PROVEN');
  assert.equal(executions, 1);
});

test('cancellation during an in-flight mutation remains ambiguous', async () => {
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const runtime = executor({
    executeCommand: async (_command, { signal }) => {
      entered();
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('physical_effect_interrupted')), { once: true });
      });
    },
  });
  const running = runtime.execute(envelope());
  await started;
  assert.equal(runtime.cancel('leased:test:0001', 'USER_CANCEL').cancelled, true);
  const receipt = await running;
  assert.equal(receipt.state, 'AMBIGUOUS');
  assert.equal(receipt.reason, 'USER_CANCEL');
  assert.equal(receipt.completed_commands, 0);
});

test('navigation target and current page must remain inside the plan origin fence', async () => {
  const nav = effectCommand({
    action: 'NAVIGATE',
    payload: { tab_id: TAB_ID, url: 'https://evil.example/' },
    effect_binding: undefined,
    effect_binding_sha256: undefined,
  });
  let executed = false;
  const runtime = executor({ executeCommand: async () => { executed = true; return {}; } });
  const receipt = await runtime.execute(envelope(nav));
  assert.equal(receipt.state, 'NEEDS_REPLAN');
  assert.equal(receipt.reason, 'NAVIGATION_TARGET_ORIGIN_DENIED');
  assert.equal(executed, false);

  const fenced = executor({ getCurrentUrl: async () => 'https://other.example/' });
  const receipt2 = await fenced.execute(envelope());
  assert.equal(receipt2.state, 'NEEDS_REPLAN');
  assert.equal(receipt2.reason, 'ORIGIN_FENCE_MISMATCH');
});

test('leased envelope stays below the physical Host Agent IPC payload ceiling', async () => {
  const runtime = executor();
  const large = envelope(effectCommand({
    action: 'NEW_TAB',
    payload: { url: 'https://chatgpt.com/', padding: 'x'.repeat(LEASED_BROWSER_PLAN_MAX_BYTES) },
    effect_binding: undefined,
    effect_binding_sha256: undefined,
  }));
  await assert.rejects(() => runtime.execute(large), /leased_browser_plan_too_large/);
  assert.equal(runtime.snapshot().max_bytes, LEASED_BROWSER_PLAN_MAX_BYTES);
  assert.equal(runtime.snapshot().max_bytes < 48 * 1024, true);
  assert.equal(runtime.snapshot().command_expiry_rechecked_before_effect, true);
});
