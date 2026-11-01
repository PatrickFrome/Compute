import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { startManagedRuntimeHost } from './runtime-host.mjs';
import { runtimeRecoveryPostgresProof } from './runtime-recovery-postgres-proof.mjs';
import { waitForRuntimeHostDescriptor } from './test/runtime-host-readiness.mjs';
import { requireRuntimeHostLaunchNonce, runtimeHostTerminalMessage, runtimeHostFailureMessage,
  sendRuntimeHostLifecycleMessage } from './runtime-host-lifecycle.mjs';

const hostEntry = fileURLToPath(new URL('./runtime-host.mjs', import.meta.url));
const nonce = '11111111-2222-4333-8444-555555555555';
const outcome = { instance_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', children_stopped: true,
  ownership_released: true, reason: 'runtime_health_failed' };

async function fixture(t, temporaryDirectory = os.tmpdir()) {
  const temporary = await realpath(temporaryDirectory);
  const root = await realpath(await mkdtemp(path.join(temporary, 'metaengine-lifecycle-test-')));
  t.after(async () => {
    assert.equal(await realpath(root), root);
    assert.equal(path.dirname(root), temporary);
    assert.ok(path.basename(root).startsWith('metaengine-lifecycle-test-'));
    await rm(root, { recursive: true, force: true });
  });
  const config = { schema: 'compute.runtime-host-config.v1', version: 1,
    bundle_directory: path.join(root, 'bundle'), expected_bundle_sha256: 'a'.repeat(64),
    state_directory: path.join(root, 'state'), pg_data_directory: path.join(root, 'state/data'),
    database_url: 'postgresql://fixture:synthetic@127.0.0.1:25434/fixture',
    inspect_database_url: 'postgresql://fixture:synthetic@127.0.0.1:25434/fixture',
    api_port: 25432, edge_port: 25433, startup_timeout_ms: 1000 };
  await mkdir(config.bundle_directory, { recursive: true });
  await mkdir(config.pg_data_directory, { recursive: true });
  await writeFile(path.join(config.pg_data_directory, 'PG_VERSION'), '17\n');
  await writeFile(path.join(config.pg_data_directory, 'client-vault.key'), 'b'.repeat(64) + '\n');
  await writeFile(path.join(config.pg_data_directory,'postmaster.pid'),`1234\n${config.pg_data_directory}\n1790000000\n25434\n\n127.0.0.1\nready\n`);
  const configFile = path.join(root, 'private-config.json');
  await writeFile(configFile, JSON.stringify(config));
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const runtime = { endpoint: 'http://127.0.0.1:25433/a2-browser-native-supervisor-v1', instanceId: randomUUID(),
    postgresIdentity:{pid:1234,version:170007,system_identifier:'7654321098765432100',
      started_at:new Date(1790000000000).toISOString(),data_directory:config.pg_data_directory,port:25434},
    edgeHealth: { runtime_ready: true, state_provider: 'LOCAL_POSTGRES', hosted_supabase_required: false,
      capability_health: { state: 'ATTESTED', authority_effect: false } }, children: [],
    startupManifest: { source_manifest_sha256: 'd'.repeat(64) }, finished,
    stop: async reason => { const value = { reason, children_stopped: true }; finish(value); return value; } };
  const hooks = { verifyBundle: async () => ({ manifest: { reviewed_startup_files_sha256: 'c'.repeat(64) },
    paths: { hostEntry, nodeExecutable: process.execPath, postgresBinDirectory: root,
      denoExecutable: process.execPath, denoDirectory: root } }),
    stageDenoCache: async () => root, stageDenoExecutable: async () => path.join(root, 'private-deno.exe'),
    launchRuntime: async () => runtime };
  return { root, config, configFile, runtime, hooks, finish,
    lock: path.join(config.state_directory, 'runtime-host-lock.json'),
    status: path.join(config.state_directory, 'runtime-instance.json') };
}

