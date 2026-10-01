import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createBrowserGuardianMachineBootstrapLauncher,
  validateGuardianMachineBootstrapBinding,
  verifyPackagedGuardianBootstrapExecutable,
  browserGuardianMachineBootstrapLauncherContract,
} from '../src/browser-guardian-machine-bootstrap-launcher.mjs';

const HEAD = '1'.repeat(40);
const VERSION = '0.7.0-dev.99.1';
const FP = '2'.repeat(64);

function binding(bytes, overrides = {}) {
  return {
    schema: 'metaengine.browser-guardian.machine-bootstrap-binding.v1',
    source_head: HEAD,
    package_version: VERSION,
    slot_id: `${HEAD.slice(0, 16)}-${'3'.repeat(16)}`,
    bootstrap_name: `METAENGINE-Guardian-Bootstrap-${VERSION}-x64.exe`,
    bootstrap_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    bootstrap_size: bytes.length,
    guardian_manifest_sha256: '4'.repeat(64),
    service_sha256: '5'.repeat(64),
    configurator_sha256: '6'.repeat(64),
    embedded_assets_only: true,
    explicit_elevated_install_required: true,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  };
}

function identity() {
  return {
    randomNonce: () => 'abcdefghijklmnopqrstuvwxyzABCDEF123456',
    guardianOwnerChallenge: async () => ({}),
    guardianUpdateActuatorProof: async () => ({}),
  };
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guardian-launcher-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'guardian-bootstrap');
  await fs.mkdir(dir);
  const bytes = Buffer.alloc(80 * 1024, 7);
  const b = binding(bytes);
  const exe = path.join(dir, b.bootstrap_name);
  await fs.writeFile(exe, bytes);
  return { root, dir, bytes, binding: b, exe };
}

test('protected binding accepts only exact build/version/name/bytes contract', () => {
  const bytes = Buffer.alloc(80 * 1024, 1);
  const exact = validateGuardianMachineBootstrapBinding(binding(bytes), {
    expectedBuildSha: HEAD,
    expectedVersion: VERSION,
  });
  assert.equal(exact.bootstrap_name, `METAENGINE-Guardian-Bootstrap-${VERSION}-x64.exe`);
  assert.throws(() => validateGuardianMachineBootstrapBinding({ ...exact, source_head: 'a'.repeat(40) }, {
    expectedBuildSha: HEAD, expectedVersion: VERSION,
  }), /source_head_mismatch/);
  assert.throws(() => validateGuardianMachineBootstrapBinding({ ...exact, bootstrap_name: 'evil.exe' }, {
    expectedBuildSha: HEAD, expectedVersion: VERSION,
  }), /name_invalid/);
  assert.throws(() => validateGuardianMachineBootstrapBinding({ ...exact, automatic_retry_allowed: true }, {
    expectedBuildSha: HEAD, expectedVersion: VERSION,
  }), /contract_invalid/);
});

test('packaged executable must match protected digest/size and reject symlink substitution', async (t) => {
  const fx = await fixture(t);
  const verified = verifyPackagedGuardianBootstrapExecutable({
    binding: fx.binding, resourcesPath: fx.root, expectedBuildSha: HEAD, expectedVersion: VERSION,
  });
  assert.equal(verified.executable, fx.exe);
  await fs.appendFile(fx.exe, Buffer.from('tamper'));
  assert.throws(() => verifyPackagedGuardianBootstrapExecutable({
    binding: fx.binding, resourcesPath: fx.root, expectedBuildSha: HEAD, expectedVersion: VERSION,
  }), /identity_mismatch/);
});

test('absent service requires explicit activation but status never invokes UAC', async (t) => {
  const fx = await fixture(t);
  let openCount = 0;
  const launcher = createBrowserGuardianMachineBootstrapLauncher({
    platform: 'win32', isPackaged: true, resourcesPath: fx.root, version: VERSION,
    identity: identity(),
    openPath: async () => { openCount += 1; return ''; },
    trustRootLoader: () => ({ build_sha: HEAD }),
    bindingLoader: () => fx.binding,
    actuatorFactory: () => ({
      observeOwner: async () => { throw Object.assign(new Error('guardian_update_actuator_pipe_error:ENOENT'), { code: 'GUARDIAN_PIPE_NOT_FOUND' }); },
      ensureOwnerBound: async () => { throw new Error('must_not_enroll'); },
    }),
  });
  const status = await launcher.status();
  assert.equal(status.state, 'ACTIVATION_REQUIRED');
  assert.equal(status.uac_consent_required, true);
  assert.equal(openCount, 0);
});

