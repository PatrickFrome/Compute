import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { link, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { runtimeProviderDescriptor, stageManagedDenoCache, stageManagedDenoExecutable, startManagedRuntimeHost, validateRuntimeHostConfig, validateRuntimeHostPhysicalBoundaries } from './runtime-host.mjs';
import { protectOwnerOnlyWindowsDirectory, verifyOwnerOnlyWindowsStorage } from '../../apps/metaengine-browser/src/private-windows-storage-acl.mjs';
import {runtimeRecoveryPostgresProof} from './runtime-recovery-postgres-proof.mjs';
import { waitForRuntimeHostDescriptor } from './test/runtime-host-readiness.mjs';
import { runtimeHostFailureMessage, runtimeHostTerminalMessage } from './runtime-host-lifecycle.mjs';

const hostEntry = fileURLToPath(new URL('./runtime-host.mjs', import.meta.url));

test('bundled fixture accepts the concrete production provider, not an arbitrary first IPC message', async t => {
  const f = await fixture(t);
  const descriptor = { ...runtimeProviderDescriptor(f.runtime), status_file: path.join(f.config.state_directory, 'runtime-instance.json') };
  const child = new EventEmitter();
  const ready = waitForRuntimeHostDescriptor(child, { expectedEndpoint: descriptor.endpoint, expectedStatusFile: descriptor.status_file });
  child.emit('message', descriptor);
  assert.equal(await ready, descriptor, 'no unwrapping, default readiness, or substituted authority');
  for (const event of ['message', 'error', 'close', 'disconnect']) assert.equal(child.listenerCount(event), 0);
  const terminal = runtimeHostTerminalMessage({ launchNonce: randomUUID(), hostPid: 123,
    outcome: { instance_id: null, children_stopped: true, ownership_released: true, reason: 'runtime_host_start_failed' } });
  for (const [value, reason] of [
    [runtimeHostFailureMessage(null), 'host_failed'],
    [terminal, 'host_stopped_before_ready'],
    [{ descriptor }, 'host_descriptor_invalid'],
    [{ ...descriptor, runtime_ready: undefined }, 'host_descriptor_invalid'],
    [{ ...descriptor, authority_effect: true }, 'host_descriptor_invalid'],
    [{ ...descriptor, automatic_cloud_fallback: true }, 'host_descriptor_invalid'],
    [{ ...descriptor, hosted_supabase_required: true }, 'host_descriptor_invalid'],
    [{ ...descriptor, provider: 'HOSTED_SUPABASE' }, 'host_descriptor_invalid'],
    [{ schema: 'unknown', reason: 'private postgres://synthetic:secret@127.0.0.1/private' }, 'host_descriptor_invalid'],
  ]) {
    const channel = new EventEmitter();
    const result = waitForRuntimeHostDescriptor(channel);
    channel.emit('message', value);
    channel.emit('message', descriptor); // A later positive cannot erase the first refusal.
    await assert.rejects(result, { message: 'bundled_runtime_fixture_' + reason });
    for (const event of ['message', 'error', 'close', 'disconnect']) assert.equal(channel.listenerCount(event), 0);
  }
});

test('bundled fixture enforces exact public descriptor fields and contextual endpoint/status bindings', async t => {
  const f = await fixture(t);
  const descriptor = { ...runtimeProviderDescriptor(f.runtime), status_file: path.join(f.config.state_directory, 'runtime-instance.json') };
  const expected = { expectedEndpoint: descriptor.endpoint, expectedStatusFile: descriptor.status_file };
  const secret = 'postgres://synthetic:do-not-export@127.0.0.1/private';
  const invalid = [null, [], Object.create(descriptor), { ...descriptor, database_url: secret },
    Object.defineProperty({ ...descriptor }, 'private', { value: secret }),
    { ...descriptor, [Symbol('private')]: secret }];
  for (const key of Object.keys(descriptor)) {
    const missing = { ...descriptor }; delete missing[key]; invalid.push(missing);
  }
  for (const endpoint of [undefined, null, 123, secret, 'not a URL',
    'http://localhost:25433/a2-browser-native-supervisor-v1',
    'http://127.1:25433/a2-browser-native-supervisor-v1',
    'http://127.0.0.1:80/a2-browser-native-supervisor-v1',
    'https://127.0.0.1:25433/a2-browser-native-supervisor-v1',
    descriptor.endpoint + '?secret=private', descriptor.endpoint + '#private', descriptor.endpoint + '/',
    ' ' + descriptor.endpoint, descriptor.endpoint.replace('127.0.0.1', 'private:secret@127.0.0.1'),
    descriptor.endpoint.replace('/a2-browser-native-supervisor-v1', '/other'),
  ]) invalid.push({ ...descriptor, endpoint });
  for (const instance_id of [undefined, null, 123, '', 'a'.repeat(36), secret]) invalid.push({ ...descriptor, instance_id });
  for (const status_file of [undefined, null, 123, '', 'runtime-instance.json', secret,
    '//remote/private/runtime-instance.json', '\\\\remote\\private\\runtime-instance.json',
    descriptor.status_file + '\0', path.parse(descriptor.status_file).root,
    path.resolve('a'.repeat(2049)),
  ]) invalid.push({ ...descriptor, status_file });
  // Even direct test doubles with throwing accessors must not leak exceptions.
  invalid.push(Object.defineProperty({ ...descriptor }, 'endpoint', { get() { throw new Error(secret); } }));
  for (const value of invalid) {
    for (const binding of [{}, expected]) {
      const child = new EventEmitter();
      const result = waitForRuntimeHostDescriptor(child, binding);
      child.emit('message', value);
      await assert.rejects(result, error => {
        assert.equal(error.message, 'bundled_runtime_fixture_host_descriptor_invalid');
        assert.equal(String(error.stack).includes(secret), false);
        assert.equal(JSON.stringify(error).includes(secret), false);
        assert.equal(error.cause, undefined);
        return true;
      });
      for (const event of ['message', 'error', 'close', 'disconnect']) assert.equal(child.listenerCount(event), 0);
    }
  }
  for (const value of [
    { ...descriptor, endpoint: descriptor.endpoint.replace(':25433/', ':25435/') },
    { ...descriptor, status_file: path.join(f.root, 'other-runtime-instance.json') },
  ]) {
    const child = new EventEmitter();
    const result = waitForRuntimeHostDescriptor(child, expected);
    child.emit('message', value);
    await assert.rejects(result, { message: 'bundled_runtime_fixture_host_descriptor_invalid' });
  }
  // Existing UUID format permits hex case; impose no new version/authority.
  const upper = { ...descriptor, instance_id: descriptor.instance_id.toUpperCase() };
  const child = new EventEmitter();
  const result = waitForRuntimeHostDescriptor(child, expected);
  child.emit('message', upper);
  assert.equal(await result, upper);
  for (const binding of [{ expectedEndpoint: secret }, { expectedStatusFile: secret }]) {
    const channel = new EventEmitter();
    assert.throws(() => waitForRuntimeHostDescriptor(channel, binding), { message: 'bundled_runtime_fixture_host_binding_invalid' });
    assert.deepEqual(channel.eventNames(), []);
  }
});

test('bundled fixture refuses ended, failed, disconnected and silent Host channels without private output', async () => {
  for (const [event, reason] of [['close', 'ended_before_ready'], ['disconnect', 'disconnected_before_ready'], ['error', 'failed']]) {
    const child = new EventEmitter();
    const result = waitForRuntimeHostDescriptor(child);
    child.emit(event, new Error('private connection string'));
    await assert.rejects(result, { message: 'bundled_runtime_fixture_host_' + reason });
  }
  const child = new EventEmitter();
  await assert.rejects(waitForRuntimeHostDescriptor(child, { timeoutMs: 1 }), { message: 'bundled_runtime_fixture_host_ready_timeout' });
  for (const event of ['message', 'error', 'close', 'disconnect']) assert.equal(child.listenerCount(event), 0);
});
const configValue = root => ({ schema: 'compute.runtime-host-config.v1', version: 1,
  bundle_directory: path.join(root, 'bundle'), expected_bundle_sha256: 'a'.repeat(64),
  state_directory: path.join(root, 'state'), pg_data_directory: path.join(root, 'state/data'),
  database_url: 'postgresql://synthetic:private-password@127.0.0.1:25434/fixture',
  inspect_database_url: 'postgresql://synthetic:private-password@127.0.0.1:25434/fixture',
  api_port: 25432, edge_port: 25433, startup_timeout_ms: 1000 });

async function fixture(t, overrides = {}, temporaryDirectory = os.tmpdir()) {
  const temporary = await realpath(temporaryDirectory);
  const root = await realpath(await mkdtemp(path.join(temporary, 'compute-host-test-')));
  t.after(() => removeFixtureDirectory(root,temporary,'compute-host-test-'));
  const config = { ...configValue(root), ...overrides };
  await mkdir(config.bundle_directory, { recursive: true });
  await mkdir(config.pg_data_directory, { recursive: true });
  await writeFile(path.join(config.pg_data_directory, 'PG_VERSION'), '17\n');
  await writeFile(path.join(config.pg_data_directory, 'client-vault.key'), 'b'.repeat(64) + '\n');
  await writeFile(path.join(config.pg_data_directory,'postmaster.pid'),`1234\n${config.pg_data_directory}\n1790000000\n25434\n\n127.0.0.1\nready\n`);
  const configFile = path.join(root, 'private-config.json');
  await writeFile(configFile, JSON.stringify(config));
  const verified = { manifest: { reviewed_startup_files_sha256: 'c'.repeat(64) }, paths: {
    hostEntry, nodeExecutable: process.execPath, postgresBinDirectory: root, denoExecutable: process.execPath, denoDirectory: root } };
  let finish;
  let calls = 0;
  const finished = new Promise(resolve => { finish = resolve; });
  const runtime = { endpoint: 'http://127.0.0.1:25433/a2-browser-native-supervisor-v1', instanceId: randomUUID(),
    postgresIdentity:{pid:1234,version:170007,system_identifier:config.expected_cluster_system_identifier||'7654321098765432100',
      started_at:new Date(1790000000000).toISOString(),data_directory:config.pg_data_directory,port:25434},
    edgeHealth: { runtime_ready: true, state_provider: 'LOCAL_POSTGRES', hosted_supabase_required: false,
      capability_health: { state: 'ATTESTED', authority_effect: false } }, children: [],
    startupManifest: { source_manifest_sha256: 'd'.repeat(64) }, finished,
    stop: async reason => { calls += 1; const outcome = { reason, children_stopped: true }; finish(outcome); return outcome; } };
  return { root, config, configFile, runtime, verified, finish, stopCalls: () => calls,
    hooks: { verifyBundle: async () => verified, stageDenoCache: async () => root,
      stageDenoExecutable: async () => path.join(root, 'private-deno.exe'), launchRuntime: async () => runtime } };
}

async function removeFixtureDirectory(directory,temporary,prefix){
  const actual=await realpath(directory);assert.equal(actual,directory);
  assert.equal(path.dirname(actual),temporary);assert.ok(path.basename(actual).startsWith(prefix));
  await rm(actual,{recursive:true,force:true});
}

test('generated Host fixture canonicalizes an aliased temporary root before deriving PG continuity inputs',async t=>{
  const temporary=await realpath(os.tmpdir());
  const parent=await realpath(await mkdtemp(path.join(temporary,'compute-host-alias-proof-')));
  t.after(()=>removeFixtureDirectory(parent,temporary,'compute-host-alias-proof-'));
  const physical=path.join(parent,'physical'),alias=path.join(parent,'alias');
  await mkdir(physical);await symlink(physical,alias,process.platform==='win32'?'junction':'dir');
  await t.test('canonical generated paths pass while alias-spelled postmaster data is still refused',async child=>{
    const f=await fixture(child,{},alias);
    // Generated SQL/process metadata only: this does not start or attest PG.
    const options={identity:f.runtime.postgresIdentity,pgDataDirectory:f.config.pg_data_directory};
    const proof=await runtimeRecoveryPostgresProof(options);
    assert.equal(f.root,await realpath(f.root));
    assert.equal(f.config.pg_data_directory,await realpath(f.config.pg_data_directory));
    const pidFile=path.join(f.config.pg_data_directory,'postmaster.pid'),bytes=await readFile(pidFile,'utf8');
    const lines=bytes.split('\n');
    assert.equal(lines[1],f.config.pg_data_directory);
    lines[1]=path.join(alias,path.basename(f.root),'state','data');
    await writeFile(pidFile,lines.join('\n'));
    await assert.rejects(runtimeRecoveryPostgresProof(options),/runtime_recovery_postgres_identity_unproven/);
    await writeFile(pidFile,bytes);assert.deepEqual(await runtimeRecoveryPostgresProof(options),proof);
  });
});

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

test('failed startup retains the finite health witness instead of overwriting it with an empty FAILED status',async t=>{
  const f=await fixture(t);
  const diagnostic={schema:'metaengine.client-state.health-failure.v1',code:'health_capability_unattested',
    component:'edge',consecutive_failures:3,http_status:null,authority_effect:false};
  f.hooks.launchRuntime=async(_config,{report})=>{
    await report({event:'health_failure',health_failure:diagnostic});
    throw Object.assign(new Error('edge_readiness_timeout'),{code:'edge_readiness_timeout'});
  };
  await assert.rejects(startManagedRuntimeHost({configFile:f.configFile},f.hooks),/edge_readiness_timeout/);
  const status=JSON.parse(await readFile(path.join(f.config.state_directory,'runtime-instance.json'),'utf8'));
  assert.equal(status.state,'FAILED');assert.equal(status.runtime_ready,false);
  assert.equal(status.reason,'edge_readiness_timeout');
  assert.deepEqual(status.last_health_failure,diagnostic);
  assert(!JSON.stringify(status).includes('private-password'));
});

test('host persists a finite health failure before terminal cleanup and retains it after STOPPED', async t => {
  const f = await fixture(t);
  let report;
  const host = await startManagedRuntimeHost({ configFile: f.configFile }, { ...f.hooks,
    launchRuntime: async (_config, hooks) => { report = hooks.report; return f.runtime; } });
  const diagnostic = { schema: 'metaengine.client-state.health-failure.v1', code: 'health_http_failed',
    component: 'api', consecutive_failures: 3, http_status: 503, authority_effect: false };
  await report({ event: 'health_failure', health_failure: diagnostic });
  const before = JSON.parse(await readFile(host.statusFile, 'utf8'));
  assert.equal(before.state, 'READY');
  assert.equal(before.runtime_ready, true, 'diagnostics do not grant or remove readiness authority');
  assert.deepEqual(before.last_health_failure, diagnostic);
  f.finish({ reason: 'runtime_health_failed', children_stopped: true, last_health_failure: diagnostic });
  await host.finished;
  await report({ event: 'health_recovered' });
  const after = JSON.parse(await readFile(host.statusFile, 'utf8'));
  assert.equal(after.state, 'STOPPED');
  assert.equal(after.runtime_ready, false);
  assert.deepEqual(after.last_health_failure, diagnostic);
  assert.equal(JSON.stringify(after).includes('private-password'), false);
});

test('host clears a recovered health failure and refuses unvalidated private payloads', async t => {
  const f = await fixture(t);
  let report;
  const host = await startManagedRuntimeHost({ configFile: f.configFile }, { ...f.hooks,
    launchRuntime: async (_config, hooks) => { report = hooks.report; return f.runtime; } });
  const diagnostic = { schema: 'metaengine.client-state.health-failure.v1', code: 'health_capability_unattested',
    component: 'edge', consecutive_failures: 1, http_status: null, authority_effect: false };
  await report({ event: 'health_failure', health_failure: diagnostic });
  await report({ event: 'health_recovered' });
  assert.equal(JSON.parse(await readFile(host.statusFile, 'utf8')).last_health_failure, null);
  await report({ event: 'health_failure', health_failure: { ...diagnostic, stderr: 'synthetic-private-secret' } });
  await report({ event: 'health_failure', health_failure: { ...diagnostic, code: 'synthetic-private-secret' } });
  f.finish({ reason: 'runtime_health_failed', children_stopped: true,
    last_health_failure: { ...diagnostic, url: 'synthetic-private-secret' } });
  await host.finished;
  const after = JSON.parse(await readFile(host.statusFile, 'utf8'));
  assert.equal(after.last_health_failure, null);
  assert.equal(JSON.stringify(after).includes('synthetic-private-secret'), false);
});

test('host serializes overlapping health and terminal status writes', async t => {
  const f = await fixture(t);
  let report;
  const host = await startManagedRuntimeHost({ configFile: f.configFile }, { ...f.hooks,
    launchRuntime: async (_config, hooks) => { report = hooks.report; return f.runtime; } });
  const diagnostic = { schema: 'metaengine.client-state.health-failure.v1', code: 'postgres_incarnation_mismatch',
    component: 'postgres', consecutive_failures: 1, http_status: null, authority_effect: false };
  const pendingReport = report({ event: 'health_failure', health_failure: diagnostic });
  f.finish({ reason: 'runtime_health_failed', children_stopped: true, last_health_failure: diagnostic });
  await Promise.all([pendingReport, host.finished]);
  const status = JSON.parse(await readFile(host.statusFile, 'utf8'));
  assert.equal(status.state, 'STOPPED');
  assert.equal(status.instance_id, f.runtime.instanceId);
  assert.deepEqual(status.last_health_failure, diagnostic);
});

test('attached host passes through mode and shutdown never claims the external PostgreSQL', async t => {
  const temporary=await realpath(os.tmpdir());
  const f = await fixture(t, { postgres_mode: 'attached', api_role_mode: 'direct', expected_cluster_system_identifier: '7654321098765432100', pg_data_directory: path.join(temporary, `compute-attached-data-${randomUUID()}`) });
  t.after(() => removeFixtureDirectory(f.config.pg_data_directory,temporary,'compute-attached-data-'));
  await mkdir(f.config.state_directory, { recursive: true });
  await writeFile(path.join(f.config.state_directory, 'PG_VERSION'), '17\n');
  await writeFile(path.join(f.config.state_directory, 'client-vault.key'), 'b'.repeat(64) + '\n');
  let launched;
  const hooks = { ...f.hooks, launchRuntime: async config => { launched = config; return f.runtime; } };
  const host = await startManagedRuntimeHost({ configFile: f.configFile }, hooks);
  assert.equal(launched.postgresMode, 'attached');
  assert.equal(launched.apiRoleMode, 'direct');
  assert.equal(launched.expectedClusterSystemIdentifier, '7654321098765432100');
  assert.equal(launched.denoPath, path.join(f.root, 'private-deno.exe'));
  assert.notEqual(launched.denoPath, f.verified.paths.denoExecutable);
  assert.equal(JSON.parse(await readFile(host.statusFile, 'utf8')).postgres_mode, 'attached');
  assert.equal(JSON.parse(await readFile(host.statusFile, 'utf8')).api_role_mode, 'direct');
  assert.equal(f.runtime.children.some(child => child.name === 'postgres'), false);
  await host.stop();
  await host.finished;
  assert.equal(f.stopCalls(), 1);
});

test('real attached-host startup adopts only a physically absent predecessor and writes a fresh owner lock', async t => {
  const net = await import('node:net');
  const keeper = net.createServer(socket => socket.end());
  await new Promise(resolve => keeper.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => keeper.close(resolve)));
  const keeperPort = keeper.address().port;
  const temporary=await realpath(os.tmpdir());
  const f = await fixture(t, { postgres_mode: 'attached', api_role_mode: 'direct',
    expected_cluster_system_identifier: '7654321098765432100',
    pg_data_directory: path.join(temporary, 'runtime-host-recovery-attached-' + randomUUID()),
    database_url: 'postgresql://synthetic:private-password@127.0.0.1:' + keeperPort + '/fixture',
    inspect_database_url: 'postgresql://synthetic:private-password@127.0.0.1:' + keeperPort + '/fixture' });
  t.after(() => removeFixtureDirectory(f.config.pg_data_directory,temporary,'runtime-host-recovery-attached-'));
  await mkdir(f.config.state_directory, { recursive: true });
  const predecessorPid = 19551001;
  const priorLock = JSON.stringify({ schema: 'compute.runtime-host-lock.v1',
    pid: predecessorPid, owner_nonce: randomUUID() }) + '\n';
  const priorStatus = JSON.stringify({ schema: 'metaengine.client-state.runtime-status.v1',
    state: 'READY', runtime_ready: true, state_provider: 'LOCAL_POSTGRES',
    hosted_supabase_required: false, automatic_cloud_fallback: false, authority_effect: false,
    host_pid: predecessorPid, bundle_sha256: f.config.expected_bundle_sha256,
    instance_id: randomUUID(), postgres_mode: 'attached', api_role_mode: 'direct',
    endpoint: 'http://127.0.0.1:' + f.config.edge_port + '/a2-browser-native-supervisor-v1',
    children: [{ name: 'api', pid: 19551002 }, { name: 'edge', pid: 19551003 }] }) + '\n';
  const lockFile = path.join(f.config.state_directory, 'runtime-host-lock.json');
  await writeFile(lockFile, priorLock);
  await writeFile(path.join(f.config.state_directory, 'runtime-instance.json'), priorStatus);
  const host = await startManagedRuntimeHost({ configFile: f.configFile }, f.hooks);
  const newLock = JSON.parse(await readFile(lockFile, 'utf8'));
  assert.equal(newLock.pid, process.pid);
  assert.notEqual(newLock.owner_nonce, JSON.parse(priorLock).owner_nonce);
  const archived = (await (await import('node:fs/promises')).readdir(f.config.state_directory))
    .filter(name => /^runtime-host-lock\.orphan-[0-9a-f-]+\.json$/.test(name));
  assert.equal(archived.length, 1);
  assert.equal(await readFile(path.join(f.config.state_directory, archived[0]), 'utf8'), priorLock);
  assert.equal(JSON.parse(await readFile(host.statusFile, 'utf8')).state, 'READY');
  assert.equal(JSON.parse(await readFile(host.statusFile, 'utf8')).postgres_mode, 'attached');
  await host.stop();
  await host.finished;
  assert.equal(f.stopCalls(), 1);
  await assert.rejects(readFile(lockFile), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(f.config.state_directory, archived[0]), 'utf8'), priorLock);
  assert.equal(keeper.listening, true, 'attached PostgreSQL stand-in must not be stopped');
});

