import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRetryDecision, REQUEST_EFFECT_CLASS } from '../src/chatgpt-retry-policy.mjs';

test('read-only silent request first stops and retries in the same conversation', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.READ_ONLY,
    silence_age_ms: 91_000,
    request_accepted: true,
    retry_attempt: 0,
  });
  assert.equal(result.action, 'STOP_AND_RETRY_SAME_CONVERSATION');
  assert.equal(result.retry_allowed, true);
});

test('adaptive timeout can safely extend a long-running request beyond fixed defaults', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.READ_ONLY,
    silence_age_ms: 2 * 60_000,
    adaptive_timeout_ms: 5 * 60_000,
    request_accepted: true,
  });
  assert.equal(result.action, 'WAIT');
});

test('adaptive timeout becomes the retry boundary once reached', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.IDEMPOTENT_WRITE,
    silence_age_ms: 5 * 60_000,
    adaptive_timeout_ms: 4 * 60_000,
    request_accepted: true,
  });
  assert.equal(result.action, 'STOP_AND_RETRY_SAME_CONVERSATION');
});

test('same-chat retry falls back to a new conversation after its local budget is exhausted', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.READ_ONLY,
    silence_age_ms: 91_000,
    request_accepted: true,
    retry_attempt: 1,
    same_chat_retry_attempt: 1,
    max_same_chat_retry_attempts: 1,
  });
  assert.equal(result.action, 'NEW_CONVERSATION_RETRY');
  assert.equal(result.retry_allowed, true);
});

test('unusable conversation goes directly to a new conversation', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.READ_ONLY,
    silence_age_ms: 91_000,
    same_conversation_usable: false,
  });
  assert.equal(result.action, 'NEW_CONVERSATION_RETRY');
});

test('database or durable external progress suppresses retry regardless of visual silence', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.READ_ONLY,
    silence_age_ms: 45 * 60_000,
    external_progress: true,
  });
  assert.deepEqual(result, { action: 'WAIT', reason: 'POSITIVE_LIVENESS_EVIDENCE', retry_allowed: false, authority_effect: false });
});

test('network liveness suppresses retry independently of DOM silence', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.READ_ONLY,
    silence_age_ms: 45 * 60_000,
    network_active: true,
  });
  assert.equal(result.action, 'WAIT');
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

test('effectful request retries in the same conversation once NO_EFFECT is proven', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.EFFECTFUL,
    silence_age_ms: 5 * 60_000,
    effect_check: 'NO_EFFECT',
  });
  assert.equal(result.action, 'STOP_AND_RETRY_SAME_CONVERSATION');
  assert.equal(result.retry_allowed, true);
});

test('observed commit/effect forbids replay even when chat request fails', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.EFFECTFUL,
    terminal_failure: 'REQUEST_FAILED',
    effect_check: 'COMMITTED',
  });
  assert.equal(result.action, 'WAIT_FOR_RESULT_RECONCILIATION');
  assert.equal(result.retry_allowed, false);
});

test('hard conversation failure uses a new conversation rather than same-chat replay', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.READ_ONLY,
    terminal_failure: 'RENDERER_GONE',
  });
  assert.equal(result.action, 'NEW_CONVERSATION_RETRY');
});

test('soft server error prefers same-chat replay', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.READ_ONLY,
    terminal_failure: 'SERVER_ERROR',
  });
  assert.equal(result.action, 'STOP_AND_RETRY_SAME_CONVERSATION');
});

test('explicit Continue generating is preferred to replay', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.READ_ONLY,
    silence_age_ms: 20 * 60_000,
    explicit_continue: true,
  });
  assert.equal(result.action, 'CONTINUE_EXISTING');
});

test('bounded total retry budget prevents loops', () => {
  const result = classifyRetryDecision({
    effect_class: REQUEST_EFFECT_CLASS.READ_ONLY,
    silence_age_ms: 20 * 60_000,
    retry_attempt: 2,
    max_retry_attempts: 2,
  });
  assert.equal(result.action, 'ESCALATE');
});
