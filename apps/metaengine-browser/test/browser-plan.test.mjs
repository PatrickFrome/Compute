import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserPlanExecutor } from '../src/browser-plan.mjs';
import { CONTROL_ACTION_MANIFEST_REVISION } from '../src/control-actions-manifest.mjs';

const plan = (steps, overrides = {}) => ({
  plan_id: 'plan:test:0001',
  capability_revision: CONTROL_ACTION_MANIFEST_REVISION,
  allowed_origins: ['https://chatgpt.com'],
  deadline_ms: 5000,
  steps,
  ...overrides,
});

test('local plan executes sequential typed actions and verifies mutations', async () => {
  const executed = [];
  const executor = new BrowserPlanExecutor({
    getCurrentUrl: async () => 'https://chatgpt.com/c/abc',
    executeAction: async (command) => { executed.push(command.action); return { ok: true, tab_id: 'tab-1' }; },
    verifyAction: async (step) => ({ confirmed: true, action: step.action, authority_effect: false }),
  });
  const result = await executor.execute(plan([
    { id: 'read', action: 'CAPTURE', payload: { tab_id: 'tab-1' } },
    { id: 'click', action: 'TYPED_CLICK', platform: 'CHATGPT', payload: { tab_id: 'tab-1', role: 'button', accessible_name: 'Send' } },
  ]));
  assert.equal(result.state, 'COMPLETED');
  assert.equal(result.completed_steps, 2);
  assert.deepEqual(executed, ['CAPTURE', 'TYPED_CLICK']);
  assert.equal(result.results[1].verification.confirmed, true);
});

test('mutation with unproven postcondition becomes AMBIGUOUS and never auto-retries', async () => {
  const executor = new BrowserPlanExecutor({
    getCurrentUrl: async () => 'https://chatgpt.com/c/abc',
    executeAction: async () => ({ dispatched: true }),
    verifyAction: async () => ({ confirmed: false, no_effect_proven: false }),
  });
  const result = await executor.execute(plan([{ id: 'type', action: 'SEMANTIC_TYPE', payload: { tab_id: 'tab-1', text: 'hello' } }]));
  assert.equal(result.state, 'AMBIGUOUS');
  assert.equal(result.reason, 'POSTCONDITION_UNPROVEN');
  assert.equal(result.automatic_effect_retry_allowed, false);
});

test('origin mismatch and denied navigation target return NEEDS_REPLAN before mutation', async () => {
  let executed = 0;
  const mismatch = new BrowserPlanExecutor({
    getCurrentUrl: async () => 'https://example.com/',
    executeAction: async () => { executed += 1; return {}; },
    verifyAction: async () => ({ confirmed: true }),
  });
  const one = await mismatch.execute(plan([{ id: 'click', action: 'TYPED_CLICK', payload: { tab_id: 'tab-1' } }]));
  assert.equal(one.state, 'NEEDS_REPLAN');
  assert.equal(one.reason, 'ORIGIN_FENCE_MISMATCH');
  assert.equal(executed, 0);

  const navigation = new BrowserPlanExecutor({
    getCurrentUrl: async () => 'https://chatgpt.com/',
    executeAction: async () => { executed += 1; return {}; },
    verifyAction: async () => ({ confirmed: true }),
  });
  const two = await navigation.execute(plan([{ id: 'nav', action: 'NAVIGATE', payload: { tab_id: 'tab-1', url: 'https://evil.example/' } }]));
  assert.equal(two.state, 'NEEDS_REPLAN');
  assert.equal(two.reason, 'NAVIGATION_TARGET_ORIGIN_DENIED');
  assert.equal(executed, 0);
});

test('raw CDP, authority and stale capability revision are denied', async () => {
  const executor = new BrowserPlanExecutor({ getCurrentUrl: async () => 'https://chatgpt.com/', executeAction: async () => ({}), verifyAction: async () => ({ confirmed: true }) });
  await assert.rejects(() => executor.execute(plan([{ id: 'raw', action: 'RAW_CDP', payload: {} }])), /action_denied/);
  await assert.rejects(() => executor.execute(plan([{ id: 'arm', action: 'ARM', payload: {} }])), /action_denied/);
  await assert.rejects(() => executor.execute(plan([{ id: 'read', action: 'CAPTURE', payload: {} }], { capability_revision: `sha256:${'0'.repeat(64)}` })), /capability_revision_mismatch/);
});

test('cancel aborts an active plan and does not prove a mutation was cancelled', async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const executor = new BrowserPlanExecutor({
    getCurrentUrl: async () => 'https://chatgpt.com/c/abc',
    executeAction: async (_command, { signal }) => {
      await Promise.race([blocked, new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))]);
      return {};
    },
    verifyAction: async () => ({ confirmed: true }),
  });
  const running = executor.execute(plan([{ id: 'click', action: 'TYPED_CLICK', payload: { tab_id: 'tab-1' } }]));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(executor.cancel('plan:test:0001').cancelled, true);
  const result = await running;
  release();
  assert.equal(result.state, 'AMBIGUOUS');
  assert.equal(result.automatic_effect_retry_allowed, false);
});
