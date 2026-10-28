import assert from 'node:assert/strict';
import test from 'node:test';
import {projectSelfUpdateFailureReadback, projectInstallerProcessObservation} from './self-update-failure-readback.mjs';

const baseline = '0.7.0-dev.100.1';
const target = '0.7.0-dev.101.1';
const oldHash = 'a'.repeat(64);
const newHash = 'b'.repeat(64);
const preHash = 'c'.repeat(64);
const privateText = 'DO_NOT_EXPORT_PRIVATE_PATH_TOKEN_OR_ERROR';

test('installer census reports only exact visible paths and never proves a transaction', () => {
  const expectedPath = 'C:\\Users\\private\\updater\\METAENGINE-Browser-Test-Setup-0.7.0-dev.101.1-x64.exe';
  const name = 'METAENGINE-Browser-Test-Setup-0.7.0-dev.101.1-x64.exe';
  const base = {expectedPath,observedAt:'2026-10-29T00:00:00.000Z'};
  const present = projectInstallerProcessObservation({...base,rows:[{Name:name,ExecutablePath:expectedPath}]});
  assert.equal(present.state,'PRESENT');assert.equal(present.matching_process_count,1);
  assert.equal(present.transaction_binding_proven,false);assert.equal(present.installer_result_observed,false);
  assert.ok(!JSON.stringify(present).includes('private'));
  assert.equal(projectInstallerProcessObservation({...base,rows:[]}).state,'ABSENT');
  assert.equal(projectInstallerProcessObservation({...base,rows:[{Name:name,ExecutablePath:'D:\\other\\'+name}]}).state,'ABSENT');
  assert.equal(projectInstallerProcessObservation({...base,rows:[{Name:name,ExecutablePath:null}]}).state,'UNAVAILABLE');
  assert.equal(projectInstallerProcessObservation({...base,rows:[{Name:name,ExecutablePath:expectedPath}],observedAt:'invalid'}).state,'UNAVAILABLE');
});

function observations() {
  return {
    context: {source_head: 'd'.repeat(40), baseline_version: baseline,
      target_version: target, baseline_asar_sha256: oldHash},
    preInstall: {observation: 'READABLE', bytes: 300, sha256: preHash, value: {
      schema: 'metaengine.self-update.pre-install-receipt.v1',
      version: target, available_version: target, metadata_verified: true,
      restart_gate_safe: true, successor_startup: 'PROBE_ONLY', authority_effect: false}},
    transaction: {observation: 'READABLE', bytes: 300, sha256: newHash, value: {
      schema: 'metaengine.self-update.transaction.v1', state: 'INSTALLING',
      transaction_id: '12345678-1234-4234-9234-123456789abc', source_version: baseline,
      target_version: target, automatic_retry_allowed: false, authority_effect: false,
      evidence: {physical_effect_attempted: true, token: privateText}}},
    successor: {observation: 'ABSENT'},
    installedImage: {observation: 'READABLE', bytes: 2000, sha256: oldHash, version: baseline},
  };
}
function noAuthority(result) {
  for (const key of ['verification_succeeded', 'installation_outcome_proven',
    'installer_result_observed', 'old_uninstaller_execution_observed',
    'automatic_retry_allowed', 'authority_effect']) assert.equal(result[key], false, key);
  assert.equal(result.capture_only, true);
  assert.equal(result.installed_image.exact_target_bytes_verified, false);
  assert.equal(result.installed_image.installed_executable_verified, false);
  assert.ok(!JSON.stringify(result).includes(privateText));
}

test('projection preserves a missing-successor journal and baseline bytes without inferring installer failure', () => {
  const input = observations();
  const before = structuredClone(input);
  const result = projectSelfUpdateFailureReadback(input);
  assert.equal(result.classification, 'BASELINE_BYTES_PRESENT_SUCCESSOR_UNPROVEN');
  assert.equal(result.successor.observation, 'ABSENT');
  assert.equal(result.transaction.state, 'INSTALLING');
  assert.equal(result.transaction.physical_effect_attempted, true);
  assert.equal(result.pre_install_binding_observed, true);
  assert.equal(result.successor_binding_observed, false);
  assert.deepEqual(input, before);
  noAuthority(result);
});

