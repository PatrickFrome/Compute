import assert from 'node:assert/strict';
import test from 'node:test';
import { OPENAI_MAX_REASONING_POLICY, assertMaxReasoningModel, openAIMaxReasoningConfig } from '../src/reasoning-policy.mjs';

test('GPT-5.6 family receives max effort and pro mode', () => {
  assert.deepEqual(openAIMaxReasoningConfig('gpt-5.6'), { effort: 'max', mode: 'pro' });
  assert.deepEqual(openAIMaxReasoningConfig('gpt-5.6-sol'), { effort: 'max', mode: 'pro' });
  assert.equal(OPENAI_MAX_REASONING_POLICY.requested_level, 'MAX_AVAILABLE');
  assert.equal(OPENAI_MAX_REASONING_POLICY.hidden_chain_of_thought_is_evidence, false);
  assert.equal(OPENAI_MAX_REASONING_POLICY.authority_effect, false);
});

test('older or unknown model families fail closed instead of silently lowering reasoning', () => {
  assert.throws(() => assertMaxReasoningModel('gpt-5.5'), /openai_model_max_reasoning_unverified/);
  assert.throws(() => assertMaxReasoningModel('gpt-4.1'), /openai_model_max_reasoning_unverified/);
  assert.throws(() => assertMaxReasoningModel(''), /openai_model_max_reasoning_unverified/);
});
