import test from 'node:test';
import assert from 'node:assert/strict';
import { SelfUpdateRuntime } from '../src/self-update-runtime.mjs';
import {
  selfUpdateRecoveryDiagnosticSnapshot,
  shouldResumeSuccessorQualification,
} from '../src/self-update-successor-recovery.mjs';

function ambiguousInspection() {
  return {
    schema: 'metaengine.self-update.startup-inspection.v1',
    state: 'AMBIGUOUS_INSTALL',
    transaction_state: 'SUCCESSOR_BOOTED',
    current_version: '0.6.6-dev.4.1',
    target_version: '0.6.6-dev.33669069869.1',
    reason: 'pre_install_receipt_present_but_target_not_installed',
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

test('self-update runtime projects bounded startup recovery diagnostics without effect authority', () => {
  const resume = shouldResumeSuccessorQualification({
    updatedLaunch: false,
    startupInspection: ambiguousInspection(),
  });
  assert.equal(resume, false);

  const retained = selfUpdateRecoveryDiagnosticSnapshot();
  assert.equal(retained.state, 'AMBIGUOUS_INSTALL');
  assert.equal(retained.recovery_installer_effect_allowed, false);
  assert.equal(retained.automatic_retry_allowed, false);
  assert.equal(retained.authority_effect, false);

  const runtime = new SelfUpdateRuntime({
    updater: {},
    hostResilience: false,
    fetchImpl: async () => { throw new Error('network_not_expected'); },
  });
  const snapshot = runtime.snapshot();
  assert.deepEqual(snapshot.startup_recovery, retained);
  assert.equal(snapshot.startup_recovery.recovery_installer_effect_allowed, false);
  assert.equal(snapshot.startup_recovery.automatic_retry_allowed, false);
  assert.equal(snapshot.startup_recovery.authority_effect, false);
  assert.equal(snapshot.automatic_effect_retry, false);
});
