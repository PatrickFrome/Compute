import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRetryDecision, REQUEST_EFFECT_CLASS } from '../src/chatgpt-retry-policy.mjs';

test('read-only silent request retries aggressively after 90s when all liveness channels are quiet', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.READ_ONLY,
    silence_age_ms: 91_000,
    request_accepted: true,
    retry_attempt: 0,
  });
  assert.equal(result.action, 'NEW_CONVERSATION_RETRY');
  assert.equal(result.retry_allowed, true);
});

test('database or durable external progress suppresses retry regardless of visual silence', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.READ_ONLY,
    silence_age_ms: 45 * 60_000,
    external_progress: true,
  });
  assert.deepEqual(result, { action: 'WAIT', reason: 'POSITIVE_LIVENESS_EVIDENCE', retry_allowed: false, authority_effect: false });
});

test('completed execution waits for delayed ChatGPT rendering instead of replaying', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.EFFECTFUL,
    silence_age_ms: 45 * 60_000,
    external_completed: true,
  });
  assert.equal(result.action, 'WAIT_FOR_RENDER');
  assert.equal(result.retry_allowed, false);
});

test('effectful ambiguous silence asks for effect check before retry', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.EFFECTFUL,
    silence_age_ms: 5 * 60_000,
    effect_check: 'UNKNOWN',
  });
  assert.equal(result.action, 'CHECK_EFFECT');
  assert.equal(result.retry_allowed, false);
});

test('effectful request can retry quickly once NO_EFFECT is proven', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.EFFECTFUL,
    silence_age_ms: 5 * 60_000,
    effect_check: 'NO_EFFECT',
  });
  assert.equal(result.action, 'NEW_CONVERSATION_RETRY');
  assert.equal(result.retry_allowed, true);
});

test('observed commit/effect forbids replay even when chat is dead', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.EFFECTFUL,
    terminal_failure: 'RENDERER_GONE',
    effect_check: 'COMMITTED',
  });
  assert.equal(result.action, 'WAIT_FOR_RESULT_RECONCILIATION');
  assert.equal(result.retry_allowed, false);
});

test('explicit Continue generating is preferred to replay', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.READ_ONLY,
    silence_age_ms: 20 * 60_000,
    explicit_continue: true,
  });
  assert.equal(result.action, 'CONTINUE_EXISTING');
});

test('bounded retry budget prevents loops', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.READ_ONLY,
    silence_age_ms: 20 * 60_000,
    retry_attempt: 2,
    max_retry_attempts: 2,
  });
  assert.equal(result.action, 'ESCALATE');
});
