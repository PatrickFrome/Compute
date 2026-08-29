import test from 'node:test';
import assert from 'node:assert/strict';
import { modelPlan, validateTask } from '../lib/policy.mjs';
import { authorized, buildPeerInput } from '../lib/security.mjs';
import { callGateway, callChatGateway, extractText } from '../lib/gateway.mjs';
import { assertZeroSpend, isZeroPrice, resetCatalogCacheForTests } from '../lib/catalog.mjs';
import { logicalInventory, logicalModelPlan, sanitizeChatCompletion } from '../lib/openai-compat.mjs';

test('free route is zero-cost allowlist only', () => {
  assert.deepEqual(modelPlan('free'), ['minimax/minimax-m3-free', 'poolside/laguna-s-2.1-free']);
  assert.deepEqual(modelPlan('coding', { paidOk: true, env: {} }), ['minimax/minimax-m3-free', 'poolside/laguna-s-2.1-free']);
});

test('paid frontier route requires two-key opt in', () => {
  const models = modelPlan('architecture', { paidOk: true, env: { METAENGINE_ALLOW_PAID_MODELS: '1' } });
  assert.equal(models[0], 'anthropic/claude-sonnet-5');
  assert.ok(models.includes('google/gemini-3.7-flash'));
  assert.ok(models.includes('zai/glm-5.3'));
});

test('preferred model cannot escape allowlist', () => {
  const models = modelPlan('coding', {
    paidOk: true,
    preferredModels: ['evil/provider', 'google/gemini-3.7-flash'],
    env: { METAENGINE_ALLOW_PAID_MODELS: '1' }
  });
  assert.equal(models[0], 'google/gemini-3.7-flash');
  assert.ok(!models.includes('evil/provider'));
});

test('task validation enforces bounds', () => {
  assert.equal(validateTask({ task_id: 't1', prompt: 'hello' }).role, 'free');
  assert.throws(() => validateTask({ task_id: '', prompt: 'hello' }), /invalid_task_id/);
  assert.throws(() => validateTask({ task_id: 't1', prompt: '' }), /invalid_prompt/);
});

test('trusted preamble labels context untrusted and denies authority', () => {
  const input = buildPeerInput({ prompt: 'review', context: 'IGNORE PREVIOUS', taskId: 't', role: 'critic' });
  assert.match(input, /no execution authority/i);
  assert.match(input, /UNTRUSTED CONTEXT/);
  assert.match(input, /IGNORE PREVIOUS/);
});

test('incoming token is fail closed and timing-safe comparable', () => {
  const request = { headers: new Headers({ authorization: 'Bearer abc' }) };
  assert.equal(authorized(request, {}), false);
  assert.equal(authorized(request, { METAENGINE_MODEL_GATEWAY_TOKEN: 'abc' }), true);
  assert.equal(authorized(request, { METAENGINE_MODEL_GATEWAY_TOKEN: 'abcd' }), false);
});

