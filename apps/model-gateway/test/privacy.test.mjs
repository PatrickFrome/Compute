import test from 'node:test';
import assert from 'node:assert/strict';
import { assertZeroSpend, isZeroPrice, privacySnapshot, resetCatalogCacheForTests } from '../lib/catalog.mjs';
import { assertNoSecretLikeMaterial, buildPeerInput } from '../lib/security.mjs';
import { sanitizeChatCompletion } from '../lib/openai-compat.mjs';

test('zero-price gate checks published tiers and provider variance, not only headline prices', () => {
  assert.equal(isZeroPrice({ pricing: { input: '0', output: '0' } }), true);
  assert.equal(isZeroPrice({
    pricing: {
      input: '0',
      output: '0',
      output_tiers: [{ min: 0, max: 1000, cost: '0' }, { min: 1000, cost: '0.000001' }]
    }
  }), false);
  assert.equal(isZeroPrice({ pricing: { input: '0', output: '0', varies_by_provider: true } }), false);
});

test('zero-spend evidence preserves live privacy metadata without claiming confidentiality', async () => {
  resetCatalogCacheForTests();
  const fetchImpl = async () => new Response(JSON.stringify({
    data: [
      {
        id: 'minimax/minimax-m3-free',
        owned_by: 'minimax',
        zdr: 'none',
        no_training: 'none',
        pricing: {
          input: '0',
          input_tiers: [{ min: 0, max: 512000, cost: '0' }, { min: 512000, cost: '0' }],
          output: '0',
          output_tiers: [{ min: 0, max: 512000, cost: '0' }, { min: 512000, cost: '0' }]
        }
      },
      {
        id: 'inclusionai/ling-3.0-flash-fin-free',
        owned_by: 'inclusionai',
        zdr: 'none',
        no_training: 'all',
        pricing: { input: '0', output: '0' }
      }
    ]
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  const evidence = await assertZeroSpend([
    'minimax/minimax-m3-free',
    'inclusionai/ling-3.0-flash-fin-free'
  ], { fetchImpl, ttlMs: 0 });

  assert.equal(evidence.models.length, 2);
  assert.equal(evidence.models[0].zero_price, true);
  assert.equal(evidence.models[0].zdr, 'none');
  assert.equal(evidence.models[1].no_training, 'all');
  assert.equal(evidence.privacy.all_zdr, false);
  assert.equal(evidence.privacy.all_no_training, false);
  assert.equal(evidence.privacy.classification, 'EXTERNAL_NON_ZDR_OR_TRAINING_UNCERTAIN');
});

test('privacy snapshot is fail explicit when catalog metadata is absent', () => {
  assert.deepEqual(privacySnapshot({ id: 'p/free', pricing: { input: '0', output: '0' } }), {
    model: 'p/free',
    owned_by: null,
    zdr: 'unknown',
    no_training: 'unknown',
    zero_price: true
  });
});

test('high-confidence secret-like material is blocked without echoing the value', () => {
  const fakePat = `ghp_${'A'.repeat(36)}`;
  let error;
  try {
    assertNoSecretLikeMaterial(`token=${fakePat}`);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof Error);
  assert.equal(error.message, 'secret_like_material_blocked:github_token');
  assert.equal(error.message.includes(fakePat), false);
  assert.equal(assertNoSecretLikeMaterial('ordinary source code and public documentation'), true);
});

test('peer input refuses secret-like prompt or context before external inference', () => {
  const fakeAws = `AKIA${'A'.repeat(16)}`;
  assert.throws(() => buildPeerInput({
    prompt: 'review this',
    context: `credential ${fakeAws}`,
    taskId: 't',
    role: 'critic'
  }), /secret_like_material_blocked:aws_access_key_id/);
});

test('OpenAI-compatible facade blocks secret-like message content', () => {
  const fakeSecret = `sk-${'x'.repeat(30)}`;
  assert.throws(() => sanitizeChatCompletion({
    model: 'metaengine/peer-a-free',
    messages: [{ role: 'user', content: `please inspect ${fakeSecret}` }]
  }), /secret_like_material_blocked:openai_style_secret/);
});
