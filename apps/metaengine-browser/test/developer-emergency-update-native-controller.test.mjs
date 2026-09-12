import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createNativeGuardianDeveloperEmergencyUpdateController,
  nativeGuardianDeveloperEmergencyUpdateContract,
} from '../src/developer-emergency-update-native-controller.mjs';

const COMMAND_ID = '11111111-1111-4111-8111-111111111111';
const NONCE = 'abcdefghijklmnopqrstuvwxyzABCDEF123456';
const CANDIDATE_SHA = '1'.repeat(40);
const INSTALLER_SHA = '2'.repeat(64);
const MANIFEST_SHA = '3'.repeat(64);
const INSTALLED_SHA = '4'.repeat(64);

function command(expectedGitSha = null) {
  return {
    command_id: COMMAND_ID,
    action: 'DEVELOPER_EMERGENCY_UPDATE',
    payload: {
      schema: 'metaengine.developer-emergency-update.v1',
      request_nonce: NONCE,
      release_mode: 'LATEST_TRUSTED',
      ...(expectedGitSha ? { expected_git_sha: expectedGitSha } : {}),
    },
  };
}

function release(overrides = {}) {
  const version = overrides.version || '0.7.0-dev.3.1';
  return {
    schema: 'metaengine.trusted-dev-release.v1',
    version,
    tag: `v${version}`,
    git_sha: CANDIDATE_SHA,
    feed_url: `https://github.com/PatrickFrome/Compute/releases/download/v${version}/`,
    installer_name: `METAENGINE-Browser-Test-Setup-${version}-x64.exe`,
    installer_sha256: INSTALLER_SHA,
    installer_sha512: 'A'.repeat(86) + '==',
    manifest_sha256: MANIFEST_SHA,
    dev_yml_sha256: '5'.repeat(64),
    installed_executable_sha256: INSTALLED_SHA,
    target_present_proof_supported: true,
    authority_effect: false,
    ...overrides,
  };
}

