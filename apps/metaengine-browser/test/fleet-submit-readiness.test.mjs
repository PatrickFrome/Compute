import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFleetSubmitReadiness } from '../src/fleet-submit-readiness.mjs';

const tab = 'tab_11111111-2222-3333-4444-555555555555';
const target = 'webcontents:77';

function frame(overrides = {}) {
  return {
    viewport: { width: 1200, height: 600 },
    semantic_targets: [
      { role: 'textbox', name: 'Чат с ChatGPT', backend_node_id: 4 },
      { role: 'button', name: 'Отправить промпт', backend_node_id: 5 },
    ],
    ...overrides,
  };
}

function readiness(overrides = {}) {
  return evaluateFleetSubmitReadiness({
    frame: frame(),
    expected_tab_id: tab,
    observed_tab_id: tab,
    selected_tab_id: tab,
    expected_target_id: target,
    observed_target_id: target,
    ...overrides,
  });
}

test('exact foreground nonzero viewport is ready only for two-phase typed send', () => {
  const result = readiness();
  assert.equal(result.ready, true);
  assert.equal(result.reason, 'READY_FOR_TWO_PHASE_SEND');
  assert.equal(result.submit_strategy, 'TYPE_WITHOUT_SUBMIT_THEN_TYPED_CLICK_SEND');
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.page_data_authority, false);
  assert.equal(result.authority_effect, false);
});

test('background or zero viewport fails before any send effect', () => {
  assert.deepEqual(
    readiness({ selected_tab_id: 'tab_other' }),
    { ready: false, reason: 'TAB_NOT_FOREGROUND_EXACT', authority_effect: false },
  );
  assert.deepEqual(
    readiness({ frame: frame({ viewport: { width: 0, height: 0 } }) }),
    { ready: false, reason: 'VIEWPORT_NOT_RENDERABLE', authority_effect: false },
  );
});

test('replacement target incarnation fails closed', () => {
  assert.deepEqual(
    readiness({ observed_target_id: 'webcontents:88' }),
    { ready: false, reason: 'TARGET_INCARNATION_MISMATCH', authority_effect: false },
  );
});

test('generation already active or ambiguous controls fail closed', () => {
  assert.deepEqual(
    readiness({ frame: frame({ semantic_targets: [
      { role: 'textbox', name: 'Чат с ChatGPT', backend_node_id: 4 },
      { role: 'button', name: 'Остановить ответ', backend_node_id: 6 },
    ] }) }),
    { ready: false, reason: 'GENERATION_ALREADY_ACTIVE', authority_effect: false },
  );
  assert.deepEqual(
    readiness({ frame: frame({ semantic_targets: [
      { role: 'textbox', name: 'Чат с ChatGPT', backend_node_id: 4 },
      { role: 'button', name: 'Отправить промпт', backend_node_id: 5 },
      { role: 'button', name: 'Отправить промпт', backend_node_id: 7 },
    ] }) }),
    { ready: false, reason: 'SEND_CONTROL_NOT_UNIQUE', authority_effect: false },
  );
});
