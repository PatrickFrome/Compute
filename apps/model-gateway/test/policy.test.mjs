import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, modelPlan, validateTask } from '../lib/policy.mjs';
import { authorized, buildPeerInput } from '../lib/security.mjs';
import { assertServedModel, callGateway, callChatGateway, extractText } from '../lib/gateway.mjs';
import {
  assertPaidBudget,
  assertZeroSpend,
  conservativeModelCostUsd,
  isZeroPrice,
  paidBudgetCapUsd,
  resetCatalogCacheForTests
} from '../lib/catalog.mjs';
import { logicalInventory, logicalModelPlan, sanitizeChatCompletion } from '../lib/openai-compat.mjs';

test('free route is zero-cost allowlist only', () => {
  assert.deepEqual(modelPlan('free'), ['minimax/minimax-m3-free', 'poolside/laguna-s-2.1-free', 'inclusionai/ling-3.0-flash-fin-free']);
  assert.deepEqual(modelPlan('coding', { paidOk: true, env: {} }), ['minimax/minimax-m3-free', 'poolside/laguna-s-2.1-free', 'inclusionai/ling-3.0-flash-fin-free']);
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

test('task validation enforces bounds including peer output', () => {
  assert.equal(validateTask({ task_id: 't1', prompt: 'hello' }).role, 'free');
  assert.equal(validateTask({ task_id: 't1', prompt: 'hello' }).maxOutputTokens, LIMITS.defaultPeerOutputTokens);
  assert.equal(validateTask({ task_id: 't1', prompt: 'hello', max_output_tokens: 4096 }).maxOutputTokens, 4096);
  assert.throws(() => validateTask({ task_id: '', prompt: 'hello' }), /invalid_task_id/);
  assert.throws(() => validateTask({ task_id: 't1', prompt: '' }), /invalid_prompt/);
  assert.throws(() => validateTask({ task_id: 't1', prompt: 'hello', max_output_tokens: 4097 }), /invalid_max_output_tokens/);
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

test('gateway call emits only fallback models and records actual served model', async () => {
  let captured;
  const fetchImpl = async (_url, init) => {
    captured = init;
    return new Response(JSON.stringify({
      model: 'inclusionai/ling-3.0-flash-fin-free',
      output_text: 'ok'
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await callGateway({
    models: ['minimax/minimax-m3-free', 'poolside/laguna-s-2.1-free', 'inclusionai/ling-3.0-flash-fin-free'],
    input: 'hello',
    taskId: 't1',
    maxOutputTokens: 777,
    env: { VERCEL_OIDC_TOKEN: 'oidc-test' },
    fetchImpl
  });
  assert.equal(result.primary, 'minimax/minimax-m3-free');
  assert.equal(result.servedModel, 'inclusionai/ling-3.0-flash-fin-free');
  assert.equal(captured.headers.authorization, 'Bearer oidc-test');
  const body = JSON.parse(captured.body);
  assert.equal(body.model, 'minimax/minimax-m3-free');
  assert.deepEqual(body.providerOptions.gateway.models, ['poolside/laguna-s-2.1-free', 'inclusionai/ling-3.0-flash-fin-free']);
  assert.equal(body.providerOptions.gateway.user, 'metaengine:t1');
  assert.equal(body.max_output_tokens, 777);
});

test('served-model provenance is fail closed', () => {
  const approved = ['minimax/minimax-m3-free', 'poolside/laguna-s-2.1-free'];
  assert.equal(assertServedModel({ model: approved[1] }, approved), approved[1]);
  assert.throws(() => assertServedModel({}, approved), /gateway_served_model_missing/);
  assert.throws(() => assertServedModel({ model: 'evil/provider' }, approved), /gateway_served_model_unapproved/);
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
      { id: 'poolside/laguna-s-2.1-free', pricing: { input: '0', output: '0' } },
      { id: 'inclusionai/ling-3.0-flash-fin-free', pricing: { input: '0', output: '0' } }
    ]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  await assertZeroSpend(['minimax/minimax-m3-free', 'poolside/laguna-s-2.1-free', 'inclusionai/ling-3.0-flash-fin-free'], { fetchImpl: zeroCatalog, ttlMs: 0 });

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

test('paid budget cap cannot be raised above compile-time hard maximum', () => {
  assert.equal(paidBudgetCapUsd({}), LIMITS.hardMaxPaidRequestUsd);
  assert.equal(paidBudgetCapUsd({ METAENGINE_MAX_PAID_REQUEST_USD: '0' }), 0);
  assert.equal(paidBudgetCapUsd({ METAENGINE_MAX_PAID_REQUEST_USD: '0.12' }), 0.12);
  assert.equal(paidBudgetCapUsd({ METAENGINE_MAX_PAID_REQUEST_USD: '999' }), LIMITS.hardMaxPaidRequestUsd);
});

test('paid cost estimate uses expensive tiers and peak multiplier conservatively', () => {
  const model = {
    id: 'provider/model',
    pricing: {
      input: '0.000001',
      output: '0.000002',
      input_tiers: [{ min: 0, max: 10, cost: '0.000003' }],
      regional: { output_tiers: [{ min: 0, cost: '0.000004' }] },
      peak_pricing: { multiplier: '2' }
    }
  };
  const estimate = conservativeModelCostUsd(model, { input: 'abcd', maxOutputTokens: 10 });
  assert.equal(estimate, (4 * 0.000003 + 10 * 0.000004) * 2);
});

test('paid route passes only when every fallback fits summed worst-case budget', async () => {
  resetCatalogCacheForTests();
  const cheapCatalog = async () => new Response(JSON.stringify({
    data: [
      { id: 'p/a', pricing: { input: '0.000001', output: '0.000002' } },
      { id: 'p/b', pricing: { input: '0.000001', output: '0.000002' } }
    ]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const budget = await assertPaidBudget(['p/a', 'p/b'], {
    input: 'hello',
    maxOutputTokens: 100,
    env: { METAENGINE_MAX_PAID_REQUEST_USD: '0.01' },
    fetchImpl: cheapCatalog,
    ttlMs: 0
  });
  assert.equal(budget.cap_usd, 0.01);
  assert.ok(budget.worst_case_usd > 0 && budget.worst_case_usd < budget.cap_usd);
  assert.equal(budget.models.length, 2);
});

test('paid route fails closed when live pricing exceeds budget', async () => {
  resetCatalogCacheForTests();
  const expensiveCatalog = async () => new Response(JSON.stringify({
    data: [{ id: 'p/a', pricing: { input: '0.01', output: '0.01' } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  await assert.rejects(
    assertPaidBudget(['p/a'], {
      input: 'hello',
      maxOutputTokens: 100,
      env: { METAENGINE_MAX_PAID_REQUEST_USD: '0.10' },
      fetchImpl: expensiveCatalog,
      ttlMs: 0
    }),
    /paid_budget_exceeded/
  );
});

test('logical inventory exposes three sovereign peer aliases', () => {
  const inventory = logicalInventory();
  assert.deepEqual(inventory.data.map((x) => x.id), ['metaengine/peer-a-free', 'metaengine/peer-b-free', 'metaengine/peer-c-free']);
  assert.equal(inventory.data.every((x) => x.authority_effect === false && x.zero_spend_required === true), true);
});

test('logical peers prefer different zero-spend providers', () => {
  assert.deepEqual(logicalModelPlan('metaengine/peer-a-free'), ['minimax/minimax-m3-free', 'poolside/laguna-s-2.1-free', 'inclusionai/ling-3.0-flash-fin-free']);
  assert.deepEqual(logicalModelPlan('metaengine/peer-b-free'), ['poolside/laguna-s-2.1-free', 'minimax/minimax-m3-free', 'inclusionai/ling-3.0-flash-fin-free']);
  assert.deepEqual(logicalModelPlan('metaengine/peer-c-free'), ['inclusionai/ling-3.0-flash-fin-free', 'minimax/minimax-m3-free', 'poolside/laguna-s-2.1-free']);
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
    return new Response(JSON.stringify({
      model: 'minimax/minimax-m3-free',
      choices: [{ message: { role: 'assistant', content: '{"step_type":"OBSERVE"}' } }]
    }), { status: 200 });
  };
  const result = await callChatGateway({
    models: ['poolside/laguna-s-2.1-free', 'minimax/minimax-m3-free', 'inclusionai/ling-3.0-flash-fin-free'],
    messages: [{ role: 'user', content: 'hello' }],
    maxTokens: 1200,
    temperature: 0.2,
    logicalModel: 'metaengine/peer-b-free',
    env: { VERCEL_OIDC_TOKEN: 'oidc-test' },
    fetchImpl
  });
  const body = JSON.parse(captured.body);
  assert.equal(body.model, 'poolside/laguna-s-2.1-free');
  assert.deepEqual(body.providerOptions.gateway.models, ['minimax/minimax-m3-free', 'inclusionai/ling-3.0-flash-fin-free']);
  assert.equal(body.stream, false);
  assert.equal(result.primary, 'poolside/laguna-s-2.1-free');
  assert.equal(result.servedModel, 'minimax/minimax-m3-free');
});
