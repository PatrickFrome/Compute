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
  assert.equal(readiness.reason, 'TAB_NOT_FOREGROUND_EXACT');
  assert.equal(readiness.authority_effect, false);
});

test('Fleet submit readiness fails closed when CAPTURE tab identity drifts even if caller mirrors the expected lease tab', () => {
  const readiness = evaluateFleetSubmitReadiness({
    ...EXPECTED,
    frame: { tab_id: 'tab-fleet-2', target_id: 'webcontents:17' },
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'TAB_NOT_FOREGROUND_EXACT');
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
