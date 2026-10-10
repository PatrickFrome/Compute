import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runtimeProviderDescriptor, stageManagedDenoCache, startManagedRuntimeHost, validateRuntimeHostConfig, validateRuntimeHostPhysicalBoundaries } from './runtime-host.mjs';

const hostEntry = fileURLToPath(new URL('./runtime-host.mjs', import.meta.url));
const configValue = root => ({ schema: 'compute.runtime-host-config.v1', version: 1,
  bundle_directory: path.join(root, 'bundle'), expected_bundle_sha256: 'a'.repeat(64),
  state_directory: path.join(root, 'state'), pg_data_directory: path.join(root, 'state/data'),
  database_url: 'postgresql://synthetic:private-password@127.0.0.1:25434/fixture',
  inspect_database_url: 'postgresql://synthetic:private-password@127.0.0.1:25434/fixture',
  api_port: 25432, edge_port: 25433, startup_timeout_ms: 1000 });

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'compute-host-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = { ...configValue(root), ...overrides };
  await mkdir(config.bundle_directory, { recursive: true });
  await mkdir(config.pg_data_directory, { recursive: true });
  await writeFile(path.join(config.pg_data_directory, 'PG_VERSION'), '17\n');
  await writeFile(path.join(config.pg_data_directory, 'client-vault.key'), 'b'.repeat(64) + '\n');
  const configFile = path.join(root, 'private-config.json');
  await writeFile(configFile, JSON.stringify(config));
  const verified = { manifest: { reviewed_startup_files_sha256: 'c'.repeat(64) }, paths: {
    hostEntry, nodeExecutable: process.execPath, postgresBinDirectory: root, denoExecutable: process.execPath, denoDirectory: root } };
  let finish;
  let calls = 0;
  const finished = new Promise(resolve => { finish = resolve; });
  const runtime = { endpoint: 'http://127.0.0.1:25433/a2-browser-native-supervisor-v1', instanceId: randomUUID(),
    edgeHealth: { runtime_ready: true, state_provider: 'LOCAL_POSTGRES', hosted_supabase_required: false,
      capability_health: { state: 'ATTESTED', authority_effect: false } }, children: [],
    startupManifest: { source_manifest_sha256: 'd'.repeat(64) }, finished,
    stop: async reason => { calls += 1; const outcome = { reason, children_stopped: true }; finish(outcome); return outcome; } };
  return { root, config, configFile, runtime, verified, finish, stopCalls: () => calls,
    hooks: { verifyBundle: async () => verified, stageDenoCache: async () => root, launchRuntime: async () => runtime } };
}

test('host rejects private-state overlap, extra config fields and unqualified providers', () => {
  const root = path.resolve(os.tmpdir(), 'synthetic-host-config');
  const good = configValue(root);
  assert.equal(validateRuntimeHostConfig(good).state_directory, good.state_directory);
  assert.throws(() => validateRuntimeHostConfig({ ...good, extra: true }), /config_contract_invalid/);
  assert.throws(() => validateRuntimeHostConfig({ ...good, state_directory: good.bundle_directory }), /private_state_boundary_invalid/);
  assert.throws(() => validateRuntimeHostConfig({ ...good, expected_bundle_sha256: 'bad' }), /bundle_pin_required/);
  assert.throws(() => runtimeProviderDescriptor({ instanceId: randomUUID(), edgeHealth: { runtime_ready: true } }), /provider_unattested/);
});

