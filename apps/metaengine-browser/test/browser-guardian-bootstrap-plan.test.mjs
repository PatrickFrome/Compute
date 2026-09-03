import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_GUARDIAN_BOOTSTRAP_PROTOCOL_GENERATION,
  digestBrowserGuardianBootstrapTarget,
  planBrowserGuardianBootstrap,
} from '../src/browser-guardian-bootstrap-plan.mjs';

const SERVICE_SHA = '1'.repeat(64);
const CONFIG_SHA = '2'.repeat(64);
const MANIFEST_SHA = '3'.repeat(64);
const SOURCE_HEAD = '4'.repeat(40);

function release(overrides = {}) {
  return {
    verified_release: true,
    physical_n_to_n_plus_1: true,
    guardian_native_staging_verified: true,
    guardian_native_release_assets_verified: true,
    guardian_native_no_activation: true,
    guardian_native_requires_machine_secure_copy: true,
    source_head: SOURCE_HEAD,
    version: '0.6.6-dev.12345.1',
    guardian_manifest_sha256: MANIFEST_SHA,
    staging_only: true,
    service_activation_authorized: false,
    required_machine_root: '%ProgramFiles%\\METAENGINE\\Guardian',
    binaries: [
      { name: 'METAENGINEBrowserGuardian.exe', sha256: SERVICE_SHA, size: 1000 },
      { name: 'METAENGINEBrowserGuardianConfigure.exe', sha256: CONFIG_SHA, size: 2000 },
    ],
    ...overrides,
  };
}

function assertZeroAuthority(row) {
  assert.equal(row.protocol_generation, BROWSER_GUARDIAN_BOOTSTRAP_PROTOCOL_GENERATION);
  for (const key of [
    'browser_authority', 'task_authority', 'page_model_text_authority', 'scheduler_authority',
    'release_authority', 'service_configuration_authority', 'process_effect_authority',
    'filesystem_effect_authority', 'automatic_retry_allowed', 'authority_effect',
  ]) assert.equal(row[key], false, `${key} must remain false`);
}

function readySlot(target) {
  return {
    slot_id: target.slot_id,
    source_head: target.source_head,
    guardian_manifest_sha256: target.guardian_manifest_sha256,
    service_binary_sha256: target.service_binary_sha256,
    configurator_binary_sha256: target.configurator_binary_sha256,
    files_exact: true,
    acl_machine_secure: true,
    final_path_inside_machine_root: true,
  };
}

test('external stop is terminal for bootstrap planning without acquiring effect authority', () => {
  const row = planBrowserGuardianBootstrap({ externalStop: true, release: release() });
  assert.equal(row.action, 'HOLD_EXTERNAL_STOP');
  assertZeroAuthority(row);
});

test('unverified or authority-bearing release evidence is rejected before a machine plan exists', () => {
  for (const mutated of [
    release({ verified_release: false }),
    release({ physical_n_to_n_plus_1: false }),
    release({ guardian_native_release_assets_verified: false }),
    release({ service_activation_authorized: true }),
    release({ required_machine_root: '%LOCALAPPDATA%\\Programs' }),
    release({ guardian_manifest_sha256: 'bad' }),
  ]) {
    const row = planBrowserGuardianBootstrap({ release: mutated });
    assert.equal(row.action, 'HOLD_RELEASE_UNVERIFIED');
    assertZeroAuthority(row);
  }
});

test('absent target slot produces a copy-only contract from verified release assets', () => {
  const row = planBrowserGuardianBootstrap({ release: release(), observed: { service: { exists: false }, slots: [] } });
  assert.equal(row.action, 'COPY_EXACT_RELEASE_ASSETS');
  assert.equal(row.copy_contract.source, 'VERIFIED_RELEASE_ASSETS_ONLY');
  assert.equal(row.copy_contract.overwrite_existing, false);
  assert.equal(row.copy_contract.require_sha256_readback, true);
  assert.equal(row.copy_contract.require_machine_acl_readback, true);
  assert.match(row.target.slot_path, /^%ProgramFiles%\\METAENGINE\\Guardian\\slots\\/);
  assert.doesNotMatch(JSON.stringify(row), /LOCALAPPDATA/i);
  assertZeroAuthority(row);
});

test('an existing slot with identity drift is quarantined instead of overwritten', () => {
  const first = planBrowserGuardianBootstrap({ release: release(), observed: { service: { exists: false }, slots: [] } });
  const row = planBrowserGuardianBootstrap({
    release: release(),
    observed: {
      service: { exists: false },
      slots: [{ ...readySlot(first.target), service_binary_sha256: '5'.repeat(64) }],
    },
  });
  assert.equal(row.action, 'HOLD_SLOT_IDENTITY_DRIFT');
  assertZeroAuthority(row);
});