for (const [version, classification] of [
  [target, 'TARGET_VERSION_PRESENT_SUCCESSOR_UNPROVEN'],
  ['0.7.0-dev.999.1', 'CHANGED_IMAGE_SUCCESSOR_UNPROVEN'],
]) {
  test('projection of changed bytes with version ' + version + ' remains unproven', () => {
    const input = observations();
    input.installedImage = {observation: 'READABLE', bytes: 2100, sha256: newHash, version};
    const result = projectSelfUpdateFailureReadback(input);
    assert.equal(result.classification, classification);
    assert.equal(result.installed_image.matches_baseline_bytes, false);
    assert.equal(result.installed_image.target_version_observed, version === target);
    noAuthority(result);
  });
}

test('projection of inaccessible or changing image cannot infer byte replacement from stale metadata', () => {
  for (const observation of ['ABSENT', 'UNSAFE_PATH', 'CHANGED', 'OVERSIZE', 'UNREADABLE']) {
    const input = observations();
    input.installedImage = {observation, version: target, sha256: newHash};
    const result = projectSelfUpdateFailureReadback(input);
    assert.equal(result.classification, 'INSTALLED_IMAGE_UNPROVEN', observation);
    assert.equal(result.installed_image.matches_baseline_bytes, null);
    assert.equal(result.installed_image.target_version_observed, null);
    noAuthority(result);
  }
});

test('projection of a bound successor remains evidence for later qualification and rejects a stale digest', () => {
  const input = observations();
  input.transaction.value.state = 'SUCCESSOR_BOOTED';
  input.successor = {observation: 'READABLE', bytes: 300, sha256: newHash, value: {
    schema: 'metaengine.self-update.successor-receipt.v1', version: target,
    app_id: 'com.metaengine.browser.test', primary_instance: true,
    successor_startup: 'PROBE_ONLY', pre_install_receipt_sha256: preHash,
    authority_effect: false}};
  const result = projectSelfUpdateFailureReadback(input);
  assert.equal(result.classification, 'SUCCESSOR_RECEIPT_PRESENT_REQUIRES_QUALIFICATION');
  assert.equal(result.successor_binding_observed, true);
  noAuthority(result);
  input.successor.value.pre_install_receipt_sha256 = newHash;
  assert.equal(projectSelfUpdateFailureReadback(input).successor_binding_observed, false);
});

test('projection rejects malformed fields and does not coerce arrays into trusted identifiers', () => {
  const input = observations();
  input.context.source_head = ['d'.repeat(40)];
  input.transaction.value.transaction_id = ['12345678-1234-4234-9234-123456789abc'];
  input.transaction.value.state = privateText;
  input.transaction.value.raw_error = privateText;
  input.preInstall.value.metadata_verified = 'true';
  input.installedImage = {observation: privateText, sha256: privateText, version: privateText};
  const result = projectSelfUpdateFailureReadback(input);
  assert.equal(result.source_head, null);
  assert.equal(result.transaction.transaction_id, null);
  assert.equal(result.transaction.state, null);
  assert.equal(result.pre_install_binding_observed, false);
  assert.equal(result.installed_image.observation, 'UNREADABLE');
  noAuthority(result);
});

test('projection requires pre-install version, startup, restart and metadata bindings independently', () => {
  for (const [key, value] of [['version', baseline], ['available_version', baseline],
    ['metadata_verified', false], ['restart_gate_safe', false],
    ['successor_startup', privateText], ['authority_effect', true]]) {
    const input = observations();
    input.preInstall.value[key] = value;
    const result = projectSelfUpdateFailureReadback(input);
    assert.equal(result.pre_install_binding_observed, false, key);
    assert.equal(result.successor_binding_observed, false, key);
    noAuthority(result);
  }
});

test('projection with no observations stays bounded and explicitly unproven', () => {
  const result = projectSelfUpdateFailureReadback();
  assert.equal(result.classification, 'INSTALLED_IMAGE_UNPROVEN');
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 16384);
  noAuthority(result);
});