test('attached host mode permits an independent PGDATA and rejects ambiguous ownership', () => {
  const root = path.resolve(os.tmpdir(), 'synthetic-attached-host-config');
  const attached = { ...configValue(root), postgres_mode: 'attached', api_role_mode: 'direct', expected_cluster_system_identifier: '7654321098765432100', pg_data_directory: path.join(root, 'keeper-data') };
  assert.equal(validateRuntimeHostConfig(attached).postgres_mode, 'attached');
  assert.equal(validateRuntimeHostConfig(attached).api_role_mode, 'direct');
  for (const api_role_mode of ['service_role', undefined]) {
    assert.throws(() => validateRuntimeHostConfig({ ...attached, api_role_mode }), /attached_direct_api_required|api_role_mode_invalid/);
  }
  const { api_role_mode, ...unselectedRole } = attached;
  assert.throws(() => validateRuntimeHostConfig(unselectedRole), /attached_direct_api_required/);
  assert.throws(() => validateRuntimeHostConfig({ ...attached, api_role_mode: 'superuser' }), /api_role_mode_invalid/);
  assert.throws(() => validateRuntimeHostConfig({ ...attached, expected_cluster_system_identifier: undefined }), /cluster_identity_pin_required/);
  assert.equal(validateRuntimeHostPhysicalBoundaries({
    bundleDirectory: attached.bundle_directory, stateDirectory: attached.state_directory,
    pgDataDirectory: attached.pg_data_directory, privateConfigFile: path.join(root, 'private.json'),
    repositoryDirectory: path.join(root, 'checkout'), postgresMode: 'attached',
  }), true);
  assert.throws(() => validateRuntimeHostConfig({ ...attached, postgres_mode: 'unknown' }), /postgres_mode_invalid/);
  assert.throws(() => validateRuntimeHostConfig({ ...attached, pg_data_directory: attached.state_directory }), /private_state_boundary_invalid/);
  const sourceDirectory = path.resolve(path.dirname(hostEntry), '../..');
  assert.throws(() => validateRuntimeHostConfig({ ...attached, pg_data_directory: path.join(sourceDirectory, 'pgdata') }), /private_state_boundary_invalid/);
  for (const pgDataDirectory of [path.join(root, 'checkout', 'pgdata'), root]) {
    assert.throws(() => validateRuntimeHostPhysicalBoundaries({
      bundleDirectory: attached.bundle_directory, stateDirectory: attached.state_directory,
      pgDataDirectory, privateConfigFile: path.join(root, 'private.json'),
      repositoryDirectory: path.join(root, 'checkout'), postgresMode: 'attached',
    }), /private_state_boundary_invalid/);
  }
  assert.throws(() => validateRuntimeHostPhysicalBoundaries({
    bundleDirectory: attached.bundle_directory, stateDirectory: attached.state_directory,
    pgDataDirectory: attached.pg_data_directory, privateConfigFile: path.join(root, 'private.json'),
    repositoryDirectory: path.join(root, 'checkout'), postgresMode: 'unknown',
  }), /postgres_mode_invalid/);
});

test('physical directory identity fences short-name aliases and private PGDATA overlap', () => {
  // The normalized names stand in for realpath() results of two distinct path
  // spellings (e.g. RUNNER~1 and runneradmin). Works on Windows and Linux
  // without relying on 8.3 short-name generation by the test runner.
  const root = path.resolve(os.tmpdir(), 'physical-boundary-fixture');
  const bundleDirectory = path.join(root, 'actual', 'bundle');
  const stateDirectory = path.join(root, 'actual', 'private');
  const pgDataDirectory = path.join(stateDirectory, 'pgdata');
  const privateConfigFile = path.join(root, 'private-config.json');
  const repositoryDirectory = path.join(root, 'checkout');
  const physical = { bundleDirectory, stateDirectory, pgDataDirectory, privateConfigFile, repositoryDirectory };
  assert.equal(validateRuntimeHostPhysicalBoundaries(physical), true);
  const aliasedState = path.join(bundleDirectory, 'private');
  assert.throws(() => validateRuntimeHostPhysicalBoundaries({
    ...physical, stateDirectory: aliasedState, pgDataDirectory: path.join(aliasedState, 'pgdata'),
  }), /runtime_host_private_state_boundary_invalid/);
  assert.throws(() => validateRuntimeHostPhysicalBoundaries({
    ...physical, privateConfigFile: path.join(bundleDirectory, 'credentials.json'),
  }), /runtime_host_private_config_boundary_invalid/);
  assert.throws(() => validateRuntimeHostPhysicalBoundaries({
    ...physical, stateDirectory: path.join(repositoryDirectory, 'private'),
    pgDataDirectory: path.join(repositoryDirectory, 'private', 'pgdata'),
  }), /runtime_host_private_state_boundary_invalid/);
  assert.throws(() => validateRuntimeHostPhysicalBoundaries({
    ...physical, pgDataDirectory: path.join(root, 'foreign-pgdata'),
  }), /runtime_host_private_state_boundary_invalid/);
});

