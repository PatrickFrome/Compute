import test from 'node:test';
import assert from 'node:assert/strict';
import { modelPlan } from '../lib/policy.mjs';

const FINAL_FREE_SHORTLIST = Object.freeze([
  'minimax/minimax-m3-free',
  'poolside/laguna-s-2.1-free',
  'inclusionai/ling-3.0-flash-fin-free'
]);

const REJECTED_DEFAULT_CANDIDATES = Object.freeze([
  'minimax/minimax-m2.7-free',
  'inclusionai/ling-3.0-tiny-free'
]);

test('final zero-spend shortlist stays exactly three provider-diverse models', () => {
  const plan = modelPlan('free');
  assert.deepEqual(plan, FINAL_FREE_SHORTLIST);
  assert.equal(plan.length, 3);
  assert.equal(new Set(plan.map((model) => model.split('/')[0])).size, 3);
  for (const rejected of REJECTED_DEFAULT_CANDIDATES) assert.equal(plan.includes(rejected), false);
});

test('all roles fail back to the same final shortlist when paid routing is not authorized', () => {
  for (const role of ['free', 'architecture', 'coding', 'critic', 'research']) {
    assert.deepEqual(modelPlan(role, { paidOk: false, env: {} }), FINAL_FREE_SHORTLIST);
  }
});

test('request preference cannot resurrect a rejected free candidate', () => {
  const plan = modelPlan('free', {
    paidOk: false,
    preferredModels: [...REJECTED_DEFAULT_CANDIDATES, FINAL_FREE_SHORTLIST[2]],
    env: {}
  });
  assert.deepEqual(plan, [FINAL_FREE_SHORTLIST[2], FINAL_FREE_SHORTLIST[0], FINAL_FREE_SHORTLIST[1]]);
});
