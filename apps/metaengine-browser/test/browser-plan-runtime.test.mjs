import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserPlanRuntime, normalizeBrowserPlan } from '../src/browser-plan-runtime.mjs';

const plan = (steps) => ({
  plan_id: 'plan-local-0001',
  tab_id: 'tab-1',
  generation: 7,
  steps,
});

test('BrowserPlan executes bounded local steps in order', async () => {
  const seen = [];
  const runtime = new BrowserPlanRuntime({
    getBinding: async () => ({ tab_id: 'tab-1', generation: 7 }),
    executeStep: async (step) => {
      seen.push(step.id);
      return { state: 'CONFIRMED', authority_effect: step.kind !== 'READ' };
    },
  });
  const result = await runtime.execute(plan([
    { id: 'read-1', kind: 'READ', payload: {} },
    { id: 'click-1', kind: 'CLICK', payload: { role: 'button', name: 'Send' } },
  ]));
  assert.deepEqual(seen, ['read-1', 'click-1']);
  assert.equal(result.state, 'CONFIRMED');
  assert.equal(result.completed_steps, 2);
  assert.equal(result.authority_effect, true);
  assert.equal(result.automatic_effect_retry_allowed, false);
});

test('BrowserPlan stops locally on NEEDS_REPLAN without executing later steps', async () => {
  const seen = [];
  const runtime = new BrowserPlanRuntime({
    getBinding: async () => ({ tab_id: 'tab-1', generation: 7 }),
    executeStep: async (step) => {
      seen.push(step.id);
      return step.id === 'click-1' ? { state: 'NEEDS_REPLAN', reason: 'TARGET_MISSING' } : { state: 'CONFIRMED' };
    },
  });
  const result = await runtime.execute(plan([
    { id: 'click-1', kind: 'CLICK', payload: {} },
    { id: 'type-1', kind: 'TYPE', payload: {} },
  ]));
  assert.deepEqual(seen, ['click-1']);
  assert.equal(result.state, 'NEEDS_REPLAN');
  assert.equal(result.completed_steps, 1);
});

test('BrowserPlan generation drift is ambiguous and prevents the next effect', async () => {
  let reads = 0;
  const runtime = new BrowserPlanRuntime({
    getBinding: async () => ({ tab_id: 'tab-1', generation: ++reads < 3 ? 7 : 8 }),
    executeStep: async () => ({ state: 'CONFIRMED', authority_effect: true }),
  });
  const result = await runtime.execute(plan([
    { id: 'click-1', kind: 'CLICK', payload: {} },
    { id: 'click-2', kind: 'CLICK', payload: {} },
  ]));
  assert.equal(result.state, 'AMBIGUOUS');
  assert.equal(result.reason, 'BINDING_CHANGED');
  assert.equal(result.completed_steps, 1);
});

test('BrowserPlan rejects raw/unbounded primitives', () => {
  assert.throws(() => normalizeBrowserPlan(plan([{ id: 'x', kind: 'EVAL', payload: { code: '1+1' } }])), /step_kind_invalid/);
  assert.throws(() => normalizeBrowserPlan({ ...plan([{ id: 'x', kind: 'READ', payload: {} }]), arbitrary_eval: true }), /field_unknown/);
});