test('host owns one lock, publishes public status and idempotently stops its runtime', async t => {
  const f = await fixture(t);
  const host = await startManagedRuntimeHost({ configFile: f.configFile }, f.hooks);
  assert.equal(Object.keys(host.descriptor).length, 9);
  assert.equal(host.descriptor.status_file, path.join(f.config.state_directory, 'runtime-instance.json'));
  const status = JSON.parse(await readFile(host.statusFile, 'utf8'));
  assert.equal(status.state, 'READY');
  assert.equal(status.instance_id, f.runtime.instanceId);
  assert.equal(JSON.stringify(status).includes('private-password'), false);
  await assert.rejects(startManagedRuntimeHost({ configFile: f.configFile }, f.hooks), /owner_lock_exists/);
  const stopping = host.stop();
  assert.equal(host.stop(), stopping);
  await stopping;
  await host.finished;
  assert.equal(f.stopCalls(), 1);
  await assert.rejects(readFile(path.join(f.config.state_directory, 'runtime-host-lock.json')), { code: 'ENOENT' });
  assert.equal(JSON.parse(await readFile(host.statusFile, 'utf8')).state, 'STOPPED');
});

test('attached host passes through mode and shutdown never claims the external PostgreSQL', async t => {
  const f = await fixture(t, { postgres_mode: 'attached', api_role_mode: 'direct', expected_cluster_system_identifier: '7654321098765432100', pg_data_directory: path.join(os.tmpdir(), `compute-attached-data-${randomUUID()}`) });
  t.after(() => rm(f.config.pg_data_directory, { recursive: true, force: true }));
  await mkdir(f.config.state_directory, { recursive: true });
  await writeFile(path.join(f.config.state_directory, 'PG_VERSION'), '17\n');
  await writeFile(path.join(f.config.state_directory, 'client-vault.key'), 'b'.repeat(64) + '\n');
  let launched;
  const hooks = { ...f.hooks, launchRuntime: async config => { launched = config; return f.runtime; } };
  const host = await startManagedRuntimeHost({ configFile: f.configFile }, hooks);
  assert.equal(launched.postgresMode, 'attached');
  assert.equal(launched.apiRoleMode, 'direct');
  assert.equal(launched.expectedClusterSystemIdentifier, '7654321098765432100');
  assert.equal(JSON.parse(await readFile(host.statusFile, 'utf8')).postgres_mode, 'attached');
  assert.equal(JSON.parse(await readFile(host.statusFile, 'utf8')).api_role_mode, 'direct');
  assert.equal(f.runtime.children.some(child => child.name === 'postgres'), false);
  await host.stop();
  await host.finished;
  assert.equal(f.stopCalls(), 1);
});

test('resource path mismatch refuses launch and an already cancelled startup releases ownership', async t => {
  const f = await fixture(t);
  let launches = 0;
  const hooks = { ...f.hooks, launchRuntime: async () => { launches += 1; return f.runtime; } };
  await assert.rejects(startManagedRuntimeHost({ configFile: f.configFile }, { ...hooks, executablePath: f.configFile }), /execution_resource_mismatch/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(startManagedRuntimeHost({ configFile: f.configFile, signal: controller.signal }, hooks), /startup_cancelled/);
  assert.equal(launches, 0);
  await assert.rejects(readFile(path.join(f.config.state_directory, 'runtime-host-lock.json')), { code: 'ENOENT' });
});

test('startup cancellation relays into launcher and cleans every acquired resource', async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  const hooks = { ...f.hooks, launchRuntime: async config => {
    assert.equal(config.includeRuntimeHost, true);
    assert.equal(config.expectedStartupFilesSha256, f.verified.manifest.reviewed_startup_files_sha256);
    assert.equal(config.expectedStartupSourceSha256, undefined, 'resource pin must not depend on fixture mode or ports');
    assert.equal(config.signal, controller.signal);
    controller.abort();
    return f.runtime;
  } };
  await assert.rejects(startManagedRuntimeHost({ configFile: f.configFile, signal: controller.signal }, hooks), /startup_cancelled/);
  assert.equal(f.stopCalls(), 1);
  await assert.rejects(readFile(path.join(f.config.state_directory, 'runtime-host-lock.json')), { code: 'ENOENT' });
});

