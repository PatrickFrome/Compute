import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySelfUpdateBootstrapRecovery } from '../src/self-update-bootstrap-recovery-classifier.mjs';

const targetVersion = '0.6.6-dev.33774085931.1';
const targetGitSha = '40de5272e4a511e3f8f586e36686e4239a316cb0';
const installedSha = 'a'.repeat(64);
const installedPath = 'C:\\Users\\User\\AppData\\Local\\Programs\\METAENGINE Browser Test\\METAENGINE Browser Test.exe';

function expected(overrides = {}) {
  return {
    version: targetVersion,
    git_sha: targetGitSha,
    installed_executable_path: installedPath,
    installed_executable_sha256: installedSha,
    release_manifest_verified: true,
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    transaction: {
      schema: 'metaengine.self-update.transaction.v1',
      state: 'SUCCESSOR_BOOTED',
      source_version: '0.6.6-dev.4.1',
      target_version: targetVersion,
      automatic_retry_allowed: false,
      authority_effect: false,
    },
    pre_install_receipt: {
      schema: 'metaengine.self-update.pre-install-receipt.v1',
      version: targetVersion,
      available_version: targetVersion,
      metadata_verified: true,
      restart_gate_safe: true,
      authority_effect: false,
    },
    successor_receipt: {
      schema: 'metaengine.self-update.successor-receipt.v1',
      version: targetVersion,
      primary_instance: true,
      pre_install_receipt_sha256: 'b'.repeat(64),
      authority_effect: false,
    },
    installed_executable: {
      readback_proven: true,
      exists: true,
      path: installedPath,
      sha256: installedSha,
      product_version: targetVersion,
    },
    release_binding: {
      verified: true,
      version: targetVersion,
      git_sha: targetGitSha,
      installed_executable_sha256: installedSha,
      authority_effect: false,
    },
    ...overrides,
  };
}

test('exact durable successor plus exact disk and release binding yields TARGET_PRESENT but no automatic relaunch', () => {
  const result = classifySelfUpdateBootstrapRecovery({ expected_target: expected(), evidence: evidence() });
  assert.equal(result.state, 'TARGET_PRESENT');
  assert.equal(result.target_present_proven, true);
  assert.equal(result.relaunch_effect_candidate, true);
  assert.equal(result.relaunch_effect_allowed, false);
  assert.equal(result.installer_effect_allowed, false);
  assert.equal(result.journal_mutation_allowed, false);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.authority_effect, false);
});

test('prior SUCCESSOR_BOOTED can never be downgraded to no-effect when current target bytes are absent or drifted', () => {
  const result = classifySelfUpdateBootstrapRecovery({
    expected_target: expected(),
    evidence: evidence({ installed_executable: { readback_proven: true, exists: false, path: installedPath } }),
  });
  assert.equal(result.state, 'AMBIGUOUS');
  assert.equal(result.reason, 'PRIOR_INSTALL_EFFECT_POSITIVELY_OBSERVED_CURRENT_TARGET_NOT_EXACT');
  assert.equal(result.new_install_transaction_admissible, false);
  assert.equal(result.installer_effect_allowed, false);
});

test('file version without publisher-bound installed executable digest remains AMBIGUOUS', () => {
  const result = classifySelfUpdateBootstrapRecovery({
    expected_target: expected({ installed_executable_sha256: null }),
    evidence: evidence(),
  });
  assert.equal(result.state, 'AMBIGUOUS');
  assert.equal(result.reason, 'EXPECTED_INSTALLED_EXECUTABLE_DIGEST_MISSING');
  assert.equal(result.relaunch_effect_candidate, false);
});

test('wrong installed executable digest, missing successor receipt, or unverified release remains AMBIGUOUS', () => {
  for (const observed of [
    evidence({ installed_executable: { readback_proven: true, exists: true, path: installedPath, sha256: 'c'.repeat(64), product_version: targetVersion } }),
    evidence({ successor_receipt: null }),
    evidence({ release_binding: { ...evidence().release_binding, verified: false } }),
  ]) {
    const result = classifySelfUpdateBootstrapRecovery({ expected_target: expected(), evidence: observed });
    assert.equal(result.state, 'AMBIGUOUS');
    assert.equal(result.installer_effect_allowed, false);
    assert.equal(result.relaunch_effect_allowed, false);
  }
});

test('target absence alone never proves no installer effect', () => {
  const result = classifySelfUpdateBootstrapRecovery({
    expected_target: expected(),
    evidence: {
      transaction: {
        schema: 'metaengine.self-update.transaction.v1',
        state: 'PREPARED',
        source_version: '0.6.6-dev.4.1',
        target_version: targetVersion,
        automatic_retry_allowed: false,
        authority_effect: false,
      },
      installed_executable: { readback_proven: true, exists: false, path: installedPath },
    },
  });
  assert.equal(result.state, 'AMBIGUOUS');
  assert.equal(result.install_effect_absent_proven, false);
  assert.equal(result.new_install_transaction_admissible, false);
});

test('NO_INSTALL_EFFECT_PROVEN requires an independent exact negative proof and still does not perform an installer effect', () => {
  const result = classifySelfUpdateBootstrapRecovery({
    expected_target: expected(),
    evidence: {
      transaction: {
        schema: 'metaengine.self-update.transaction.v1',
        state: 'PREPARED',
        source_version: '0.6.6-dev.4.1',
        target_version: targetVersion,
        automatic_retry_allowed: false,
        authority_effect: false,
      },
      no_effect_proof: {
        schema: 'metaengine.self-update.bootstrap-no-effect-proof.v1',
        target_version: targetVersion,
        installed_path_absent_proven: true,
        uninstall_registration_absent_proven: true,
        successor_receipt_absent_proven: true,
        installer_effect_absent_proven: true,
        automatic_retry_allowed: false,
        authority_effect: false,
      },
    },
  });
  assert.equal(result.state, 'NO_INSTALL_EFFECT_PROVEN');
  assert.equal(result.install_effect_absent_proven, true);
  assert.equal(result.new_install_transaction_admissible, true);
  assert.equal(result.installer_effect_allowed, false);
  assert.equal(result.automatic_retry_allowed, false);
});

test('malformed target binding or unverified manifest fails closed', () => {
  assert.equal(classifySelfUpdateBootstrapRecovery({ expected_target: {}, evidence: {} }).state, 'AMBIGUOUS');
  const unverified = classifySelfUpdateBootstrapRecovery({
    expected_target: expected({ release_manifest_verified: false }),
    evidence: evidence(),
  });
  assert.equal(unverified.reason, 'RELEASE_MANIFEST_NOT_VERIFIED');
});

test('classification is pure and never mutates provided evidence', () => {
  const input = evidence();
  const before = structuredClone(input);
  classifySelfUpdateBootstrapRecovery({ expected_target: expected(), evidence: input });
  assert.deepEqual(input, before);
});