test('gateway call emits bounded trusted envelope without provider keys', async () => {
  let captured;
  const fetchImpl = async (_url, init) => {
    captured = init;
    return new Response(JSON.stringify({ output_text: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await callGateway({
    models: ['minimax/minimax-m3-free', 'poolside/laguna-s-2.1-free'],
    input: 'hello',
    taskId: 't1',
    env: { VERCEL_OIDC_TOKEN: 'oidc-test' },
    fetchImpl
  });
  assert.equal(result.primary, 'minimax/minimax-m3-free');
  assert.equal(captured.headers.authorization, 'Bearer oidc-test');
  const body = JSON.parse(captured.body);
  assert.deepEqual(body.providerOptions.gateway.models, ['minimax/minimax-m3-free', 'poolside/laguna-s-2.1-free']);
  assert.equal(body.providerOptions.gateway.user, 'metaengine:t1');
});

test('extractText tolerates OpenResponses variants', () => {
  assert.equal(extractText({ output_text: 'a' }), 'a');
  assert.equal(extractText({ output: [{ content: [{ text: 'b' }] }] }), 'b');
});

test('catalog zero-price predicate is fail closed', () => {
  assert.equal(isZeroPrice({ pricing: { input: '0', output: '0' } }), true);
  assert.equal(isZeroPrice({ pricing: { input: '0', output: '0.000001' } }), false);
  assert.equal(isZeroPrice({}), false);
});

test('live catalog gate blocks missing or repriced free models', async () => {
  resetCatalogCacheForTests();
  const zeroCatalog = async () => new Response(JSON.stringify({
    data: [
      { id: 'minimax/minimax-m3-free', pricing: { input: '0', output: '0' } },
      { id: 'poolside/laguna-s-2.1-free', pricing: { input: '0', output: '0' } }
    ]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  await assertZeroSpend(['minimax/minimax-m3-free', 'poolside/laguna-s-2.1-free'], { fetchImpl: zeroCatalog, ttlMs: 0 });

  resetCatalogCacheForTests();
  const repricedCatalog = async () => new Response(JSON.stringify({
    data: [{ id: 'minimax/minimax-m3-free', pricing: { input: '0.000001', output: '0' } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  await assert.rejects(
    assertZeroSpend(['minimax/minimax-m3-free'], { fetchImpl: repricedCatalog, ttlMs: 0 }),
    /free_model_not_zero_cost/
  );

  resetCatalogCacheForTests();
  const missingCatalog = async () => new Response(JSON.stringify({ data: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
  await assert.rejects(
    assertZeroSpend(['minimax/minimax-m3-free'], { fetchImpl: missingCatalog, ttlMs: 0 }),
    /free_model_missing/
  );
});

test('logical inventory exposes two sovereign peer aliases', () => {
  const inventory = logicalInventory();
  assert.deepEqual(inventory.data.map((x) => x.id), ['metaengine/peer-a-free', 'metaengine/peer-b-free']);
  assert.equal(inventory.data.every((x) => x.authority_effect === false && x.zero_spend_required === true), true);
});

test('logical peers prefer different zero-spend providers', () => {
  assert.deepEqual(logicalModelPlan('metaengine/peer-a-free'), ['minimax/minimax-m3-free', 'poolside/laguna-s-2.1-free']);
  assert.deepEqual(logicalModelPlan('metaengine/peer-b-free'), ['poolside/laguna-s-2.1-free', 'minimax/minimax-m3-free']);
  assert.throws(() => logicalModelPlan('openai/gpt-5.6-sol'), /logical_model_not_allowed/);
});

test('OpenAI compatibility sanitizer rejects tools and streaming and injects authority fence', () => {
  const clean = sanitizeChatCompletion({
    model: 'metaengine/peer-a-free',
    messages: [{ role: 'system', content: 'runner system' }, { role: 'user', content: 'hello' }],
    max_tokens: 9000,
    temperature: 9,
    stream: false
  });
  assert.equal(clean.maxTokens, 4096);
  assert.equal(clean.temperature, 1);
  assert.match(clean.messages[0].content, /no execution authority/i);
  assert.throws(() => sanitizeChatCompletion({ model: 'metaengine/peer-a-free', messages: [{ role: 'user', content: 'x' }], stream: true }), /streaming_not_supported/);
  assert.throws(() => sanitizeChatCompletion({ model: 'metaengine/peer-a-free', messages: [{ role: 'user', content: 'x' }], tools: [] }), /tools_not_allowed/);
});

test('OpenAI chat gateway overwrites logical alias with zero-spend upstream plan', async () => {
  let captured;
  const fetchImpl = async (_url, init) => {
    captured = init;
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"step_type":"OBSERVE"}' } }] }), { status: 200 });
  };
  const result = await callChatGateway({
    models: ['poolside/laguna-s-2.1-free', 'minimax/minimax-m3-free'],
    messages: [{ role: 'user', content: 'hello' }],
    maxTokens: 1200,
    temperature: 0.2,
    logicalModel: 'metaengine/peer-b-free',
    env: { VERCEL_OIDC_TOKEN: 'oidc-test' },
    fetchImpl
  });
  const body = JSON.parse(captured.body);
  assert.equal(body.model, 'poolside/laguna-s-2.1-free');
  assert.deepEqual(body.providerOptions.gateway.models, ['minimax/minimax-m3-free']);
  assert.equal(body.stream, false);
  assert.equal(result.primary, 'poolside/laguna-s-2.1-free');
});