test('a leftover recovery gate blocks an otherwise unclaimed host without touching attached data', async t => {
  const f = await fixture(t);
  const gate = path.join(f.config.state_directory, 'runtime-host-recovery-gate.json');
  await writeFile(gate, JSON.stringify({ prior: 'ambiguous-recovery' }));
  await assert.rejects(startManagedRuntimeHost({ configFile: f.configFile }, f.hooks),
    /runtime_host_recovery_gate_unresolved/);
  assert.equal(await readFile(gate, 'utf8'), JSON.stringify({ prior: 'ambiguous-recovery' }));
  await assert.rejects(readFile(path.join(f.config.state_directory, 'runtime-host-lock.json')), { code: 'ENOENT' });
  assert.equal(f.stopCalls(), 0);
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

async function denoCopyFixture(t) {
  const f = await fixture(t);
  const bytes = Buffer.from('synthetic pinned executable bytes');
  const source = path.join(f.config.bundle_directory, 'runtime', 'deno', 'deno.exe');
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, bytes);
  const verified = { manifest: { files: [{ component: 'deno', path: 'runtime/deno/deno.exe',
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }] }, paths: { denoExecutable: source } };
  return { ...f, bytes, source, options: { verified, stateDirectory: f.config.state_directory } };
}

test('Deno compatibility hardlinks remain private across successive executable staging', async t => {
  const f = await denoCopyFixture(t);
  const target = await stageManagedDenoExecutable(f.options);
  const first = await lstat(target);
  const source = await lstat(f.source);
  assert.notEqual(first.ino, source.ino);
  assert.equal(first.nlink, 1);
  const compatibility = path.join(f.config.state_directory, 'deno-cache', 'node_compat_bin', 'node.exe');
  await mkdir(path.dirname(compatibility), { recursive: true });
  await link(target, compatibility);
  assert.equal((await lstat(target)).nlink, 2, 'simulate the real Deno node compatibility hardlink');
  assert.equal(await stageManagedDenoExecutable(f.options), target);
  assert.equal((await lstat(target)).nlink, 1, 'new run gets an independent single-link private executable');
  assert.equal((await lstat(f.source)).nlink, 1, 'sealed package never acquires a compatibility hardlink');
  assert.notEqual((await lstat(target)).ino, (await lstat(compatibility)).ino);
  assert.deepEqual(await readFile(compatibility), f.bytes);
  assert.deepEqual(await readFile(f.source), f.bytes);
});

test('private Deno executable tampering and bundled executable aliases fail before launch', async t => {
  const f = await denoCopyFixture(t);
  const target = await stageManagedDenoExecutable(f.options);
  await writeFile(target, 'changed private executable');
  await assert.rejects(stageManagedDenoExecutable(f.options), /deno_executable_digest_mismatch/);
  assert.equal(await readFile(target, 'utf8'), 'changed private executable', 'never silently repairs tampered executable');
  await link(f.source, path.join(f.root, 'foreign-deno-link.exe'));
  await assert.rejects(stageManagedDenoExecutable(f.options), /deno_executable_path_invalid/);
});

test('private Deno staging rejects directory aliases and changed bundled executable bytes', async t => {
  const f = await denoCopyFixture(t);
  await writeFile(f.source, 'changed bundled executable');
  await assert.rejects(stageManagedDenoExecutable(f.options), /deno_executable_digest_mismatch/);
  await writeFile(f.source, f.bytes);
  await symlink(f.config.bundle_directory, path.join(f.config.state_directory, 'deno-runtime'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(stageManagedDenoExecutable(f.options), /path_invalid/);
});

test('private Deno executable inherits the protected state DACL instead of broader bundle grants', {
  skip: process.platform !== 'win32', timeout: 180000,
}, async t => {
  const f = await denoCopyFixture(t);
  await protectOwnerOnlyWindowsDirectory(f.config.state_directory);
  await promisify(execFile)(path.win32.join(process.env.SystemRoot || process.env.SYSTEMROOT, 'System32', 'icacls.exe'),
    [f.source, '/grant', '*S-1-1-0:(R)'], { windowsHide: true, shell: false, timeout: 120000, maxBuffer: 8192 });
  await assert.rejects(verifyOwnerOnlyWindowsStorage(f.source), /acl_not_confirmed_readback/);
  const target = await stageManagedDenoExecutable(f.options);
  assert.equal((await verifyOwnerOnlyWindowsStorage(target)).owner_dacl_verified, true);
  assert.deepEqual(await readFile(target), f.bytes);
  assert.equal((await lstat(f.source)).nlink, 1);
});