test('pre-existing Guardian with missing owner binds approved device without launching UAC', async (t) => {
  const fx = await fixture(t);
  let openCount = 0;
  let ensureCount = 0;
  const launcher = createBrowserGuardianMachineBootstrapLauncher({
    platform: 'win32', isPackaged: true, resourcesPath: fx.root, version: VERSION,
    identity: identity(),
    openPath: async () => { openCount += 1; return ''; },
    trustRootLoader: () => ({ build_sha: HEAD }),
    bindingLoader: () => fx.binding,
    actuatorFactory: () => ({
      observeOwner: async () => ({
        state: 'NO_EFFECT_PROVEN', reason: 'OWNER_ENROLLMENT_TICKET_REQUIRED', effect_absent_proven: true,
      }),
      ensureOwnerBound: async () => {
        ensureCount += 1;
        return {
          state: 'OWNER_BOUND', reason: 'DURABLE_OWNER_AND_DEVICE_CHALLENGE_EXACT',
          owner_binding_proven: true, device_binding_proven: true, effect_absent_proven: true,
          device_key_fingerprint_sha256: FP,
        };
      },
    }),
  });
  const result = await launcher.activate();
  assert.equal(result.state, 'READY');
  assert.equal(openCount, 0);
  assert.equal(ensureCount, 1);
});

test('UAC launch is fixed-path and READY requires independent Guardian readback plus owner binding', async (t) => {
  const fx = await fixture(t);
  let openPathSeen = null;
  let observes = 0;
  let ensures = 0;
  let clock = 1_000;
  const launcher = createBrowserGuardianMachineBootstrapLauncher({
    platform: 'win32', isPackaged: true, resourcesPath: fx.root, version: VERSION,
    identity: identity(),
    openPath: async (value) => { openPathSeen = value; return ''; },
    trustRootLoader: () => ({ build_sha: HEAD }),
    bindingLoader: () => fx.binding,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    pollIntervalMs: 100,
    actuatorFactory: () => ({
      observeOwner: async () => {
        observes += 1;
        if (observes < 3) throw Object.assign(new Error('guardian_update_actuator_pipe_error:ENOENT'), { code: 'GUARDIAN_PIPE_NOT_FOUND' });
        return { state: 'NO_EFFECT_PROVEN', reason: 'OWNER_ENROLLMENT_TICKET_REQUIRED', effect_absent_proven: true };
      },
      ensureOwnerBound: async () => {
        ensures += 1;
        return {
          state: 'OWNER_BOUND', reason: 'DURABLE_OWNER_AND_DEVICE_CHALLENGE_EXACT',
          owner_binding_proven: true, device_binding_proven: true, effect_absent_proven: true,
          device_key_fingerprint_sha256: FP,
        };
      },
    }),
  });
  const result = await launcher.activate();
  assert.equal(openPathSeen, fx.exe);
  assert.equal(result.state, 'READY');
  assert.equal(result.uac_launch_requested, true);
  assert.equal(ensures, 1);
  assert.ok(observes >= 3);
});

test('ambiguous owner enrollment is terminal for this activation and is never auto-retried', async (t) => {
  const fx = await fixture(t);
  let ensureCount = 0;
  const error = new Error('guardian_owner_enrollment_result_unknown:transport');
  error.code = 'GUARDIAN_OWNER_ENROLLMENT_AMBIGUOUS';
  const launcher = createBrowserGuardianMachineBootstrapLauncher({
    platform: 'win32', isPackaged: true, resourcesPath: fx.root, version: VERSION,
    identity: identity(),
    openPath: async () => { throw new Error('must_not_open'); },
    trustRootLoader: () => ({ build_sha: HEAD }),
    bindingLoader: () => fx.binding,
    actuatorFactory: () => ({
      observeOwner: async () => ({
        state: 'NO_EFFECT_PROVEN', reason: 'OWNER_ENROLLMENT_TICKET_REQUIRED', effect_absent_proven: true,
      }),
      ensureOwnerBound: async () => { ensureCount += 1; throw error; },
    }),
  });
  const result = await launcher.activate();
  assert.equal(result.state, 'AMBIGUOUS');
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(ensureCount, 1);
});

test('tampered packaged bootstrap holds before UAC', async (t) => {
  const fx = await fixture(t);
  await fs.appendFile(fx.exe, Buffer.from('tamper'));
  let openCount = 0;
  const launcher = createBrowserGuardianMachineBootstrapLauncher({
    platform: 'win32', isPackaged: true, resourcesPath: fx.root, version: VERSION,
    identity: identity(),
    openPath: async () => { openCount += 1; return ''; },
    trustRootLoader: () => ({ build_sha: HEAD }),
    bindingLoader: () => fx.binding,
    actuatorFactory: () => ({ observeOwner: async () => ({}) }),
  });
  const result = await launcher.activate();
  assert.equal(result.state, 'HOLD');
  assert.equal(result.reason, 'PROTECTED_BOOTSTRAP_IDENTITY_UNPROVEN');
  assert.equal(openCount, 0);
});

