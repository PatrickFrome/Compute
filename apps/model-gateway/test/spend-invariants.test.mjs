import test from 'node:test';
import assert from 'node:assert/strict';
import { modelPlan } from '../lib/policy.mjs';
import { assertZeroSpend, resetCatalogCacheForTests } from '../lib/catalog.mjs';
import { logicalInventory } from '../lib/openai-compat.mjs';

test('free semantic role cannot be upgraded to paid by dual opt-in or preferred model', () => {
  const models = modelPlan('free', {
    paidOk: true,
    preferredModels: ['anthropic/claude-sonnet-5', 'google/gemini-3.7-flash'],
    env: { METAENGINE_ALLOW_PAID_MODELS: '1' }
  });
  assert.deepEqual(models, [
    'minimax/minimax-m3-free',
    'poolside/laguna-s-2.1-free',
    'inclusionai/ling-3.0-flash-fin-free'
  ]);
});

test('zero-spend authorization refreshes catalog on every inference decision by default', async () => {
  resetCatalogCacheForTests();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    const price = calls === 1 ? '0' : '0.000001';
    return new Response(JSON.stringify({
      data: [{
        id: 'minimax/minimax-m3-free',
        owned_by: 'minimax',
        zdr: 'none',
        no_training: 'none',
        pricing: { input: price, output: '0' }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  await assertZeroSpend(['minimax/minimax-m3-free'], { fetchImpl });
  await assert.rejects(
    assertZeroSpend(['minimax/minimax-m3-free'], { fetchImpl }),
    /free_model_not_zero_cost/
  );
  assert.equal(calls, 2);
});

test('logical free peers explicitly disclose external tariff and data-policy dependency', () => {
  const inventory = logicalInventory();
  assert.equal(inventory.data.length, 3);
  for (const model of inventory.data) {
    assert.equal(model.tariff_dependency, true);
    assert.equal(model.data_policy, 'PUBLIC_OR_NON_SENSITIVE_ONLY');
    assert.equal(model.confidential_data_supported, false);
    assert.equal(model.authority_effect, false);
  }
});
