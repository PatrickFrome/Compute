import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_GUARDIAN_BOOTSTRAP_PROTOCOL_GENERATION,
  BROWSER_GUARDIAN_RELEASE_BUNDLE_SCHEMA,
  digestBrowserGuardianBootstrapTarget,
  planBrowserGuardianBootstrap,
  verifyBrowserGuardianReleaseBundle,
} from '../src/browser-guardian-bootstrap-plan.mjs';

const SERVICE_SHA = '1'.repeat(64);
const CONFIG_SHA = '2'.repeat(64);
const MANIFEST_SHA = '3'.repeat(64);
const SOURCE_HEAD = '4'.repeat(40);
const VERIFIED_SHA = '5'.repeat(64);
const VERSION = '0.6.6-dev.12345.1';
const VERIFIED_SIZE = 4100;
const GUARDIAN_MANIFEST_SIZE = 1900;
const SERVICE_SIZE = 1000;
const CONFIG_SIZE = 2000;

function releaseBundle() {
  const verifiedManifest = {
    schema: 'metaengine.browser.self-update-e2e-manifest.v2',
    git_sha: SOURCE_HEAD,
    version: VERSION,
    update_channel: 'dev',
    production_safe: false,
    physical_n_to_n_plus_1: true,
    guardian_native_staging_present: true,
    guardian_native_staging_verified: true,
    guardian_native_no_activation: true,
    guardian_native_requires_machine_secure_copy: true,
    guardian_native_release_assets_verified: true,
    guardian_native_manifest_sha256: MANIFEST_SHA,
    guardian_native_package_version: VERSION,
  };
  const guardianManifest = {
    schema: 'metaengine.browser.guardian-native-staging-manifest.v1',
    source_head: SOURCE_HEAD,
    package_version: VERSION,
    staging_only: true,
    service_activation_authorized: false,
    service_installation_authorized: false,
    service_start_authorized: false,
    user_writable_service_activation_forbidden: true,
    requires_machine_secure_copy: true,
    required_machine_root: '%ProgramFiles%\\METAENGINE\\Guardian',
    exact_service_binary_name: 'METAENGINEBrowserGuardian.exe',
    authority_effect: false,
    binaries: [
      { name: 'METAENGINEBrowserGuardian.exe', sha256: SERVICE_SHA, size: SERVICE_SIZE, staged_only: true },
      { name: 'METAENGINEBrowserGuardianConfigure.exe', sha256: CONFIG_SHA, size: CONFIG_SIZE, staged_only: true },
    ],
  };
  return {
    schema: BROWSER_GUARDIAN_RELEASE_BUNDLE_SCHEMA,
    verified_self_update: { sha256: VERIFIED_SHA, size: VERIFIED_SIZE, manifest: verifiedManifest },
    guardian_native: { sha256: MANIFEST_SHA, size: GUARDIAN_MANIFEST_SIZE, manifest: guardianManifest },
    github_release: {
      draft: false,
      prerelease: true,
      tag_name: `v${VERSION}`,
      target_commitish: SOURCE_HEAD,
      assets: [
        { name: 'verified-self-update-manifest.json', digest: `sha256:${VERIFIED_SHA}`, size: VERIFIED_SIZE },
        { name: 'guardian-native-staging-manifest.json', digest: `sha256:${MANIFEST_SHA}`, size: GUARDIAN_MANIFEST_SIZE },
        { name: 'METAENGINEBrowserGuardian.exe', digest: `sha256:${SERVICE_SHA}`, size: SERVICE_SIZE },
        { name: 'METAENGINEBrowserGuardianConfigure.exe', digest: `sha256:${CONFIG_SHA}`, size: CONFIG_SIZE },
        { name: 'dev.yml', digest: `sha256:${'6'.repeat(64)}`, size: 500 },
      ],
    },
  };
}

