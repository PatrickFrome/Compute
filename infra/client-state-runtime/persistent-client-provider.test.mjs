import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { provisionPersistentClientProvider } from './persistent-client-provider.mjs';
import { localStateProviderOwnerFile, validateLocalStateProviderConfig } from '../../apps/metaengine-browser/src/local-state-provider-policy.mjs';

async function options(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-provider-owner-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const appDataDirectory = path.join(directory, 'appdata');
  return { ownerChoice: 'LOCAL_POSTGRES', appDataDirectory,
    ownerFile: localStateProviderOwnerFile({ env: { APPDATA: appDataDirectory }, platform: 'win32' }),
    baseUrl: 'http://127.0.0.1:25433/a2-browser-native-supervisor-v1',
    runtimeIdentityFile: path.join(directory, 'runtime-instance.json'),
    runtimeHost: { bundle_directory: path.join(directory, 'offline-resources'),
      expected_bundle_sha256: 'a'.repeat(64), config_file: path.join(directory, 'private-runtime-config.json') } };
}

test('owner explicitly provisions only the managed host path/digest and retains the external provider contract', async t => {
  const input = await options(t);
  // Provisioning requires owner choice but does not read the private server
  // configuration, initialize/restore a database or start any subprocess.
  const result = await provisionPersistentClientProvider(input);
  assert.equal(result.state, 'CONFIGURED');
  assert.deepEqual(result.config.runtime_host, input.runtimeHost);
  assert.doesNotMatch(JSON.stringify(result), /password|service_role|credentials/);
  const saved = validateLocalStateProviderConfig(JSON.parse(await fs.readFile(input.ownerFile, 'utf8')));
  assert.deepEqual(saved, result.config);
  assert.equal((await provisionPersistentClientProvider(input)).state, 'ALREADY_CONFIGURED');
  await assert.rejects(fs.stat(input.runtimeHost.config_file), { code: 'ENOENT' });
  await assert.rejects(provisionPersistentClientProvider({ ...input, runtimeHost: { ...input.runtimeHost, password: 'secret' } }), /runtime_host_shape_invalid/);
  await assert.rejects(provisionPersistentClientProvider({ ...input, ownerChoice: undefined }), /owner_choice_required/);
});

test('external-only owner configurations remain compatible and managed host replacement requires explicit replacement', async t => {
  const input = await options(t);
  const { runtimeHost, ...external } = input;
  const result = await provisionPersistentClientProvider(external);
  assert.equal(Object.hasOwn(result.config, 'runtime_host'), false);
  await assert.rejects(provisionPersistentClientProvider(input), /owner_file_exists/);
  assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(input.ownerFile, 'utf8')), 'runtime_host'), false);
  await assert.rejects(provisionPersistentClientProvider({ ...input, replaceExisting: true }),
    /owner_replacement_requires_verified_cas/);
  assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(input.ownerFile, 'utf8')), 'runtime_host'), false);
});

test('malformed owner remains untouched even when a replacement was explicitly requested', async t => {
  const input = await options(t);
  await fs.mkdir(path.dirname(input.ownerFile), { recursive: true });
  const original = '{malformed owner bytes';
  await fs.writeFile(input.ownerFile, original);
  await assert.rejects(provisionPersistentClientProvider({ ...input, replaceExisting: true }), /existing_file_invalid/);
  assert.equal(await fs.readFile(input.ownerFile, 'utf8'), original);
});

test('hardlinked existing owner and symlinked ancestor are rejected without modifying target', async t => {
  const input = await options(t);
  await provisionPersistentClientProvider(input);
  const linked = path.join(path.dirname(input.appDataDirectory), 'shared-owner-link.json');
  await fs.link(input.ownerFile, linked);
  await assert.rejects(provisionPersistentClientProvider(input), /existing_file_invalid/);
  await fs.rm(linked);
  const symlinkInput = await options(t);
  const other = path.join(path.dirname(symlinkInput.appDataDirectory), 'actual-appdata');
  await fs.mkdir(other);
  await fs.symlink(other, symlinkInput.appDataDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(provisionPersistentClientProvider(symlinkInput), /owner_directory_invalid/);
  await assert.rejects(fs.stat(symlinkInput.ownerFile), { code: 'ENOENT' });
});

test('parallel initial publication never overwrites or leaves a temporary owner file', async t => {
  const input = await options(t);
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => provisionPersistentClientProvider(input)));
  assert(results.some(result => result.status === 'fulfilled' && result.value.state === 'CONFIGURED'));
  assert(results.every(result => result.status === 'fulfilled' || result.reason?.code === 'EEXIST'));
  assert.deepEqual(validateLocalStateProviderConfig(JSON.parse(await fs.readFile(input.ownerFile, 'utf8'))).runtime_host, input.runtimeHost);
  const files = await fs.readdir(path.dirname(input.ownerFile));
  assert.deepEqual(files, [path.basename(input.ownerFile)]);
});
