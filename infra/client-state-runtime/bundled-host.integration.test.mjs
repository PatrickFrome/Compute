import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { verifyOfflineRuntimeBundle } from './offline-runtime-bundle.mjs';
import { assertFixturePortsClosed, createIsolatedGoalFixture, goalFixtureConfig } from './test/isolated-goal-fixture.mjs';

const fixtureConfig = goalFixtureConfig();
const bundleDirectory = process.env.LOCAL_STATE_TEST_OFFLINE_BUNDLE_DIRECTORY;
const expectedBundleDigest = process.env.LOCAL_STATE_TEST_OFFLINE_BUNDLE_SHA256;
const skip = !fixtureConfig || !bundleDirectory;

function hostEnvironment(configFile) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(?:PG|DENO_|SUPABASE_|LOCAL_STATE_)/i.test(name)
    || /^(?:NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|ELECTRON_RUN_AS_NODE|GH_TOKEN|GITHUB_TOKEN|GITHUB_PAT|NPM_TOKEN|NODE_AUTH_TOKEN)$/i.test(name)) delete env[name];
  return { ...env, COMPUTE_RUNTIME_HOST_CONFIG: configFile };
}

function spawnHost(verified, configFile) {
  const child = spawn(verified.paths.nodeExecutable, [verified.paths.hostEntry], { env: hostEnvironment(configFile),
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '';
  const append = bytes => { output += bytes; assert.ok(output.length < 65536, 'host output stays bounded and public'); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('bundled_host_ready_timeout')), 90000);
    child.once('message', descriptor => { clearTimeout(timer); resolve(descriptor); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', () => { clearTimeout(timer); reject(new Error('bundled_host_ended_before_ready:' + output)); });
  });
  // Attach an observer immediately; readiness failures are awaited by the test.
  ready.catch(() => {});
  return { child, ready, closed, output: () => output };
}

async function stopHost(host) {
  if (host.child.exitCode !== null || host.child.signalCode !== null) return host.closed;
  assert.equal(host.child.connected, true, 'host owns an IPC lifecycle channel');
  host.child.send({ schema: 'compute.runtime-host-control.v1', command: 'stop' });
  let timer;
  try {
    return await Promise.race([host.closed, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('bundled_host_stop_timeout')), 20000);
    })]);
  } finally { clearTimeout(timer); }
}

function assertChildrenEnded(children) {
  assert.deepEqual(children.map(child => child.name), ['postgres', 'api', 'edge']);
  for (const child of children) assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' }, child.name + ' child ended');
}

test('real bundled host starts, releases every owned child and restarts against preserved private state', { skip, timeout: 360000 }, async t => {
  assert.equal(process.platform, 'win32');
  assert.ok(path.isAbsolute(bundleDirectory));
  assert.match(expectedBundleDigest || '', /^[a-f0-9]{64}$/);
  const verified = await verifyOfflineRuntimeBundle({ bundleDirectory, expectedBundleDigest });
  const fixture = await createIsolatedGoalFixture(fixtureConfig);
  const hosts = [];
  t.after(async () => {
    for (const host of hosts) await stopHost(host);
    await fixture.stop();
  });
  const prepared = await fixture.prepareManagedRuntimeHost({ bundleDirectory, expectedBundleDigest });
  const privateConfig = JSON.parse(await readFile(prepared.configFile, 'utf8'));
  const vaultFile = path.join(privateConfig.pg_data_directory, 'client-vault.key');
  const vaultDigest = createHash('sha256').update(await readFile(vaultFile)).digest('hex');
  const instances = [];
  const incarnations = [];
  let sourceDigest;
  for (let run = 0; run < 2; run += 1) {
    const host = spawnHost(verified, prepared.configFile);
    hosts.push(host);
    const descriptor = await host.ready;
    assert.deepEqual(Object.keys(descriptor).sort(), ['schema', 'provider', 'endpoint', 'instance_id', 'runtime_ready',
      'automatic_cloud_fallback', 'hosted_supabase_required', 'authority_effect', 'status_file'].sort());
    assert.equal(descriptor.schema, 'compute.runtime-host-provider.v1');
    assert.equal(descriptor.provider, 'LOCAL_POSTGRES');
    assert.equal(descriptor.endpoint, prepared.endpoint);
    assert.equal(descriptor.status_file, prepared.statusFile);
    assert.equal(descriptor.runtime_ready, true);
    assert.equal(descriptor.automatic_cloud_fallback, false);
    assert.equal(descriptor.hosted_supabase_required, false);
    assert.equal(descriptor.authority_effect, false);
    const status = JSON.parse(await readFile(prepared.statusFile, 'utf8'));
    assert.equal(status.state, 'READY');
    assert.equal(status.postgres_mode, 'owned');
    assert.equal(status.instance_id, descriptor.instance_id);
    assert.equal(status.capability_health.state, 'ATTESTED');
    assert.equal(status.bundle_sha256, expectedBundleDigest);
    assert.equal(status.children.length, 3);
    instances.push(descriptor.instance_id);
    incarnations.push(status.children.map(child => child.pid));
    sourceDigest ||= status.startup_source_sha256;
    assert.equal(status.startup_source_sha256, sourceDigest, 'restart preserves the complete selected resource bytes');
    const health = await fetch(descriptor.endpoint + '/health', { signal: AbortSignal.timeout(5000) });
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.instance_id, descriptor.instance_id);
    assert.equal(body.runtime_ready, true);
    assert.equal(body.capability_health.state, 'ATTESTED');
    assert.deepEqual(await stopHost(host), { code: 0, signal: null });
    await assertFixturePortsClosed(prepared.ports);
    assertChildrenEnded(status.children);
    const stopped = JSON.parse(await readFile(prepared.statusFile, 'utf8'));
    assert.equal(stopped.state, 'STOPPED');
    assert.equal(stopped.runtime_ready, false);
    assert.equal(stopped.children_stopped, true);
    await assert.rejects(readFile(path.join(privateConfig.state_directory, 'runtime-host-lock.json')), { code: 'ENOENT' });
    assert.equal(createHash('sha256').update(await readFile(vaultFile)).digest('hex'), vaultDigest);
    assert.equal(host.output().includes(privateConfig.database_url), false);
    assert.equal(host.output().includes(privateConfig.inspect_database_url), false);
    await verifyOfflineRuntimeBundle({ bundleDirectory, expectedBundleDigest });
  }
  assert.notEqual(instances[0], instances[1], 'restart creates a fresh runtime instance');
  for (let index = 0; index < 3; index += 1) assert.notEqual(incarnations[0][index], incarnations[1][index]);
});
