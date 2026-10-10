import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { LOCAL_STATE_PROVIDER_CONFIG_SCHEMA, LOCAL_STATE_PROVIDER_PROFILE, localStateProviderOwnerFile } from '../src/local-state-provider-policy.mjs';

const execute = promisify(execFile);
const runner = fileURLToPath(new URL('./fixtures/local-provider-entrypoint-runner.mjs', import.meta.url));
const entries = ['main-entry.mjs', 'final-runtime-entry.mjs'];
const oldInstance = '28da46b7-6e1d-4c6a-b638-f4dc4bd8ee59';
const currentInstance = 'bbc91d2a-44a7-4674-b4b4-5e265ebd2770';

async function fixture(t, mode = 'ready') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-singleton-provider-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const userData = path.join(directory, 'profile');
  await fs.mkdir(userData);
  const appData = path.join(directory, 'appdata');
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    // Delayed health exercises the awaited entrypoint boundary before endpoint
    // module evaluation, runtime registration and Electron's ready continuation.
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        ok: true, instance_id: mode === 'mismatched-health' ? oldInstance : currentInstance,
        state_provider: 'LOCAL_POSTGRES', runtime_ready: true, hosted_supabase_required: false,
        capability_health: { state: 'ATTESTED', authority_effect: false },
      }));
    }, 30);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise(resolve => server.close(resolve));
  };
  t.after(close);
  const base = 'http://127.0.0.1:' + server.address().port + '/a2-browser-native-supervisor-v1';
  const ownerFile = localStateProviderOwnerFile({ env: { APPDATA: appData }, platform: 'win32' });
  const identityFile = path.join(directory, 'runtime-instance.json');
  await fs.mkdir(path.dirname(ownerFile), { recursive: true });
  await fs.writeFile(ownerFile, mode === 'malformed' ? 'invalid owner JSON' : JSON.stringify({
    schema: LOCAL_STATE_PROVIDER_CONFIG_SCHEMA, version: 1, profile: LOCAL_STATE_PROVIDER_PROFILE,
    provider: 'LOCAL_POSTGRES', base_url: base, runtime_identity_file: identityFile, authority_effect: false,
  }));
  await fs.writeFile(identityFile, JSON.stringify({
    schema: 'metaengine.client-state.runtime-status.v1', state: mode === 'stopped' ? 'STOPPED' : 'READY',
    endpoint: base, instance_id: currentInstance, runtime_ready: true,
    state_provider: 'LOCAL_POSTGRES', hosted_supabase_required: false, automatic_cloud_fallback: false,
    capability_health: { state: 'ATTESTED', authority_effect: false }, authority_effect: false,
  }));
  if (mode === 'offline') await close();
  return { directory, appData, userData, ownerFile, identityFile, requests, base };
}

