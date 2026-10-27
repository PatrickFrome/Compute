import assert from 'node:assert/strict';
import test from 'node:test';
import { mechanicsSources, verifyNativeConsentMechanicsProof } from '../scripts/verify-native-consent-mechanics-proof.mjs';

const sourceHashes = Object.fromEntries(Object.keys(mechanicsSources).map(key => [key, 'a'.repeat(64)]));
const valid = () => ({ schema: 'metaengine.test.native-consent-helper-mechanics-proof.v1',
  github_run_id: '123', source_sha256: sourceHashes, scope: 'GENERATED_NODE_PARENT_NATIVE_NO_ONLY',
  harness_pid: 100, consent_pid: 101, exact_process_tree_bound: true, native_control_id: 7,
  actual_native_exit_code: 2, exact_declined_sentinel: true, generated_local_and_roaming_unchanged: true,
  process_cleanup_confirmed: true, installed_browser_qualification: false, owner_boot_qualification: false,
  database_provisioning_qualification: false, guardian_qualification: false, authority_effect: false });
const check = log => verifyNativeConsentMechanicsProof(log, { runId: '123', sourceHashes });

test('exact current-run native denial proof is mechanics only, never installed authority', () => {
  for (const newline of ['\n', '\r\n']) {
    const result = check(`TAP version 13${newline}# ${JSON.stringify(valid())}${newline}ok 1${newline}`);
    assert.equal(result.native_denial_mechanics_verified, true);
    assert.equal(result.installed_qualification, false);
    assert.equal(result.authority_effect, false);
    assert.ok(Object.isFrozen(result));
  }
});

test('skipped, absent, malformed, duplicate and stale proof cannot reserve a version', () => {
  for (const log of ['', 'ok 1 # SKIP Windows only', '# {not json}',
    JSON.stringify(valid()) + '\n' + JSON.stringify(valid())]) assert.throws(() => check(log));
  const stale = valid(); stale.github_run_id = '122';
  assert.throws(() => check(JSON.stringify(stale)), /run_mismatch/);
  const changed = valid(); changed.source_sha256 = { ...sourceHashes, native_consent: 'b'.repeat(64) };
  assert.throws(() => check(JSON.stringify(changed)), /source_mismatch/);
});

test('every denied-cleanup, consent, source or authority mutation is rejected', () => {
  const mutations = { scope: 'INSTALLED_READY', harness_pid: 0, consent_pid: 100,
    exact_process_tree_bound: false, native_control_id: 6, actual_native_exit_code: 0,
    exact_declined_sentinel: false, generated_local_and_roaming_unchanged: false,
    process_cleanup_confirmed: false, installed_browser_qualification: true,
    owner_boot_qualification: true, database_provisioning_qualification: true,
    guardian_qualification: true, authority_effect: true, production_ready: true };
  for (const [key, value] of Object.entries(mutations)) {
    assert.throws(() => check(JSON.stringify({ ...valid(), [key]: value })), key);
  }
  for (const key of Object.keys(valid())) {
    const row = valid(); delete row[key]; assert.throws(() => check(JSON.stringify(row)), key);
  }
  assert.throws(() => check('x'.repeat(1024 * 1024 + 1)), /oversized/);
});