test('incomplete slot never advances to SCM configuration', () => {
  const first = planBrowserGuardianBootstrap({ release: release(), observed: { service: { exists: false }, slots: [] } });
  const row = planBrowserGuardianBootstrap({
    release: release(),
    observed: { service: { exists: false }, slots: [{ ...readySlot(first.target), acl_machine_secure: false }] },
  });
  assert.equal(row.action, 'VERIFY_TARGET_SLOT');
  assertZeroAuthority(row);
});

test('exact machine-secure slot with no service is the only initial SCM configuration candidate', () => {
  const first = planBrowserGuardianBootstrap({ release: release(), observed: { service: { exists: false }, slots: [] } });
  const row = planBrowserGuardianBootstrap({
    release: release(),
    observed: { service: { exists: false }, slots: [readySlot(first.target)] },
  });
  assert.equal(row.action, 'APPLY_SCM_CONFIG_EXACT_SLOT');
  assert.equal(row.target.service_binary_sha256, SERVICE_SHA);
  assertZeroAuthority(row);
});

test('exact active service and exact slot are a no-op', () => {
  const first = planBrowserGuardianBootstrap({ release: release(), observed: { service: { exists: false }, slots: [] } });
  const slot = readySlot(first.target);
  const row = planBrowserGuardianBootstrap({
    release: release(),
    observed: {
      slots: [slot],
      service: {
        exists: true,
        service_name: 'METAENGINEBrowserGuardian',
        account: 'LocalSystem',
        service_type: 'SERVICE_WIN32_OWN_PROCESS',
        binary_path: `${first.target.slot_path}\\METAENGINEBrowserGuardian.exe`,
        binary_sha256: SERVICE_SHA,
        machine_secure_path: true,
      },
    },
  });
  assert.equal(row.action, 'NOOP_ACTIVE_EXACT');
  assertZeroAuthority(row);
});

test('active old or different Guardian is never replaced by raw bootstrap planning', () => {
  const first = planBrowserGuardianBootstrap({ release: release(), observed: { service: { exists: false }, slots: [] } });
  const row = planBrowserGuardianBootstrap({
    release: release(),
    observed: {
      slots: [readySlot(first.target)],
      service: {
        exists: true,
        service_name: 'METAENGINEBrowserGuardian',
        account: 'LocalSystem',
        service_type: 'SERVICE_WIN32_OWN_PROCESS',
        binary_path: '%ProgramFiles%\\METAENGINE\\Guardian\\slots\\old\\METAENGINEBrowserGuardian.exe',
        binary_sha256: '6'.repeat(64),
        machine_secure_path: true,
      },
    },
  });
  assert.equal(row.action, 'HOLD_EXISTING_SERVICE_DIFFERENT_RELEASE');
  assert.equal(row.reason, 'EXACT_REPLACEMENT_PROTOCOL_REQUIRED');
  assertZeroAuthority(row);
});

test('service identity and machine path drift fail closed before any copy/config transition', () => {
  for (const service of [
    { exists: true, service_name: 'Other', account: 'LocalSystem', service_type: 'SERVICE_WIN32_OWN_PROCESS', machine_secure_path: true },
    { exists: true, service_name: 'METAENGINEBrowserGuardian', account: 'User', service_type: 'SERVICE_WIN32_OWN_PROCESS', machine_secure_path: true },
    { exists: true, service_name: 'METAENGINEBrowserGuardian', account: 'LocalSystem', service_type: 'SERVICE_WIN32_OWN_PROCESS', machine_secure_path: false },
  ]) {
    const row = planBrowserGuardianBootstrap({ release: release(), observed: { service, slots: [] } });
    assert.equal(row.action, 'HOLD_SERVICE_IDENTITY_DRIFT');
    assertZeroAuthority(row);
  }
});

test('target digest is deterministic and changes with exact release identity', () => {
  const a = planBrowserGuardianBootstrap({ release: release(), observed: { service: { exists: false }, slots: [] } });
  const b = planBrowserGuardianBootstrap({ release: release(), observed: { service: { exists: false }, slots: [] } });
  assert.equal(digestBrowserGuardianBootstrapTarget(a.target), digestBrowserGuardianBootstrapTarget(b.target));
  const c = { ...a.target, service_binary_sha256: '7'.repeat(64) };
  assert.notEqual(digestBrowserGuardianBootstrapTarget(a.target), digestBrowserGuardianBootstrapTarget(c));
});