function ownerProbe() {
  return {
    state: 'OWNER_BOUND',
    expected_owner_sid: 'S-1-5-21-1-2-3-1001',
    enrollment_evidence_sha256: '6'.repeat(64),
    device_key_fingerprint_sha256: '7'.repeat(64),
    owner_binding_proven: true,
    device_binding_proven: true,
    effect_absent_proven: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function intake() {
  return {
    schema: 'metaengine.browser-guardian.update-intake.v1',
    release_version: '0.7.0-dev.3.1',
    installer_sha256: INSTALLER_SHA,
    manifest_sha256: MANIFEST_SHA,
    installed_executable_sha256: INSTALLED_SHA,
    installer_size: 123,
    manifest_size: 456,
    fixed_intake_layout: true,
    caller_supplied_path_used: false,
    caller_supplied_url_used: false,
    authority_effect: false,
  };
}

function createHarness({ dispatch, observe, resolvedRelease = release(), intakeResult = intake() } = {}) {
  const calls = [];
  const actuator = {
    probeOwner: async (input) => {
      calls.push(['probeOwner', structuredClone(input)]);
      return ownerProbe();
    },
    dispatch: async (input) => {
      calls.push(['dispatch', structuredClone(input)]);
      return dispatch ? dispatch(input) : {
        state: 'DISPATCHED',
        reason: 'EXACT_SILENT_INSTALLER_DISPATCHED',
        physical_dispatch_performed: true,
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    },
    observe: async (input) => {
      calls.push(['observe', structuredClone(input)]);
      return observe ? observe(input) : {
        state: 'READY',
        reason: 'EXACT_INSTALLED_EXECUTABLE_DIGEST_PROVEN',
        installed_executable_sha256: INSTALLED_SHA,
        exact_ready_binding: true,
        physical_dispatch_performed: false,
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    },
  };
  const controller = createNativeGuardianDeveloperEmergencyUpdateController({
    identity: {},
    currentVersion: '0.7.0-dev.2.1',
    fetchImpl: async () => { throw new Error('network_must_be_owned_by_injected_resolver_or_stager'); },
    platform: 'win32',
    releaseResolver: async () => {
      calls.push(['releaseResolver']);
      return resolvedRelease;
    },
    intakeStager: async ({ release: stagedRelease }) => {
      calls.push(['intakeStager', stagedRelease.git_sha]);
      return intakeResult;
    },
    actuator,
  });
  return { controller, calls };
}

test('native emergency controller binds command id to one Guardian effect and confirms by exact installed digest', async () => {
  const { controller, calls } = createHarness();
  const result = await controller(command(CANDIDATE_SHA));

  assert.equal(result.state, 'CONFIRMED');
  assert.equal(result.effect_outcome, 'CONFIRMED');
  assert.equal(result.physical_dispatch_count, 1);
  assert.equal(result.physical_dispatch_count_known, true);
  assert.equal(result.effect_id, COMMAND_ID);
  assert.equal(result.effect_generation, 1);
  assert.equal(result.candidate_git_sha, CANDIDATE_SHA);
  assert.equal(result.installed_executable_sha256, INSTALLED_SHA);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.electron_updater_fallback_used, false);

  assert.deepEqual(calls.map(([name]) => name), [
    'probeOwner',
    'releaseResolver',
    'intakeStager',
    'dispatch',
    'observe',
  ]);
  const dispatch = calls.find(([name]) => name === 'dispatch')[1];
  const observe = calls.find(([name]) => name === 'observe')[1];
  assert.equal(dispatch.effect_id, COMMAND_ID);
  assert.equal(dispatch.command_id, COMMAND_ID);
  assert.equal(dispatch.effect_generation, 1);
  assert.equal(dispatch.request_nonce, NONCE);
  assert.deepEqual(observe, dispatch);
});

test('expected git sha mismatch proves zero effect before intake or native dispatch', async () => {
  const { controller, calls } = createHarness();
  const result = await controller(command('a'.repeat(40)));

  assert.equal(result.state, 'HOLD');
  assert.equal(result.effect_outcome, 'NO_EFFECT_PROVEN');
  assert.equal(result.physical_dispatch_count, 0);
  assert.equal(result.reason, 'VERIFIED_IMMUTABLE_RELEASE_REQUIRED');
  assert.match(String(result.error || ''), /emergency_expected_git_sha_mismatch/);
  assert.deepEqual(calls.map(([name]) => name), ['probeOwner', 'releaseResolver']);
});

test('ambiguous native dispatch is never observed or retried by the controller', async () => {
  let dispatchCount = 0;
  const { controller, calls } = createHarness({
    dispatch: async () => {
      dispatchCount += 1;
      return {
        state: 'AMBIGUOUS',
        reason: 'NATIVE_EFFECT_BARRIER_ALREADY_CROSSED_OR_UNREADABLE',
        physical_dispatch_performed: false,
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    },
  });
  const result = await controller(command());

  assert.equal(result.state, 'AMBIGUOUS');
  assert.equal(result.effect_outcome, 'AMBIGUOUS');
  assert.equal(result.physical_dispatch_count, 0);
  assert.equal(result.physical_dispatch_count_known, false);
  assert.equal(result.physical_dispatch_upper_bound, 1);
  assert.equal(dispatchCount, 1);
  assert.equal(calls.filter(([name]) => name === 'dispatch').length, 1);
  assert.equal(calls.filter(([name]) => name === 'observe').length, 0);
});

test('transport loss after DISPATCH submission is ambiguous and never blind-retried', async () => {
  let dispatchCount = 0;
  const { controller, calls } = createHarness({
    dispatch: async () => {
      dispatchCount += 1;
      throw new Error('pipe_connection_lost_after_write');
    },
  });
  const result = await controller(command());

  assert.equal(result.state, 'AMBIGUOUS');
  assert.equal(result.reason, 'NATIVE_GUARDIAN_DISPATCH_RESULT_UNKNOWN');
  assert.equal(result.effect_outcome, 'AMBIGUOUS');
  assert.equal(result.physical_dispatch_count_known, false);
  assert.equal(result.physical_dispatch_upper_bound, 1);
  assert.equal(dispatchCount, 1);
  assert.equal(calls.filter(([name]) => name === 'dispatch').length, 1);
  assert.equal(calls.filter(([name]) => name === 'observe').length, 0);
});

test('post-dispatch readback loss remains ambiguous with the known one physical dispatch', async () => {
  const { controller, calls } = createHarness({
    observe: async () => { throw new Error('pipe_readback_lost'); },
  });
  const result = await controller(command());

  assert.equal(result.state, 'AMBIGUOUS');
  assert.equal(result.reason, 'NATIVE_GUARDIAN_POST_DISPATCH_READBACK_UNKNOWN');
  assert.equal(result.physical_dispatch_count, 1);
  assert.equal(result.physical_dispatch_count_known, true);
  assert.equal(calls.filter(([name]) => name === 'dispatch').length, 1);
  assert.equal(calls.filter(([name]) => name === 'observe').length, 1);
});

test('malformed emergency command never reaches owner probe or release discovery', async () => {
  const { controller, calls } = createHarness();
  const result = await controller({
    command_id: COMMAND_ID,
    action: 'DEVELOPER_EMERGENCY_UPDATE',
    payload: {
      schema: 'metaengine.developer-emergency-update.v1',
      request_nonce: 'short',
      release_mode: 'LATEST_TRUSTED',
    },
  });
  assert.equal(result.state, 'HOLD');
  assert.equal(result.reason, 'EMERGENCY_COMMAND_INVALID');
  assert.equal(result.effect_outcome, 'NO_EFFECT_PROVEN');
  assert.deepEqual(calls, []);
});

test('native emergency controller contract forbids retry, arbitrary execution and Electron fallback', () => {
  const contract = nativeGuardianDeveloperEmergencyUpdateContract();
  assert.equal(contract.command_id_is_native_effect_id, true);
  assert.equal(contract.native_write_ahead_effect_barrier_required, true);
  assert.equal(contract.caller_supplied_path_allowed, false);
  assert.equal(contract.caller_supplied_url_allowed, false);
  assert.equal(contract.caller_supplied_shell_allowed, false);
  assert.equal(contract.electron_updater_fallback_allowed, false);
  assert.equal(contract.dispatch_transport_failure_outcome, 'AMBIGUOUS');
  assert.equal(contract.automatic_retry_allowed, false);
});
