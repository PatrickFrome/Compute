import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFleetSubmitReadiness } from '../src/fleet-submit-readiness.mjs';

const exact = Object.freeze({
  expected_tab_id: 'tab_fleet_test',
  observed_tab_id: 'tab_fleet_test',
  expected_target_id: 'webcontents:17',
  observed_target_id: 'webcontents:17',
  selected_tab_id: 'tab_fleet_test',
});

const root = Object.freeze({
  tab_id: 'tab_fleet_test',
  target_id: 'webcontents:17',
  viewport: { width: 1200, height: 700 },
  semantic_targets: [{ role: 'textbox', name: 'Message ChatGPT' }],
});

test('PRE_TYPE does not require Send before text exists', () => {
  const pre = evaluateFleetSubmitReadiness({ ...exact, frame: root, phase: 'PRE_TYPE' });
  assert.equal(pre.ready, true);
  assert.equal(pre.reason, 'READY_FOR_TYPE_THEN_SEND_REOBSERVE');
  assert.equal(pre.send_control, null);
  assert.equal(pre.send_required_before_type, false);
  assert.equal(pre.send_required_before_click, true);
  assert.equal(pre.automatic_retry_allowed, false);
  assert.equal(pre.authority_effect, false);
});

test('PRE_CLICK still fails closed until one exact Send exists', () => {
  const missing = evaluateFleetSubmitReadiness({ ...exact, frame: root, phase: 'PRE_CLICK' });
  assert.equal(missing.ready, false);
  assert.equal(missing.reason, 'SEND_CONTROL_NOT_UNIQUE');

  const present = evaluateFleetSubmitReadiness({
    ...exact,
    phase: 'PRE_CLICK',
    frame: {
      ...root,
      semantic_targets: [
        ...root.semantic_targets,
        { role: 'button', name: 'Send prompt' },
      ],
    },
  });
  assert.equal(present.ready, true);
  assert.equal(present.reason, 'READY_FOR_TWO_PHASE_SEND');
  assert.equal(present.send_control?.name, 'Send prompt');
});