for (const scenario of [
  { name: 'lost OS launch response', open: () => { throw new Error('response lost after dispatch'); }, state: 'AMBIGUOUS' },
  { name: 'stalled OS launch response', open: () => new Promise(() => {}), state: 'AMBIGUOUS' },
  { name: 'opaque OS failure message', open: () => 'The operation failed', state: 'HOLD' },
]) {
  test(`${scenario.name} is bounded and cannot prove physical effect absence or cause retries`, async (t) => {
    const fx = await fixture(t);
    let launches = 0;
    let enrollments = 0;
    const launcher = createBrowserGuardianMachineBootstrapLauncher({
      platform: 'win32', isPackaged: true, resourcesPath: fx.root, version: VERSION,
      identity: identity(),
      launchTimeoutMs: 20,
      openPath: () => { launches += 1; return scenario.open(); },
      trustRootLoader: () => ({ build_sha: HEAD }), bindingLoader: () => fx.binding,
      actuatorFactory: () => ({
        observeOwner: async () => { throw Object.assign(new Error('guardian_update_actuator_pipe_error:ENOENT'), { code: 'GUARDIAN_PIPE_NOT_FOUND' }); },
        ensureOwnerBound: async () => { enrollments += 1; throw new Error('must_not_enroll'); },
      }),
    });
    const results = await Promise.all([launcher.activate(), launcher.activate()]);
    for (const result of results) {
      assert.equal(result.state, scenario.state);
      assert.equal(result.physical_effect_outcome, 'UNPROVEN');
      assert.equal(result.ready, false);
      assert.equal(result.automatic_retry_allowed, false);
    }
    assert.equal(launches, 1);
    assert.equal(enrollments, 0);
  });
}

test('launcher contract exposes no renderer path/args and no startup elevation or retry', () => {
  const contract = browserGuardianMachineBootstrapLauncherContract();
  assert.equal(contract.explicit_user_action_required, true);
  assert.equal(contract.startup_auto_elevation_allowed, false);
  assert.equal(contract.renderer_supplied_path_allowed, false);
  assert.equal(contract.renderer_supplied_arguments_allowed, false);
  assert.equal(contract.packaged_asar_binding_required, true);
  assert.equal(contract.exact_sha256_and_size_required, true);
  assert.equal(contract.automatic_effect_retry_allowed, false);
  assert.equal(contract.ambiguous_owner_enrollment_retry_allowed, false);
  assert.equal(contract.bounded_uac_acknowledgement_required, true);
  assert.equal(contract.lost_uac_acknowledgement_proves_no_effect, false);
});

for (const error of [
  new Error('guardian_update_actuator_pipe_timeout'),
  new Error('guardian_update_actuator_pipe_ended_without_result'),
  new Error('guardian_update_actuator_pipe_closed_without_result'),
  new Error('guardian_update_actuator_pipe_error:ENOENT'),
  Object.assign(new Error('guardian_update_actuator_pipe_error:EACCES'), { code: 'GUARDIAN_PIPE_IO_ERROR' }),
  Object.assign(new Error('guardian_update_actuator_pipe_error:ECONNRESET'), { code: 'GUARDIAN_PIPE_IO_ERROR' }),
]) {
  test(`unproven pipe observation ${error.message} cannot request UAC or enrollment`, async (t) => {
    const fx = await fixture(t);
    let launches = 0;
    let enrollments = 0;
    const launcher = createBrowserGuardianMachineBootstrapLauncher({
      platform: 'win32', isPackaged: true, resourcesPath: fx.root, version: VERSION,
      identity: identity(),
      openPath: async () => { launches += 1; return ''; },
      trustRootLoader: () => ({ build_sha: HEAD }), bindingLoader: () => fx.binding,
      actuatorFactory: () => ({
        observeOwner: async () => { throw error; },
        ensureOwnerBound: async () => { enrollments += 1; throw new Error('must_not_enroll'); },
      }),
    });
    for (const observed of [await launcher.status(), await launcher.activate()]) {
      assert.equal(observed.state, 'HOLD');
      assert.equal(observed.reason, 'GUARDIAN_OWNER_OBSERVATION_FAILED');
      assert.equal(observed.ready, false);
      assert.equal(observed.uac_consent_required, false);
      assert.equal(observed.automatic_retry_allowed, false);
    }
    assert.equal(launches, 0);
    assert.equal(enrollments, 0);
  });
}