function mutate(bundle, fn) {
  const copy = structuredClone(bundle);
  fn(copy);
  return copy;
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

test('release bundle cross-binds physical manifest, Guardian manifest, and exact GitHub assets', () => {
  const proof = verifyBrowserGuardianReleaseBundle(releaseBundle());
  assert.equal(proof.ok, true);
  assert.equal(proof.source_head, SOURCE_HEAD);
  assert.equal(proof.version, VERSION);
  assert.equal(proof.verified_self_update_manifest_sha256, VERIFIED_SHA);
  assert.equal(proof.guardian_manifest_sha256, MANIFEST_SHA);
  assert.equal(proof.github_tag, `v${VERSION}`);
  assert.deepEqual(proof.binaries.map((row) => row.name), ['METAENGINEBrowserGuardian.exe', 'METAENGINEBrowserGuardianConfigure.exe']);
  assert.equal(proof.authority_effect, false);
});

test('release bundle rejects incomplete physical proof instead of trusting a flattened verified flag', () => {
  const fields = [
    'physical_n_to_n_plus_1',
    'guardian_native_staging_present',
    'guardian_native_staging_verified',
    'guardian_native_no_activation',
    'guardian_native_requires_machine_secure_copy',
    'guardian_native_release_assets_verified',
  ];
  for (const field of fields) {
    const proof = verifyBrowserGuardianReleaseBundle(mutate(releaseBundle(), (row) => { row.verified_self_update.manifest[field] = false; }));
    assert.equal(proof.ok, false);
    assert.match(proof.reason, /^VERIFIED_MANIFEST_FIELD_MISSING:/);
  }
});

test('release bundle rejects source, version, channel and machine-root drift', () => {
  const cases = [
    mutate(releaseBundle(), (row) => { row.github_release.target_commitish = 'a'.repeat(40); }),
    mutate(releaseBundle(), (row) => { row.github_release.tag_name = 'v0.6.6-dev.999.1'; }),
    mutate(releaseBundle(), (row) => { row.guardian_native.manifest.source_head = 'b'.repeat(40); }),
    mutate(releaseBundle(), (row) => { row.guardian_native.manifest.package_version = '0.6.6-dev.999.1'; }),
    mutate(releaseBundle(), (row) => { row.verified_self_update.manifest.update_channel = 'stable'; }),
    mutate(releaseBundle(), (row) => { row.verified_self_update.manifest.production_safe = true; }),
    mutate(releaseBundle(), (row) => { row.guardian_native.manifest.required_machine_root = '%LOCALAPPDATA%\\Programs'; }),
  ];
  for (const bundle of cases) assert.equal(verifyBrowserGuardianReleaseBundle(bundle).ok, false);
});

test('release bundle rejects activation-bearing Guardian evidence', () => {
  for (const field of ['service_activation_authorized', 'service_installation_authorized', 'service_start_authorized']) {
    const proof = verifyBrowserGuardianReleaseBundle(mutate(releaseBundle(), (row) => { row.guardian_native.manifest[field] = true; }));
    assert.equal(proof.ok, false);
    assert.equal(proof.reason, 'RELEASE_AUTHORITY_BOUNDARY_INVALID');
  }
});

test('release bundle rejects Guardian manifest byte digest drift', () => {
  const proof = verifyBrowserGuardianReleaseBundle(mutate(releaseBundle(), (row) => {
    row.guardian_native.sha256 = '7'.repeat(64);
  }));
  assert.equal(proof.ok, false);
  assert.equal(proof.reason, 'GUARDIAN_MANIFEST_DIGEST_DRIFT');
});

test('release bundle rejects missing, duplicate, digest-drifted and size-drifted native release assets', () => {
  const missing = mutate(releaseBundle(), (row) => {
    row.github_release.assets = row.github_release.assets.filter((asset) => asset.name !== 'METAENGINEBrowserGuardian.exe');
  });
  assert.equal(verifyBrowserGuardianReleaseBundle(missing).reason, 'RELEASE_ASSET_MISSING:METAENGINEBrowserGuardian.exe');

  const duplicate = mutate(releaseBundle(), (row) => {
    row.github_release.assets.push(structuredClone(row.github_release.assets.find((asset) => asset.name === 'METAENGINEBrowserGuardian.exe')));
  });
  assert.equal(verifyBrowserGuardianReleaseBundle(duplicate).reason, 'RELEASE_ASSET_DUPLICATE');

  const digest = mutate(releaseBundle(), (row) => {
    row.github_release.assets.find((asset) => asset.name === 'METAENGINEBrowserGuardian.exe').digest = `sha256:${'8'.repeat(64)}`;
  });
  assert.equal(verifyBrowserGuardianReleaseBundle(digest).reason, 'RELEASE_ASSET_DIGEST_DRIFT:METAENGINEBrowserGuardian.exe');

  const size = mutate(releaseBundle(), (row) => {
    row.github_release.assets.find((asset) => asset.name === 'METAENGINEBrowserGuardianConfigure.exe').size += 1;
  });
  assert.equal(verifyBrowserGuardianReleaseBundle(size).reason, 'RELEASE_ASSET_SIZE_DRIFT:METAENGINEBrowserGuardianConfigure.exe');
});

test('draft or non-prerelease GitHub release cannot become bootstrap authority', () => {
  for (const bundle of [
    mutate(releaseBundle(), (row) => { row.github_release.draft = true; }),
    mutate(releaseBundle(), (row) => { row.github_release.prerelease = false; }),
  ]) {
    const proof = verifyBrowserGuardianReleaseBundle(bundle);
    assert.equal(proof.ok, false);
    assert.equal(proof.reason, 'GITHUB_RELEASE_STATE_INVALID');
  }
});

test('external stop is terminal for bootstrap planning without acquiring effect authority', () => {
  const row = planBrowserGuardianBootstrap({ externalStop: true, release: releaseBundle() });
  assert.equal(row.action, 'HOLD_EXTERNAL_STOP');
  assertZeroAuthority(row);
});

test('unverified release bundle is held before a machine plan exists', () => {
  const row = planBrowserGuardianBootstrap({
    release: mutate(releaseBundle(), (bundle) => { bundle.github_release.assets[0].digest = `sha256:${'9'.repeat(64)}`; }),
  });
  assert.equal(row.action, 'HOLD_RELEASE_UNVERIFIED');
  assert.equal(row.reason, 'RELEASE_ASSET_DIGEST_DRIFT:verified-self-update-manifest.json');
  assertZeroAuthority(row);
});

test('absent target slot produces copy-only contract from exact verified GitHub release assets', () => {
  const row = planBrowserGuardianBootstrap({ release: releaseBundle(), observed: { service: { exists: false }, slots: [] } });
  assert.equal(row.action, 'COPY_EXACT_RELEASE_ASSETS');
  assert.equal(row.copy_contract.source, 'VERIFIED_GITHUB_RELEASE_ASSETS_ONLY');
  assert.equal(row.copy_contract.source_tag, `v${VERSION}`);
  assert.equal(row.copy_contract.overwrite_existing, false);
  assert.equal(row.copy_contract.require_sha256_readback, true);
  assert.equal(row.copy_contract.require_size_readback, true);
  assert.equal(row.copy_contract.require_machine_acl_readback, true);
  assert.match(row.target.slot_path, /^%ProgramFiles%\\METAENGINE\\Guardian\\slots\\/);
  assert.equal(row.target.verified_self_update_manifest_sha256, VERIFIED_SHA);
  assert.doesNotMatch(JSON.stringify(row), /LOCALAPPDATA/i);
  assertZeroAuthority(row);
});

test('an existing slot with identity drift is quarantined instead of overwritten', () => {
  const first = planBrowserGuardianBootstrap({ release: releaseBundle(), observed: { service: { exists: false }, slots: [] } });
  const row = planBrowserGuardianBootstrap({
    release: releaseBundle(),
    observed: { service: { exists: false }, slots: [{ ...readySlot(first.target), service_binary_sha256: 'a'.repeat(64) }] },
  });
  assert.equal(row.action, 'HOLD_SLOT_IDENTITY_DRIFT');
  assertZeroAuthority(row);
});

test('incomplete slot never advances to SCM configuration', () => {
  const first = planBrowserGuardianBootstrap({ release: releaseBundle(), observed: { service: { exists: false }, slots: [] } });
  const row = planBrowserGuardianBootstrap({
    release: releaseBundle(),
    observed: { service: { exists: false }, slots: [{ ...readySlot(first.target), acl_machine_secure: false }] },
  });
  assert.equal(row.action, 'VERIFY_TARGET_SLOT');
  assertZeroAuthority(row);
});

test('exact machine-secure slot with no service is the only initial SCM configuration candidate', () => {
  const first = planBrowserGuardianBootstrap({ release: releaseBundle(), observed: { service: { exists: false }, slots: [] } });
  const row = planBrowserGuardianBootstrap({
    release: releaseBundle(),
    observed: { service: { exists: false }, slots: [readySlot(first.target)] },
  });
  assert.equal(row.action, 'APPLY_SCM_CONFIG_EXACT_SLOT');
  assert.equal(row.target.service_binary_sha256, SERVICE_SHA);
  assertZeroAuthority(row);
});

test('exact active service and exact slot are a no-op', () => {
  const first = planBrowserGuardianBootstrap({ release: releaseBundle(), observed: { service: { exists: false }, slots: [] } });
  const slot = readySlot(first.target);
  const row = planBrowserGuardianBootstrap({
    release: releaseBundle(),
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
  const first = planBrowserGuardianBootstrap({ release: releaseBundle(), observed: { service: { exists: false }, slots: [] } });
  const row = planBrowserGuardianBootstrap({
    release: releaseBundle(),
    observed: {
      slots: [readySlot(first.target)],
      service: {
        exists: true,
        service_name: 'METAENGINEBrowserGuardian',
        account: 'LocalSystem',
        service_type: 'SERVICE_WIN32_OWN_PROCESS',
        binary_path: '%ProgramFiles%\\METAENGINE\\Guardian\\slots\\old\\METAENGINEBrowserGuardian.exe',
        binary_sha256: 'b'.repeat(64),
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
    const row = planBrowserGuardianBootstrap({ release: releaseBundle(), observed: { service, slots: [] } });
    assert.equal(row.action, 'HOLD_SERVICE_IDENTITY_DRIFT');
    assertZeroAuthority(row);
  }
});

test('target digest binds exact release evidence as well as Guardian binary identity', () => {
  const a = planBrowserGuardianBootstrap({ release: releaseBundle(), observed: { service: { exists: false }, slots: [] } });
  const b = planBrowserGuardianBootstrap({ release: releaseBundle(), observed: { service: { exists: false }, slots: [] } });
  assert.equal(digestBrowserGuardianBootstrapTarget(a.target), digestBrowserGuardianBootstrapTarget(b.target));
  assert.notEqual(digestBrowserGuardianBootstrapTarget(a.target), digestBrowserGuardianBootstrapTarget({ ...a.target, service_binary_sha256: 'c'.repeat(64) }));
  assert.notEqual(digestBrowserGuardianBootstrapTarget(a.target), digestBrowserGuardianBootstrapTarget({ ...a.target, verified_self_update_manifest_sha256: 'd'.repeat(64) }));
});
