import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { classifyExistingOwnerPin } from '../scripts/owner-runtime-preinstall-compatibility.mjs';

const installedResources = path.join(os.tmpdir(), 'metaengine-owner-existing-install', 'resources');
const bundlePath = path.join(installedResources, 'client-state-runtime');
const hashA = 'a'.repeat(64), hashB = 'b'.repeat(64);
const candidate = { package_version: '0.7.0-dev.1107139874568.1', bundle_sha256: hashA };
const owner = (pin = hashA, directory = bundlePath) => ({
  schema: 'metaengine.browser.local-state-provider-config.v1',
  version: 1, profile: 'CLIENT_LOCAL_POSTGRES_V1', provider: 'LOCAL_POSTGRES',
  base_url: 'http://127.0.0.1:3041/a2-browser-native-supervisor-v1',
  runtime_identity_file: path.join(os.tmpdir(), 'private-runtime-identity.json'),
  authority_effect: false,
  runtime_host: {
    bundle_directory: directory,
    expected_bundle_sha256: pin,
    config_file: path.join(os.tmpdir(), 'private-pg-config.json'),
  },
});

test('read-only owner compatibility accepts clean genesis and matching exact runtime', () => {
  assert.deepEqual(classifyExistingOwnerPin(null, candidate, installedResources),
    { state: 'NO_OWNER', install_compatible: true });
  assert.deepEqual(classifyExistingOwnerPin(owner(), candidate, installedResources),
    { state: 'OWNER_PIN_MATCHES', install_compatible: true });
});

test('old valid Owner runtime pin fails before any installer effects or automatic rebinding', () => {
  const saved = owner(hashB);
  const before = JSON.stringify(saved);
  assert.throws(() => classifyExistingOwnerPin(saved, candidate, installedResources), /owner_runtime_digest_mismatch/);
  assert.equal(JSON.stringify(saved), before, 'Owner descriptor remains unchanged');
});

test('foreign owner path, malformed pin and unknown Owner shape fail closed', () => {
  assert.throws(() => classifyExistingOwnerPin(owner(hashA, path.join(os.tmpdir(), 'foreign-bundle')), candidate, installedResources),
    /owner_runtime_path_mismatch/);
  assert.throws(() => classifyExistingOwnerPin(owner('not-a-digest'), candidate, installedResources), /owner_config_invalid/);
  assert.throws(() => classifyExistingOwnerPin({}, null, installedResources), /candidate_binding_invalid/);
  assert.throws(() => classifyExistingOwnerPin({ ...owner(), runtime_host: undefined }, candidate, installedResources),
    /owner_config_invalid/);
  assert.throws(() => classifyExistingOwnerPin(owner(), { ...candidate, bundle_sha256: 'unsealed' }, installedResources),
    /candidate_binding_invalid/);
});