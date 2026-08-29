import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCommitteePlan, runCommittee } from '../lib/committee.mjs';

const MODELS = [
  'minimax/minimax-m3-free',
  'poolside/laguna-s-2.1-free',
  'inclusionai/ling-3.0-flash-fin-free'
];

function payload(model, text = `answer:${model}`) {
  return { model, output_text: text };
}

test('committee requires exactly three unique provider families', () => {
  assert.deepEqual(assertCommitteePlan(MODELS).providers, ['minimax', 'poolside', 'inclusionai']);
  assert.throws(() => assertCommitteePlan(MODELS.slice(0, 2)), /exactly_three/);
  assert.throws(() => assertCommitteePlan([MODELS[0], MODELS[0], MODELS[2]]), /models_must_be_unique/);
  assert.throws(() => assertCommitteePlan([
    'minimax/minimax-m3-free',
    'minimax/minimax-m2.7-free',
    'inclusionai/ling-3.0-flash-fin-free'
  ]), /three_provider_families/);
});

test('committee fans out concurrently and accepts exactly two of three successful peers', async () => {
  let active = 0;
  let maxActive = 0;
  const callModel = async ({ models }) => {
    const model = models[0];
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
    if (model.startsWith('poolside/')) {
      const error = new Error('gateway_http_403');
      error.status = 403;
      throw error;
    }
    return { payload: payload(model), servedModel: model, primary: model, fallbacks: [] };
  };

  const receipt = await runCommittee({
    models: MODELS,
    input: 'public test input',
    taskId: 'committee-test',
    maxOutputTokens: 128,
    callModel,
    now: () => '2026-08-29T04:50:00.000Z'
  });

  assert.equal(maxActive, 3);
  assert.equal(receipt.successful_members, 2);
  assert.equal(receipt.quorum_required, 2);
  assert.equal(receipt.quorum_met, true);
  assert.equal(receipt.committee_status, 'QUORUM_MET');
  assert.equal(receipt.synthesis_performed, false);
  assert.equal(receipt.synthesis, null);
  assert.equal(receipt.authority_effect, false);
  assert.equal(receipt.members.filter((member) => member.status === 'SUCCESS').length, 2);
  assert.equal(receipt.members.find((member) => member.provider_family === 'poolside').upstream_status, 403);
});

test('served model mismatch fails that member instead of laundering provenance', async () => {
  const callModel = async ({ models }) => {
    const requested = models[0];
    if (requested.startsWith('minimax/')) {
      return {
        payload: payload('unknown/other-model'),
        servedModel: 'unknown/other-model',
        primary: requested,
        fallbacks: []
      };
    }
    return { payload: payload(requested), servedModel: requested, primary: requested, fallbacks: [] };
  };

  const receipt = await runCommittee({
    models: MODELS,
    input: 'public test input',
    taskId: 'committee-provenance',
    maxOutputTokens: 128,
    callModel
  });

  const minimax = receipt.members.find((member) => member.provider_family === 'minimax');
  assert.equal(minimax.status, 'FAILED');
  assert.match(minimax.error, /served_model_mismatch/);
  assert.equal(receipt.quorum_met, true);
});

test('committee fails quorum when fewer than two members return usable answers', async () => {
  const callModel = async ({ models }) => {
    const model = models[0];
    if (model.startsWith('inclusionai/')) {
      return { payload: payload(model), servedModel: model, primary: model, fallbacks: [] };
    }
    const error = new Error('gateway_http_403');
    error.status = 403;
    throw error;
  };

  const receipt = await runCommittee({
    models: MODELS,
    input: 'public test input',
    taskId: 'committee-failed-quorum',
    maxOutputTokens: 128,
    callModel
  });

  assert.equal(receipt.successful_members, 1);
  assert.equal(receipt.quorum_met, false);
  assert.equal(receipt.committee_status, 'QUORUM_FAILED');
  assert.equal(receipt.authority_effect, false);
});
