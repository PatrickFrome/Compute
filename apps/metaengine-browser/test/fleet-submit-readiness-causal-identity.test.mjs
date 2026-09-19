import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFleetSubmitReadiness } from '../src/fleet-submit-readiness.mjs';

const EXPECTED = Object.freeze({
  expected_tab_id: 'tab-fleet-1',
  observed_tab_id: 'tab-fleet-1',
  expected_target_id: 'webcontents:17',
  observed_target_id: 'webcontents:17',
  selected_tab_id: 'tab-fleet-1',
});

test('Fleet submit readiness fails closed when CAPTURE omits tab identity even if caller mirrors the expected lease tab', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    frame: { target_id: 'webcontents:17' },
  });

  assert.equal(readiness.ready, false);
  // D-C2: causal-identity failure of the CAPTUREd frame tab is a BINDING
  // failure, not a foreground failure — the caller mirror can never repair a
  // frame that never carried its own tab identity.
  assert.equal(readiness.reason, 'TAB_BINDING_NOT_EXACT');
  assert.equal(readiness.authority_effect, false);
});

test('Fleet submit readiness fails closed when CAPTURE tab identity drifts even if caller mirrors the expected lease tab', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    frame: { tab_id: 'tab-fleet-2', target_id: 'webcontents:17' },
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'TAB_BINDING_NOT_EXACT');
  assert.equal(readiness.authority_effect, false);
});

test('D-C2: ChatGPT lane still fails closed on foreground mismatch with TAB_NOT_FOREGROUND_EXACT', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    selected_tab_id: 'tab-other',
    frame: { tab_id: 'tab-fleet-1', target_id: 'webcontents:17' },
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'TAB_NOT_FOREGROUND_EXACT');
  assert.equal(readiness.authority_effect, false);
});

test('D-C2: GLM lane readiness is TAB-SCOPED — a foreground mismatch never fails the submit gate', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    platform: 'GLM_ZAI',
    phase: 'PRE_TYPE',
    selected_tab_id: 'tab-other',
    frame: {
      tab_id: 'tab-fleet-1',
      target_id: 'webcontents:17',
      viewport: { width: 0, height: 0 },
      semantic_targets: [{ role: 'textbox', name: 'Ask anything', semantic_ref: 'sr-1' }],
    },
  });

  // Semantic addressing is geometry-independent and dispatch is tab-scoped
  // (D-S2 + D-C2): the unselected fleet tab with a 0x0 viewport is still
  // submittable, and the foreground drift is reported as an observation.
  assert.equal(readiness.ready, true);
  assert.equal(readiness.reason, 'READY_FOR_ENTER_SUBMIT');
  assert.equal(readiness.viewport_rendered, false);
});

test('D-C2: GLM lane still fails closed when the CAPTUREd frame tab drifts from the lease', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    platform: 'GLM_ZAI',
    phase: 'PRE_TYPE',
    frame: { tab_id: 'tab-fleet-2', target_id: 'webcontents:17' },
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'TAB_BINDING_NOT_EXACT');
  assert.equal(readiness.authority_effect, false);
});

test('Fleet submit readiness fails closed when CAPTURE omits target identity even if caller mirrors the expected lease target', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    frame: { tab_id: 'tab-fleet-1' },
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'TARGET_INCARNATION_MISMATCH');
  assert.equal(readiness.authority_effect, false);
});

test('Fleet submit readiness fails closed when CAPTURE target identity drifts even if caller mirrors the expected lease target', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    frame: { tab_id: 'tab-fleet-1', target_id: 'webcontents:18' },
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'TARGET_INCARNATION_MISMATCH');
  assert.equal(readiness.authority_effect, false);
});
