import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_REASONING_POLICY, buildMaxReasoningDirective } from '../src/reasoning-policy.mjs';

test('max reasoning policy is explicit, strongest and non-authoritative', () => {
  assert.equal(MAX_REASONING_POLICY.schema, 'metaengine.reasoning-policy.v1');
  assert.equal(MAX_REASONING_POLICY.requested_level, 'MAX_AVAILABLE');
  assert.equal(MAX_REASONING_POLICY.openai_responses.reasoning_effort, 'max');
  assert.equal(MAX_REASONING_POLICY.openai_responses.reasoning_mode, 'pro');
  assert.equal(MAX_REASONING_POLICY.hidden_chain_of_thought_is_evidence, false);
  assert.equal(MAX_REASONING_POLICY.model_output_authority, false);
});

test('chat directive requests the highest available reasoning without inventing capability evidence', () => {
  const directive = buildMaxReasoningDirective({ role: 'critic' }).join('\n');
  assert.match(directive, /reasoning_policy=MAX_AVAILABLE/);
  assert.match(directive, /reasoning_role=CRITIC/);
  assert.match(directive, /reasoning_effort=max/);
  assert.match(directive, /reasoning_mode=pro/);
  assert.match(directive, /do not invent a capability receipt/i);
  assert.match(directive, /hidden chain-of-thought as authority or evidence/i);
});