test('child failure stops provider readiness; unconfirmed cleanup retains exclusive ownership', async t => {
  const f = await fixture(t);
  const host = await startManagedRuntimeHost({ configFile: f.configFile }, f.hooks);
  f.finish({ reason: 'edge_exited', children_stopped: false });
  await host.finished;
  const status = JSON.parse(await readFile(host.statusFile, 'utf8'));
  assert.equal(status.state, 'FAILED');
  assert.equal(status.runtime_ready, false);
  assert.equal(status.reason, 'runtime_host_cleanup_unconfirmed');
  const lock = JSON.parse(await readFile(path.join(f.config.state_directory, 'runtime-host-lock.json'), 'utf8'));
  assert.equal(lock.pid, process.pid);
  await assert.rejects(startManagedRuntimeHost({ configFile: f.configFile }, f.hooks), /owner_lock_exists/);
});

test('replaced owner lock is never erased by shutdown', async t => {
  const f = await fixture(t);
  const host = await startManagedRuntimeHost({ configFile: f.configFile }, f.hooks);
  const lockFile = path.join(f.config.state_directory, 'runtime-host-lock.json');
  await writeFile(lockFile, 'replacement-owner');
  await assert.rejects(host.stop(), /owner_lock_changed/);
  await assert.rejects(host.finished, /owner_lock_changed/);
  assert.equal(await readFile(lockFile, 'utf8'), 'replacement-owner');
});

test('host copies verified dependency bytes into a private writable cache without changing the bundle', async t => {
  const f = await fixture(t);
  const bytes = Buffer.from('{"name":"postgres","version":"3.4.7"}');
  const relative = 'npm/registry.npmjs.org/postgres/3.4.7/package.json';
  const source = path.join(f.root, 'resource-cache', relative);
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, bytes);
  const verified = { manifest: { files: [{ component: 'deno_cache', path: 'runtime/deno-cache/' + relative,
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }] }, paths: { denoDirectory: path.join(f.root, 'resource-cache') } };
  const options = { verified, stateDirectory: f.config.state_directory };
  const cache = await stageManagedDenoCache(options);
  assert.equal(cache, path.join(f.config.state_directory, 'deno-cache'));
  const target = path.join(cache, relative);
  assert.deepEqual(await readFile(target), bytes);
  await mkdir(path.join(cache, 'gen'));
  await writeFile(path.join(cache, 'gen/compiled-cache'), 'private-generated-cache');
  assert.equal(await stageManagedDenoCache(options), cache);
  assert.deepEqual(await readFile(source), bytes);
  await writeFile(target, 'mutated-private-dependency');
  await assert.rejects(stageManagedDenoCache(options), /dependency_cache_changed/);
});

test('cache staging rejects changed source bytes and private-cache directory aliases before launch', async t => {
  const f = await fixture(t);
  const source = path.join(f.root, 'resource-cache/package.json');
  await mkdir(path.dirname(source));
  await writeFile(source, 'changed-source');
  const verified = { manifest: { files: [{ component: 'deno_cache', path: 'runtime/deno-cache/package.json',
    bytes: 1, sha256: 'a'.repeat(64) }] }, paths: { denoDirectory: path.dirname(source) } };
  await assert.rejects(stageManagedDenoCache({ verified, stateDirectory: f.config.state_directory }), /dependency_cache_source_changed/);
  await rm(path.join(f.config.state_directory, 'deno-cache'), { recursive: true });
  await symlink(path.dirname(source), path.join(f.config.state_directory, 'deno-cache'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(stageManagedDenoCache({ verified, stateDirectory: f.config.state_directory }), /path_invalid/);
});