test('generated lifecycle fixture canonicalizes an aliased TEMP without accepting alias-spelled postmaster identity', async t => {
  const temporary = await realpath(os.tmpdir());
  const parent = await realpath(await mkdtemp(path.join(temporary, 'metaengine-lifecycle-alias-proof-')));
  const physical = path.join(parent, 'physical'), alias = path.join(parent, 'alias');
  t.after(async () => {
    try { await unlink(alias); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.equal(await realpath(parent), parent);
    assert.equal(path.dirname(parent), temporary);
    assert.ok(path.basename(parent).startsWith('metaengine-lifecycle-alias-proof-'));
    await rm(parent, { recursive: true, force: true });
  });
  await mkdir(physical);
  await symlink(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await t.test('physical continuity and terminal cleanup pass while an alias-spelled PID file remains refused', async child => {
    const f = await fixture(child, alias);
    // Generated process/SQL metadata only; this does not start or attest PostgreSQL.
    const options = { identity: f.runtime.postgresIdentity, pgDataDirectory: f.config.pg_data_directory };
    const proof = await runtimeRecoveryPostgresProof(options);
    assert.equal(f.root, await realpath(f.root));
    assert.equal(f.config.pg_data_directory, await realpath(f.config.pg_data_directory));
    const pidFile = path.join(f.config.pg_data_directory, 'postmaster.pid');
    const original = await readFile(pidFile, 'utf8'), lines = original.split('\n');
    assert.equal(lines[1], f.config.pg_data_directory);
    lines[1] = path.join(alias, path.basename(f.root), 'state', 'data');
    try {
      await writeFile(pidFile, lines.join('\n'));
      await assert.rejects(runtimeRecoveryPostgresProof(options), /runtime_recovery_postgres_identity_unproven/);
    } finally { await writeFile(pidFile, original); }
    assert.deepEqual(await runtimeRecoveryPostgresProof(options), proof);
    const receipts = [];
    const host = await startManagedRuntimeHost({ configFile: f.configFile }, { ...f.hooks, async onTerminal(value) {
      assert.equal(JSON.parse(await readFile(f.status, 'utf8')).state, 'STOPPED');
      await assert.rejects(readFile(f.lock), { code: 'ENOENT' });
      receipts.push(value);
    } });
    await host.stop();
    await host.finished;
    assert.deepEqual(receipts, [{ instance_id: f.runtime.instanceId, children_stopped: true,
      ownership_released: true, reason: 'requested' }]);
  });
});

test('terminal wire is generation-bound, finite and cannot encode unconfirmed cleanup', () => {
  const message = runtimeHostTerminalMessage({ launchNonce: nonce, hostPid: 123, outcome });
  assert.deepEqual(Object.keys(message).sort(), ['schema', 'launch_nonce', 'host_pid', 'instance_id', 'state',
    'children_stopped', 'ownership_released', 'reason', 'authority_effect'].sort());
  assert.equal(message.launch_nonce, nonce);
  assert.equal(message.reason, 'runtime_health_failed');
  for (const change of [{ children_stopped: false }, { ownership_released: false }, { instance_id: 'bad' }]) {
    assert.throws(() => runtimeHostTerminalMessage({ launchNonce: nonce, hostPid: 123, outcome: { ...outcome, ...change } }), /unproven/);
  }
  assert.throws(() => requireRuntimeHostLaunchNonce(undefined), /launch_nonce_invalid/);
  assert.equal(runtimeHostTerminalMessage({ launchNonce: nonce, hostPid: 123,
    outcome: { ...outcome, instance_id: null, reason: 'private arbitrary error' } }).reason, 'runtime_ended');
});

test('lifecycle IPC waits for callback and reports send failure/timeout without optimistic success', async () => {
  let callback;
  const sent = sendRuntimeHostLifecycleMessage({ connected: true, send(_message, cb) { callback = cb; } }, { schema: 'fixture' });
  let settled = false; void sent.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  callback(null); assert.equal(await sent, true);
  assert.equal(await sendRuntimeHostLifecycleMessage({ connected: true, send(_m, cb) { cb(new Error('fixture')); } }, {}), false);
  assert.equal(await sendRuntimeHostLifecycleMessage({ connected: true, send() {} }, {}, { timeoutMs: 10 }), false);
  assert.equal(await sendRuntimeHostLifecycleMessage({ connected: false, send() { assert.fail('disconnected send'); } }, {}), false);
});

test('terminal callback follows persisted terminal status and released exact lock, exactly once', async t => {
  const f = await fixture(t); const receipts = [];
  const host = await startManagedRuntimeHost({ configFile: f.configFile }, { ...f.hooks, async onTerminal(value) {
    assert.equal(JSON.parse(await readFile(f.status, 'utf8')).state, 'STOPPED');
    await assert.rejects(readFile(f.lock), { code: 'ENOENT' });
    receipts.push(value);
  } });
  f.finish({ reason: 'runtime_health_failed', children_stopped: true });
  await host.finished;
  await host.stop();
  assert.deepEqual(receipts, [{ instance_id: f.runtime.instanceId, children_stopped: true,
    ownership_released: true, reason: 'runtime_health_failed' }]);
});

test('unconfirmed children or replaced lock emit no positive terminal proof', async t => {
  for (const mode of ['children', 'lock']) {
    const f = await fixture(t); let receipts = 0;
    const host = await startManagedRuntimeHost({ configFile: f.configFile }, { ...f.hooks, onTerminal() { receipts++; } });
    if (mode === 'children') { f.finish({ reason: 'edge_exited', children_stopped: false }); await host.finished; }
    else {
      await writeFile(f.lock, 'replacement-owner');
      const rejection = assert.rejects(host.finished, /owner_lock_changed/);
      await assert.rejects(host.stop(), /owner_lock_changed/); await rejection;
    }
    assert.equal(receipts, 0);
    assert.ok((await readFile(f.lock)).length > 0);
  }
});

test('proven pre-READY cleanup preserves FAILED status and emits null-instance cleanup only after release', async t => {
  const f = await fixture(t); const receipts = [];
  await assert.rejects(startManagedRuntimeHost({ configFile: f.configFile }, { ...f.hooks,
    launchRuntime: async () => { throw Object.assign(new Error('edge_readiness_timeout'), { code: 'edge_readiness_timeout' }); },
    async onTerminal(value) {
      assert.equal(JSON.parse(await readFile(f.status, 'utf8')).state, 'FAILED');
      await assert.rejects(readFile(f.lock), { code: 'ENOENT' }); receipts.push(value);
    } }), /edge_readiness_timeout/);
  assert.deepEqual(receipts, [{ instance_id: null, children_stopped: true, ownership_released: true, reason: 'runtime_host_start_failed' }]);
});

test('failed terminal status persistence emits no positive cleanup proof', async t => {
  const f = await fixture(t); let receipts = 0;
  const host = await startManagedRuntimeHost({ configFile: f.configFile }, { ...f.hooks, onTerminal() { receipts++; } });
  await unlink(f.status); await mkdir(f.status);
  const rejection = assert.rejects(host.finished, /status_path_invalid/);
  await assert.rejects(host.stop(), /status_path_invalid/); await rejection;
  assert.equal(receipts, 0);
});

test('uncertain pre-READY cleanup keeps lock and emits no positive terminal', async t => {
  const f = await fixture(t); let receipts = 0;
  await assert.rejects(startManagedRuntimeHost({ configFile: f.configFile }, { ...f.hooks,
    launchRuntime: async () => { throw Object.assign(new Error('runtime_cleanup_unconfirmed'), { code: 'runtime_cleanup_unconfirmed' }); },
    onTerminal() { receipts++; } }), /runtime_cleanup_unconfirmed/);
  assert.equal(receipts, 0); assert.ok((await readFile(f.lock)).length > 0);
});

test('real failure IPC is finite; legacy missing nonce remains compatible and present invalid nonce fails closed', async t => {
  assert.equal(runtimeHostFailureMessage({ code: 'runtime_host_recovery_startup_custody_missing' }).reason,
    'runtime_host_recovery_startup_custody_missing');
  assert.equal(runtimeHostFailureMessage({ code: 'private_value' }).reason, 'runtime_host_start_failed');
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-lifecycle-wire-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const value of [nonce, undefined, 'invalid']) {
    const env = { ...process.env, COMPUTE_RUNTIME_HOST_CONFIG: path.join(root, 'absent.json') };
    delete env.COMPUTE_RUNTIME_HOST_LAUNCH_NONCE;
    if (value !== undefined) env.COMPUTE_RUNTIME_HOST_LAUNCH_NONCE = value;
    const child = spawn(process.execPath, [hostEntry], { windowsHide: true, env,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    const messages = []; let stderr = '';
    const readiness = assert.rejects(waitForRuntimeHostDescriptor(child), { message: 'bundled_runtime_fixture_host_failed' });
    child.on('message', message => messages.push(message));
    child.stderr.on('data', bytes => { stderr += bytes.toString('utf8'); if (stderr.length > 4096) child.kill(); });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    await readiness;
    assert.equal(code, 1);
    assert.deepEqual(messages, [runtimeHostFailureMessage(null)]);
    assert.equal(JSON.parse(stderr.trim()).reason === 'runtime_host_launch_nonce_invalid', value === 'invalid');
  }
});


test('pre-runtime FAILED persistence failure retains ownership and emits no cleanup receipt',async t=>{
 const f=await fixture(t);let receipts=0;
 await assert.rejects(startManagedRuntimeHost({configFile:f.configFile},{...f.hooks,
  launchRuntime:async()=>{await unlink(f.status);await mkdir(f.status);throw Object.assign(Error('generated launch failure'),{code:'generated_launch_failure'});},
  onTerminal(){receipts++;}}),/status_path_invalid/);
 assert.equal(receipts,0);assert.ok((await readFile(f.lock)).length>0);
});