async function launch(f, { entry, primary = true, flags = [], extraEnv = {}, emitReady = true,
  managedHost, packaged = false, quitAfterBoot = false, installerAfterBoot = false, installerDuringStartup = false,
  holdQuit = false } = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/^METAENGINE_(STATE_PROVIDER|SUPERVISOR_BASE_URL|FALLBACK_SUPERVISOR_BASE_URL|LOCAL_STATE_INSTANCE_ID|LOCAL_PROVIDER_|PROFILE_PROBE_|SINGLETON_TEST_)/.test(name)) delete env[name];
  }
  const options = { entry, primary, flags, userData: f.userData, emitReady, managedHost, packaged, quitAfterBoot,
    installerAfterBoot, installerDuringStartup, holdQuit };
  let output;
  try {
    output = await execute(process.execPath, [runner], {
      env: { ...env, APPDATA: f.appData, XDG_CONFIG_HOME: f.appData, ME2_INTEGRATION: '0',
        METAENGINE_SINGLETON_TEST_OPTIONS: JSON.stringify(options), ...extraEnv },
      timeout: 15000, windowsHide: true,
    });
    output.code = 0;
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    output = { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
  const line = output.stdout.split(/\r?\n/).find(value => value.startsWith('SINGLETON_TEST_TRACE='));
  assert.ok(line, output.stderr || output.stdout);
  return { ...output, ...JSON.parse(line.slice('SINGLETON_TEST_TRACE='.length)) };
}

async function addManagedHost(f, { mode = 'ready', descriptorInstance = currentInstance,
  readyDelayMs = 0, stopDelayMs = 0 } = {}) {
  // This inert host is an actual subprocess with the production controller's
  // IPC/environment/cleanup boundary. Database lifecycle is independently
  // exercised by runtime-host.test.mjs using the reviewed offline bundle.
  const bundleDirectory = await fs.realpath(path.join(f.directory, 'profile'));
  const hostEntry = path.join(bundleDirectory, 'managed-host-fixture.mjs');
  const configFile = path.join(f.directory, 'private-host-config.json');
  const evidenceFile = path.join(f.directory, 'managed-host-evidence.json');
  await fs.writeFile(hostEntry, [
    'import fs from "node:fs";',
    'const config = JSON.parse(fs.readFileSync(process.env.COMPUTE_RUNTIME_HOST_CONFIG, "utf8"));',
    'const evidence = { state:"STARTED", credentials_absent: !process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.GITHUB_TOKEN, identity_absent: !process.env.METAENGINE_STATE_PROVIDER };',
    'const persist = () => fs.writeFileSync(config.evidence_file, JSON.stringify(evidence));',
    'persist();',
    'process.on("message", value => { if (value?.schema === "compute.runtime-host-control.v1" && value.command === "stop") setTimeout(() => { evidence.state="STOPPED_BY_OWNER_IPC"; persist(); process.exit(0); }, config.stop_delay_ms); });',
    'process.once("disconnect", () => { evidence.state="STOPPED_BY_PARENT_DISCONNECT"; persist(); process.exit(0); });',
    'if (config.mode === "failure") { process.stderr.write("PRIVATE_DATABASE_FIXTURE_SECRET"); process.send({ schema:"compute.runtime-host-failure.v1", reason:"PRIVATE_DATABASE_FIXTURE_SECRET" }); }',
    'else setTimeout(() => process.send({ schema:"compute.runtime-host-provider.v1", provider:"LOCAL_POSTGRES", endpoint:config.endpoint, instance_id:config.instance_id, status_file:config.identity_file, runtime_ready:true, automatic_cloud_fallback:false, hosted_supabase_required:false, authority_effect:false }), config.ready_delay_ms);',
  ].join('\n'));
  await fs.writeFile(configFile, JSON.stringify({ mode, endpoint: f.base, instance_id: descriptorInstance,
    identity_file: f.identityFile, evidence_file: evidenceFile, password: 'PRIVATE_DATABASE_FIXTURE_SECRET',
    ready_delay_ms: readyDelayMs, stop_delay_ms: stopDelayMs }));
  const config = JSON.parse(await fs.readFile(f.ownerFile, 'utf8'));
  config.runtime_host = { bundle_directory: bundleDirectory, expected_bundle_sha256: 'a'.repeat(64), config_file: configFile };
  await fs.writeFile(f.ownerFile, JSON.stringify(config));
  return { evidenceFile, configFile, managedHost: { sourceRoot: bundleDirectory, hostEntry,
    nodeExecutable: process.execPath, digest: 'a'.repeat(64), evidenceFile } };
}

const event = (result, kind) => result.events.find(value => value[0] === kind);
const eventIndex = (result, kind) => result.events.findIndex(value => value[0] === kind);
const moduleNames = result => result.events.filter(value => value[0] === 'module').map(value => value[1]);
function noProviderOrRuntime(result) {
  for (const name of ['local-state-provider-bootstrap.mjs', 'native-supervisor-endpoints.mjs',
    'host-resilience-runtime.mjs', 'self-update-signed-heartbeat.mjs', 'main.mjs', 'me2-integration-entry.mjs']) {
    assert.equal(moduleNames(result).includes(name), false, name + ' was evaluated on a control/secondary launch');
  }
  assert.equal(event(result, 'fetch'), undefined);
  assert.equal(event(result, 'host-created'), undefined);
  assert.equal(event(result, 'runtime-import'), undefined);
  assert.equal(event(result, 'dialog'), undefined);
}

for (const entry of entries) {
  test(entry + ': installer shutdown waits for managed IPC stop before a forced fallback, including a startup race', async t => {
    for (const duringStartup of [false, true]) {
      const f = await fixture(t);
      const host = await addManagedHost(f, { readyDelayMs: duringStartup ? 100 : 0, stopDelayMs: 250 });
      const result = await launch(f, { entry, managedHost: host.managedHost, holdQuit: true,
        installerAfterBoot: !duringStartup, installerDuringStartup: duringStartup });
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(event(result, 'forced-fallback-armed'), ['forced-fallback-armed', 'STOPPED_BY_OWNER_IPC']);
      assert.ok(eventIndex(result, 'forced-fallback-armed') < eventIndex(result, 'quit-requested'));
      assert.ok(eventIndex(result, 'quit-requested') < eventIndex(result, 'forced-fallback-fired'));
      assert.equal(JSON.parse(await fs.readFile(host.evidenceFile, 'utf8')).state, 'STOPPED_BY_OWNER_IPC');
      if (duringStartup) {
        assert.ok(eventIndex(result, 'lock') < eventIndex(result, 'installer-signal-during-startup'));
        assert.equal(event(result, 'runtime-import'), undefined);
        assert.equal(event(result, 'host-created'), undefined);
        assert.equal(event(result, 'host-start'), undefined);
      } else {
        assert.ok(eventIndex(result, 'resilience-stopped') < eventIndex(result, 'forced-fallback-armed'));
      }
    }
  });

  test(entry + ': admitted primary starts one managed host before health and shuts it down on Electron quit', async t => {
    const f = await fixture(t);
    const host = await addManagedHost(f);
    const result = await launch(f, { entry, managedHost: host.managedHost, quitAfterBoot: true,
      extraEnv: { SUPABASE_SERVICE_ROLE_KEY: 'fixture-secret', GITHUB_TOKEN: 'fixture-secret' } });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.boot_state, 'BLOCKED');
    assert.ok(eventIndex(result, 'lock') < eventIndex(result, 'managed-bundle-verified'));
    assert.ok(eventIndex(result, 'managed-bundle-verified') < eventIndex(result, 'fetch'));
    assert.equal(result.events.filter(value => value[0] === 'managed-bundle-verified').length, 1);
    assert.equal(result.events.filter(value => value[0] === 'quit-prevented').length, 1);
    assert.deepEqual(JSON.parse(await fs.readFile(host.evidenceFile, 'utf8')),
      { state: 'STOPPED_BY_OWNER_IPC', credentials_absent: true, identity_absent: true });
    assert.doesNotMatch(result.stderr + result.stdout, /PRIVATE_DATABASE_FIXTURE_SECRET|private-host-config/);
  });

  test(entry + ': secondary and installer control never verify or start a provisioned managed host', async t => {
    const f = await fixture(t);
    const host = await addManagedHost(f);
    for (const options of [{ primary: false }, { primary: true, flags: ['--metaengine-installer-shutdown'] },
      { primary: false, flags: ['--metaengine-installer-shutdown'] }]) {
      const result = await launch(f, { entry, managedHost: host.managedHost, ...options });
      assert.equal(result.code, 0, result.stderr);
      noProviderOrRuntime(result);
      assert.equal(event(result, 'managed-bundle-verified'), undefined);
      await assert.rejects(fs.stat(host.evidenceFile), { code: 'ENOENT' });
    }
    assert.equal(f.requests.length, 0);
  });

  test(entry + ': managed host failure or mismatched IPC identity blocks startup and confirms owned cleanup', async t => {
    for (const hostMode of [{ mode: 'failure' }, { descriptorInstance: oldInstance }]) {
      const f = await fixture(t);
      const host = await addManagedHost(f, hostMode);
      const result = await launch(f, { entry, managedHost: host.managedHost });
      assert.equal(result.code, 1, result.stderr);
      assert.equal(result.boot_state, 'BLOCKED');
      assert.equal(event(result, 'runtime-import'), undefined);
      assert.equal(event(result, 'fetch'), undefined);
      assert.equal(JSON.parse(await fs.readFile(host.evidenceFile, 'utf8')).state, 'STOPPED_BY_OWNER_IPC');
      assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_DATABASE_FIXTURE_SECRET|private-host-config/);
      assert.match(result.stderr, /local_runtime_host_start_failed|local_state_provider_host_identity_mismatch/);
    }
  });

  test(entry + ': secondary activates its primary while persisted local runtime is stopped or malformed', async t => {
    for (const mode of ['stopped', 'malformed', 'offline']) {
      const f = await fixture(t, mode);
      const result = await launch(f, { entry, primary: false });
      assert.equal(result.code, 0, result.stderr);
      assert.equal(event(result, 'lock')?.[1], false);
      assert.match(result.stdout, /PRIMARY_UI_ACTIVATION_ACKNOWLEDGED/);
      noProviderOrRuntime(result);
      assert.equal(f.requests.length, 0);
    }
  });

  test(entry + ': installer control signals singleton and never probes provider with or without a primary', async t => {
    for (const primary of [true, false]) {
      const f = await fixture(t, 'malformed');
      const result = await launch(f, { entry, primary, flags: ['--metaengine-installer-shutdown'] });
      assert.equal(result.code, 0, result.stderr);
      assert.equal(event(result, 'lock')?.[1], primary);
      assert.equal(!!event(result, 'release-lock'), primary);
      assert.doesNotMatch(result.stdout, /PRIMARY_UI_ACTIVATION/);
      noProviderOrRuntime(result);
      assert.equal(result.events.some(value => value[0] === 'once' && value[1] === 'ready'), false);
      assert.equal(f.requests.length, 0);
    }
  });

  test(entry + ': primary attests refreshed local instance before endpoint-dependent imports and arms one ready continuation', async t => {
    const f = await fixture(t);
    const result = await launch(f, { entry, extraEnv: {
      METAENGINE_STATE_PROVIDER: 'LOCAL_POSTGRES', METAENGINE_SUPERVISOR_BASE_URL: f.base,
      METAENGINE_LOCAL_STATE_INSTANCE_ID: oldInstance,
    } });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.provider, 'LOCAL_POSTGRES');
    assert.equal(result.boot_state, 'READY');
    assert.equal(result.instance, currentInstance);
    assert.deepEqual(f.requests, ['/a2-browser-native-supervisor-v1/health']);
    assert.ok(eventIndex(result, 'lock') < eventIndex(result, 'fetch'));
    assert.ok(eventIndex(result, 'fetch-returned') < eventIndex(result, 'host-import'));
    assert.deepEqual(event(result, 'host-import').slice(1), ['READY', 'LOCAL_POSTGRES', f.base]);
    assert.deepEqual(event(result, 'runtime-import').slice(1), ['READY', 'LOCAL_POSTGRES', f.base, false]);
    assert.equal(event(result, 'runtime-barrier')?.[1], true);
    assert.ok(eventIndex(result, 'runtime-import') < eventIndex(result, 'ready-emitted'));
    assert.ok(eventIndex(result, 'ready-emitted') < eventIndex(result, 'host-start'));
    assert.equal(result.events.filter(value => value[0] === 'host-start').length, 1);
    assert.ok(eventIndex(result, 'host-start') < eventIndex(result, 'barrier-released'));
    if (entry === 'final-runtime-entry.mjs') {
      assert.ok(eventIndex(result, 'activation-hook') < eventIndex(result, 'runtime-import'));
    }
  });

  test(entry + ': primary blocks stopped, malformed, offline or mismatched owner/runtime before endpoints and reports a local diagnostic', async t => {
    for (const mode of ['stopped', 'malformed', 'offline', 'mismatched-health']) {
      const f = await fixture(t, mode);
      const result = await launch(f, { entry });
      assert.equal(result.code, 1);
      assert.equal(event(result, 'lock')?.[1], true);
      assert.equal(result.provider, 'LOCAL_POSTGRES');
      assert.equal(result.boot_state, 'BLOCKED');
      assert.equal(moduleNames(result).includes('native-supervisor-endpoints.mjs'), false);
      assert.equal(event(result, 'host-created'), undefined);
      assert.equal(event(result, 'runtime-import'), undefined);
      assert.match(result.stderr, /LOCAL_PROVIDER_STARTUP_BLOCKED/);
      assert.match(event(result, 'dialog')?.[1] || '', /local runtime unavailable/);
      assert.ok(result.events.filter(value => value[0] === 'fetch').every(value => value[1] === f.base + '/health'));
    }
  });

  test(entry + ': updater/recovery starts validate the owner and secondary updater remains runtime-free', async t => {
    const f = await fixture(t, 'malformed');
    for (const flags of [['--updated'], ['--metaengine-sentinel-recovery=fixture-token'],
      ['--metaengine-version-probe=true'], ['--metaengine-client-goal-journal-probe-extra']]) {
      const blocked = await launch(f, { entry, flags });
      assert.equal(blocked.code, 1);
      assert.equal(blocked.boot_state, 'BLOCKED');
      assert.equal(event(blocked, 'runtime-import'), undefined);
    }
    const secondary = await launch(f, { entry, primary: false, flags: ['--updated'] });
    assert.equal(secondary.code, 0);
    noProviderOrRuntime(secondary);
    assert.equal(f.requests.length, 0);
  });

  test(entry + ': five exact non-runtime probes stay offline with a malformed selected owner', async t => {
    const f = await fixture(t, 'malformed');
    for (const flag of ['--metaengine-version-probe', '--metaengine-profile-probe',
      '--metaengine-client-goal-journal-probe', '--metaengine-single-instance-probe', '--metaengine-self-update-smoke']) {
      const result = await launch(f, { entry, flags: [flag], emitReady: flag !== '--metaengine-single-instance-probe' });
      assert.equal(result.code, flag === '--metaengine-profile-probe' ? 5 : 0, result.stderr);
      assert.equal(event(result, 'host-import')?.[1], 'OFFLINE_DIAGNOSTIC');
      assert.equal(event(result, 'fetch'), undefined);
      assert.equal(event(result, 'host-created'), undefined);
      assert.equal(event(result, 'runtime-import'), undefined);
      assert.equal(event(result, 'dialog'), undefined);
    }
    assert.equal(f.requests.length, 0);
  });

  test(entry + ': packaged missing-owner boot defers inert local-state boundary until after ESM ready', async t => {
    const f = await fixture(t);
    await fs.rm(f.ownerFile);
    const result = await launch(f, { entry, packaged: true });
    assert.equal(result.code, 0, result.stderr);
    assert.ok(eventIndex(result, 'entry-complete') >= 0, 'ESM must finish before ready');
    assert.ok(eventIndex(result, 'entry-complete') < eventIndex(result, 'ready-emitted'));
    assert.ok(eventIndex(result, 'ready-emitted') < eventIndex(result, 'missing-owner-boundary-ready'));
    assert.deepEqual(event(result, 'missing-owner-boundary-ready'), ['missing-owner-boundary-ready', true]);
    assert.equal(event(result, 'runtime-import'), undefined);
    assert.equal(event(result, 'host-import'), undefined);
    assert.equal(event(result, 'fetch'), undefined);
    assert.equal(await fs.stat(f.ownerFile).then(() => true, () => false), false,
      'missing-owner boundary must not fabricate provider owner authority');
  });

  test(entry + ': no owner configuration preserves legacy primary startup without a provider health request', async t => {
    const f = await fixture(t);
    await fs.rm(f.ownerFile);
    const result = await launch(f, { entry });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(event(result, 'host-import')?.[1], 'NO_OWNER_CONFIG');
    assert.equal(event(result, 'runtime-import')?.[2], null);
    assert.equal(event(result, 'fetch'), undefined);
    assert.equal(f.requests.length, 0);
  });
}
