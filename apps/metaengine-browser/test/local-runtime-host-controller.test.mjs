import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  subscribeOwnedLocalRuntimeHostGeneration,createOwnedNativeCodingHostCapability,readOwnedLocalRuntimeHostSummary,installLocalRuntimeHostShutdown, localRuntimeHostEnvironment,
  startConfiguredLocalRuntimeHost, stopOwnedLocalRuntimeHost, validatePackagedLocalRuntimeBinding,
} from '../src/local-runtime-host-controller.mjs';
import { LOCAL_STATE_PROVIDER_CONFIG_SCHEMA, LOCAL_STATE_PROVIDER_PROFILE, localStateProviderConnectionReady, validateLocalStateProviderConfig } from '../src/local-state-provider-policy.mjs';

const instance = 'bbc91d2a-44a7-4674-b4b4-5e265ebd2770';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
// Full-suite Windows runs compete for process startup and exit-event delivery.
// These are inert fixture budgets, separate from the production host deadlines.
const FIXTURE_START_TIMEOUT_MS = 30000;
async function waitForFixtureExitObservation(fixture) {
  assert.equal(fixture.children.length, 1);
  let timer;
  try {
    await Promise.race([fixture.children[0].ended, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('fixture_child_exit_timeout')), 10000);
    })]);
  } finally { clearTimeout(timer); }
  assert.equal(fixture.children[0].exited, true);
}
const childSource = [
  'import fs from "node:fs";',
  'const config = JSON.parse(fs.readFileSync(process.env.COMPUTE_RUNTIME_HOST_CONFIG, "utf8"));',
  'fs.writeFileSync(config.evidence_file, JSON.stringify({',
  '  config_path_bound: process.env.COMPUTE_RUNTIME_HOST_CONFIG === config.config_file,',
  '  loader_absent: !process.env.NODE_OPTIONS && !process.env.NODE_PATH && !process.env.LD_PRELOAD,',
  '  tokens_absent: !process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.GITHUB_TOKEN && !process.env.OPENAI_API_KEY,',
  '  browser_identity_absent: !process.env.METAENGINE_STATE_PROVIDER && !process.env.METAENGINE_LOCAL_STATE_INSTANCE_ID,',
  '}));',
  'let terminalExitCode = 0, terminalSent = false;',
  'const terminal = (reason, code = 0) => { if(terminalSent) return; terminalSent = true; terminalExitCode = code; process.send({schema:"compute.runtime-host-terminal.v1",launch_nonce:process.env.COMPUTE_RUNTIME_HOST_LAUNCH_NONCE,host_pid:process.pid,instance_id:' + JSON.stringify(instance) + ',state:"STOPPED",children_stopped:true,ownership_released:true,reason,authority_effect:false}, () => config.hold_exit ? undefined : config.mode === "ignore-stop" ? setTimeout(() => process.exit(code),150) : process.exit(code)); };',
  'process.on("message", value => { if (value?.schema === "compute.runtime-host-control.v1" && value.command === "stop") { terminal("requested"); if(config.hold_exit) process.send({schema:"fixture.stop-observed"}); } else if(value?.schema === "fixture.control" && value.command === "terminal-stop") terminal("runtime_health_failed",2); else if(value?.schema === "fixture.control" && value.command === "release-exit") process.exit(terminalExitCode); });',
  'process.once("disconnect", () => { if(config.mode !== "ignore-stop") process.exit(0); });',
  'if (config.mode === "failure") {',
  '  process.stderr.write("PRIVATE_FIXTURE_DATABASE_SECRET");',
  '  process.send({ schema:"compute.runtime-host-failure.v1", state:"FAILED", reason:"CONFIGURATION_FAILED", credentials_included:false });',
  '} else if (config.mode !== "timeout") {',
  '  process.send({ schema:"compute.runtime-host-provider.v1", provider:"LOCAL_POSTGRES", endpoint:config.endpoint,',
  '    instance_id:' + JSON.stringify(instance) + ', status_file:config.identity_file, runtime_ready:true,',
  '    automatic_cloud_fallback:false, hosted_supabase_required:false, authority_effect:false, ...config.descriptor_patch });',
  '  if (config.mode === "crash") setTimeout(() => terminal("runtime_health_failed",2), 100);',
  '}',
].join('\n');

async function fixture(t, { mode = 'ready', descriptorPatch = {}, holdExit = false } = {}) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-managed-host-')));
  t.after(async () => {
    const stopped = await stopOwnedLocalRuntimeHost({ timeoutMs: 2000 });
    assert.equal(stopped.cleanup_confirmed, true);
    await fs.rm(directory, { recursive: true, force: true });
  });
  const bundleDirectory = path.join(directory, 'offline-bundle');
  await fs.mkdir(bundleDirectory);
  const hostFile = path.join(bundleDirectory, 'runtime-host-fixture.mjs');
  await fs.writeFile(hostFile, childSource);
  const configFile = path.join(directory, 'private-runtime-config.json');
  const identityFile = path.join(directory, 'runtime-instance.json');
  const evidenceFile = path.join(directory, 'inert-host-evidence.json');
  const endpoint = 'http://127.0.0.1:25433/a2-browser-native-supervisor-v1';
  await fs.writeFile(configFile, JSON.stringify({
    mode, hold_exit: holdExit, descriptor_patch: descriptorPatch, endpoint, identity_file: identityFile,
    config_file: configFile, evidence_file: evidenceFile, password: 'PRIVATE_FIXTURE_DATABASE_SECRET',
  }));
  const config = {
    schema: LOCAL_STATE_PROVIDER_CONFIG_SCHEMA, version: 1, profile: LOCAL_STATE_PROVIDER_PROFILE,
    provider: 'LOCAL_POSTGRES', base_url: endpoint, runtime_identity_file: identityFile, authority_effect: false,
    runtime_host: { bundle_directory: bundleDirectory, expected_bundle_sha256: 'a'.repeat(64), config_file: configFile },
  };
  const env = { ...process.env, METAENGINE_STATE_PROVIDER: 'LOCAL_POSTGRES',
    METAENGINE_SUPERVISOR_BASE_URL: endpoint,
    METAENGINE_LOCAL_STATE_INSTANCE_ID: instance, NODE_OPTIONS: '--fixture-loader-must-not-inherit',
    NODE_PATH: 'fixture-loader-path', LD_PRELOAD: 'fixture-preload',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-secret', GITHUB_TOKEN: 'fixture-github-secret', OPENAI_API_KEY: 'fixture-api-secret' };
  let verifications = 0;
  const verifyBundleImpl = async options => {
    verifications++;
    assert.deepEqual(options, { bundleDirectory, expectedBundleDigest: 'a'.repeat(64) });
    return { paths: { nodeExecutable: process.execPath, sourceRoot: bundleDirectory, hostEntry: hostFile } };
  };
  const children = [];
  const spawnImpl = (...args) => {
    const child = spawn(...args);
    const record = { child, exited: false, messages: [] };
    record.ended = new Promise(resolve => child.once('exit', (code, signal) => { record.exited = true; resolve({ code, signal }); }));
    child.on('message', value => record.messages.push(value));
    children.push(record);
    return child;
  };
  return { config, env, evidenceFile, verifyBundleImpl, spawnImpl, children, verifications: () => verifications };
}

test('explicit managed host descriptor accepts only public pinned canonical resource/config locations', () => {
  const root = path.resolve(os.tmpdir(), 'managed-host');
  const config = {
    schema: LOCAL_STATE_PROVIDER_CONFIG_SCHEMA, version: 1, profile: LOCAL_STATE_PROVIDER_PROFILE,
    provider: 'LOCAL_POSTGRES', base_url: 'http://127.0.0.1:25433/a2-browser-native-supervisor-v1',
    runtime_identity_file: path.join(root, 'runtime-instance.json'), authority_effect: false,
    runtime_host: { bundle_directory: root, config_file: path.join(root, 'private-config.json'), expected_bundle_sha256: 'a'.repeat(64) },
  };
  assert.equal(validateLocalStateProviderConfig(config).runtime_host.expected_bundle_sha256, 'a'.repeat(64));
  for (const runtime_host of [null, {}, { ...config.runtime_host, password: 'forbidden' },
    { ...config.runtime_host, bundle_directory: 'relative' }, { ...config.runtime_host, config_file: '\\\\remote\\private.json' },
    { ...config.runtime_host, expected_bundle_sha256: 'unpinned' }]) {
    assert.throws(() => validateLocalStateProviderConfig({ ...config, runtime_host }), /runtime_host/);
  }
});

test('host environment carries a private config path and no loader, service or Browser identity secrets', () => {
  const env = localRuntimeHostEnvironment('/private/config.json', {
    PATH: '/system/bin', SystemRoot: 'C:\\Windows', NODE_OPTIONS: '--loader',
    NODE_PATH: '/foreign/module', SUPABASE_SERVICE_ROLE_KEY: 'secret', GITHUB_TOKEN: 'secret',
    METAENGINE_STATE_PROVIDER: 'LOCAL_POSTGRES', METAENGINE_LOCAL_STATE_INSTANCE_ID: instance,
  });
  assert.deepEqual(env, { PATH: '/system/bin', SystemRoot: 'C:\\Windows', COMPUTE_RUNTIME_HOST_CONFIG: '/private/config.json' });
});

test('protected packaged binding pins version, verifier, manifest and each reviewed resource identity', () => {
  const resourcesPath = path.resolve(os.tmpdir(), 'metaengine-package-resources');
  const options = { resourcesPath, bundleDirectory: path.join(resourcesPath, 'client-state-runtime'), expectedBundleDigest: 'a'.repeat(64) };
  const binding = {
    schema: 'metaengine.browser.client-state-runtime-binding.v1', schema_version: 1,
    source_head_sha: 'b'.repeat(40), package_version: '0.7.0-dev.20261008.1',
    bundle_manifest_relative_path: 'offline-runtime-bundle.json', bundle_sha256: 'a'.repeat(64),
    bundle_manifest_sha256: 'c'.repeat(64), runtime_verifier_relative_path: 'infra/client-state-runtime/offline-runtime-bundle.mjs',
    runtime_verifier_sha256: 'd'.repeat(64), source_bundle_sha256: 'e'.repeat(64),
    reviewed_startup_source_sha256: 'f'.repeat(64), reviewed_startup_files_sha256: '1'.repeat(64),
    resource_inventory_sha256: '2'.repeat(64), resource_file_count: 3, resource_size_bytes: 4096, authority_effect: false,
  };
  const pkg = { version: binding.package_version, metaengineClientStateRuntime: binding };
  assert.deepEqual(validatePackagedLocalRuntimeBinding(pkg, options), binding);
  for (const patch of [{ schema: 'foreign' }, { schema_version: 2 }, { package_version: 'old' },
    { source_head_sha: 'unpinned' }, { bundle_sha256: 'invalid' }, { bundle_manifest_sha256: 'invalid' },
    { bundle_manifest_relative_path: '../manifest.json' }, { runtime_verifier_relative_path: '../verifier.mjs' },
    { runtime_verifier_sha256: 'invalid' }, { reviewed_startup_source_sha256: 'invalid' },
    { reviewed_startup_files_sha256: 'invalid' }, { source_bundle_sha256: 'invalid' },
    { resource_inventory_sha256: 'invalid' }, { resource_file_count: 0 }, { resource_size_bytes: 0 },
    { authority_effect: true }]) {
    assert.throws(() => validatePackagedLocalRuntimeBinding({ ...pkg, metaengineClientStateRuntime: { ...binding, ...patch } }, options), /packaged_local_runtime_binding_invalid/);
  }
  assert.throws(() => validatePackagedLocalRuntimeBinding(pkg, { ...options, bundleDirectory: path.resolve(os.tmpdir(), 'foreign-bundle') }), /packaged_local_runtime_binding_invalid/);
  // Upgrading the packaged runtime must not change the original Owner's pin.
  assert.throws(() => validatePackagedLocalRuntimeBinding(pkg, { ...options, expectedBundleDigest: '3'.repeat(64) }),
    /packaged_local_runtime_owner_digest_mismatch/);
  assert.throws(() => validatePackagedLocalRuntimeBinding(pkg, { ...options, expectedBundleDigest: undefined }),
    /packaged_local_runtime_binding_invalid/);
});

test('one verified external host starts from a private file, binds ready IPC and stops through real child IPC', async t => {
  const f = await fixture(t);
  const options = { ...f, startupTimeoutMs: FIXTURE_START_TIMEOUT_MS, stopTimeoutMs: 2000 };
  const [first, second] = await Promise.all([startConfiguredLocalRuntimeHost(options), startConfiguredLocalRuntimeHost(options)]);
  assert.deepEqual(first, second);
  assert.equal(first.state, 'READY');
  assert.equal(first.instance_id, instance);
  assert.equal(first.credentials_included, false);
  assert.equal(f.verifications(), 1);
  assert.deepEqual(JSON.parse(await fs.readFile(f.evidenceFile, 'utf8')), {
    config_path_bound: true, loader_absent: true, tokens_absent: true, browser_identity_absent: true,
  });
  assert.doesNotMatch(JSON.stringify(first), /SECRET|password|private-runtime-config/);
  const stopped = await stopOwnedLocalRuntimeHost({ timeoutMs: 2000 });
  assert.equal(stopped.state, 'STOPPED');
  assert.equal(stopped.cleanup_confirmed, true);
});

test('shutdown delays Electron quit until the owned host has acknowledged exit', async t => {
  const f = await fixture(t);
  await startConfiguredLocalRuntimeHost({ ...f, startupTimeoutMs: FIXTURE_START_TIMEOUT_MS, stopTimeoutMs: 2000 });
  const app = new EventEmitter();
  let prevented = false;
  let quit;
  const finished = new Promise(resolve => { quit = resolve; });
  app.quit = quit;
  assert.equal(installLocalRuntimeHostShutdown(app), true);
  assert.equal(installLocalRuntimeHostShutdown(app), true);
  app.emit('will-quit', { preventDefault: () => { prevented = true; } });
  await finished;
  assert.equal(prevented, true);
  assert.equal((await stopOwnedLocalRuntimeHost({ timeoutMs: 2000 })).state, 'NO_OWNED_HOST');
});

test('mismatched endpoint, instance, status path or private IPC fields stop the new host fail closed', async t => {
  for (const descriptorPatch of [{ endpoint: 'https://example.com/remote' }, { instance_id: 'invalid' },
    { status_file: path.resolve(os.tmpdir(), 'other-owner-instance.json') }, { password: 'forbidden' },
    { automatic_cloud_fallback: true }, { hosted_supabase_required: true }]) {
    const f = await fixture(t, { descriptorPatch });
    await assert.rejects(startConfiguredLocalRuntimeHost({ ...f, startupTimeoutMs: FIXTURE_START_TIMEOUT_MS, stopTimeoutMs: 2000 }), /descriptor_invalid/);
    assert.equal((await stopOwnedLocalRuntimeHost({ timeoutMs: 2000 })).state, 'NO_OWNED_HOST');
  }
});

test('verification rejects changed bundles before any host spawn or private config read', async t => {
  const f = await fixture(t);
  let spawns = 0;
  await assert.rejects(startConfiguredLocalRuntimeHost({ ...f, startupTimeoutMs: FIXTURE_START_TIMEOUT_MS, stopTimeoutMs: 2000,
    verifyBundleImpl: async () => { throw new Error('offline_runtime_bundle_digest_mismatch'); },
    spawnImpl: () => { spawns++; throw new Error('unreachable'); },
  }), /bundle_digest_mismatch/);
  assert.equal(spawns, 0);
  await assert.rejects(fs.stat(f.evidenceFile), { code: 'ENOENT' });
});

test('server failure and bounded readiness timeout do not expose private stderr and confirm cleanup', async t => {
  for (const mode of ['failure', 'timeout']) {
    const f = await fixture(t, { mode });
    await assert.rejects(startConfiguredLocalRuntimeHost({ ...f,
      startupTimeoutMs: mode === 'timeout' ? 100 : FIXTURE_START_TIMEOUT_MS, stopTimeoutMs: 2000,
    }), error => /local_runtime_host_(start_failed|start_timeout)/.test(error.message)
      && !error.message.includes('PRIVATE_FIXTURE_DATABASE_SECRET'));
    assert.equal((await stopOwnedLocalRuntimeHost({ timeoutMs: 2000 })).state, 'NO_OWNED_HOST');
  }
});

test('a nonexistent executable fails promptly without retaining an owned PID or leaking its path', async t => {
  const f = await fixture(t);
  await assert.rejects(startConfiguredLocalRuntimeHost({ ...f, startupTimeoutMs: FIXTURE_START_TIMEOUT_MS, stopTimeoutMs: 100,
    verifyBundleImpl: async () => ({ paths: { nodeExecutable: path.join(path.dirname(f.evidenceFile), 'nonexistent-private-node.exe'),
      sourceRoot: f.config.runtime_host.bundle_directory, hostEntry: 'fixture.mjs' } }),
  }), error => error.message === 'local_runtime_host_spawn_failed');
  assert.equal((await stopOwnedLocalRuntimeHost({ timeoutMs: 100 })).state, 'NO_OWNED_HOST');
});

test('bounded owner cleanup reports unconfirmed before parent disconnect finishes the inert child', async t => {
  const f = await fixture(t, { mode: 'ignore-stop' });
  await startConfiguredLocalRuntimeHost({ ...f, startupTimeoutMs: FIXTURE_START_TIMEOUT_MS, stopTimeoutMs: 100 });
  const result = await stopOwnedLocalRuntimeHost({ timeoutMs: 100 });
  assert.equal(result.state, 'CLEANUP_UNCONFIRMED');
  assert.equal(result.cleanup_confirmed, false);
  await delay(100);
  assert.equal((await stopOwnedLocalRuntimeHost({ timeoutMs: 2000 })).cleanup_confirmed, true);
});

test('an unsolicited fixture terminal followed by stop retains one reason until physical exit', async t => {
  const f = await fixture(t, { holdExit: true });
  await startConfiguredLocalRuntimeHost({ ...f, startupTimeoutMs: FIXTURE_START_TIMEOUT_MS, stopTimeoutMs: 2000 });
  const record = f.children[0];
  const waitForMessage = async schema => {
    const deadline = Date.now() + 10000;
    while (!record.messages.some(value => value.schema === schema) && Date.now() < deadline) await delay(5);
    assert.ok(record.messages.some(value => value.schema === schema));
  };
  let stopping, observingExit;
  try {
    record.child.send({ schema: 'fixture.control', command: 'terminal-stop' });
    await waitForMessage('compute.runtime-host-terminal.v1');
    assert.equal(f.env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE, 'BLOCKED');
    assert.equal(record.exited, false);
    let exitObserved = false;
    observingExit = waitForFixtureExitObservation(f).then(() => { exitObserved = true; });
    observingExit.catch(() => {});
    await delay(20);
    assert.equal(exitObserved, false);
    stopping = stopOwnedLocalRuntimeHost({ timeoutMs: 2000 });
    await waitForMessage('fixture.stop-observed');
    assert.equal(record.exited, false);
    record.child.send({ schema: 'fixture.control', command: 'release-exit' });
    assert.equal((await stopping).cleanup_confirmed, true);
    assert.deepEqual(await record.ended, { code: 2, signal: null });
    await observingExit;
    assert.equal(exitObserved, true);
    assert.deepEqual(record.messages.filter(value => value.schema === 'compute.runtime-host-terminal.v1').map(value => value.reason), ['runtime_health_failed']);
  } finally {
    if (record.child.connected) record.child.send({ schema: 'fixture.control', command: 'release-exit' });
    await waitForFixtureExitObservation(f);
    await observingExit;
    await stopping;
  }
});

test('unexpected clean Host termination blocks readiness without automatically replacing the writer', async t => {
  const f = await fixture(t, { mode: 'crash' });
  await startConfiguredLocalRuntimeHost({ ...f, startupTimeoutMs: FIXTURE_START_TIMEOUT_MS, stopTimeoutMs: 2000 });
  await waitForFixtureExitObservation(f);
  assert.equal(f.env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE, 'BLOCKED');
  assert.ok(['OWNED_RUNTIME_HOST_STOPPED', 'OWNED_RUNTIME_HOST_EXITED'].includes(f.env.METAENGINE_LOCAL_PROVIDER_BOOT_REASON));
  assert.equal(localStateProviderConnectionReady(true, f.env), false);
  assert.equal(f.env.METAENGINE_STATE_PROVIDER, 'LOCAL_POSTGRES');
  assert.equal(f.verifications(), 1);
});

test('only an exact trusted failure envelope exposes the fixed interrupted-start recovery category',async t=>{
  const cases=[
    [{schema:'compute.runtime-host-failure.v1',state:'FAILED',reason:'runtime_host_recovery_startup_custody_missing',credentials_included:false},'local_runtime_host_startup_recovery_required'],
    [{schema:'compute.runtime-host-failure.v1',state:'FAILED',reason:'PRIVATE_FIXTURE_DATABASE_SECRET',credentials_included:false},'local_runtime_host_start_failed'],
    [{schema:'compute.runtime-host-failure.v1',state:'FAILED',reason:'runtime_host_recovery_startup_custody_missing',credentials_included:true},'local_runtime_host_start_failed'],
    [{schema:'compute.runtime-host-failure.v1',state:'FAILED',reason:'runtime_host_recovery_startup_custody_missing',credentials_included:false,private_path:'PRIVATE_FIXTURE_DATABASE_SECRET'},'local_runtime_host_start_failed'],
  ];
  for(const [message,reason] of cases){
    const f=await fixture(t);
    const child=new EventEmitter();
    child.pid=23001;child.connected=true;child.stderr=new EventEmitter();
    let launchNonce;
    child.send=()=>queueMicrotask(()=>{child.emit('message',{schema:'compute.runtime-host-terminal.v1',launch_nonce:launchNonce,
      host_pid:child.pid,instance_id:null,state:'STOPPED',children_stopped:true,ownership_released:true,reason:'requested',authority_effect:false});
      child.connected=false;child.emit('exit',0);});
    child.disconnect=()=>{child.connected=false;child.emit('exit',0);};
    await assert.rejects(startConfiguredLocalRuntimeHost({...f,startupTimeoutMs:1000,stopTimeoutMs:100,
      spawnImpl:(_exe,_argv,options)=>{launchNonce=options.env.COMPUTE_RUNTIME_HOST_LAUNCH_NONCE;
        queueMicrotask(()=>child.emit('message',message));return child;},
    }),error=>error.message===reason&&!error.message.includes('PRIVATE_FIXTURE'));
    assert.equal((await stopOwnedLocalRuntimeHost({timeoutMs:100})).cleanup_confirmed,true);
    assert.notEqual(f.env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE,'READY');
  }
});

test('a ready IPC followed by exit before the startup continuation cannot publish a dead owned host', async t => {
  const f = await fixture(t);
  const child = new EventEmitter();
  child.pid = 12345;
  child.connected = false;
  child.stderr = new EventEmitter();
  await assert.rejects(startConfiguredLocalRuntimeHost({ ...f,
    startupTimeoutMs: FIXTURE_START_TIMEOUT_MS, stopTimeoutMs: 100,
    spawnImpl: (_exe, _argv, options) => {
      queueMicrotask(() => {
        child.emit('message', { schema: 'compute.runtime-host-provider.v1', provider: 'LOCAL_POSTGRES',
          endpoint: f.config.base_url, instance_id: instance, status_file: f.config.runtime_identity_file,
          runtime_ready: true, automatic_cloud_fallback: false, hosted_supabase_required: false, authority_effect: false });
        child.emit('message', {schema:'compute.runtime-host-terminal.v1',launch_nonce:options.env.COMPUTE_RUNTIME_HOST_LAUNCH_NONCE,
          host_pid:child.pid,instance_id:instance,state:'STOPPED',children_stopped:true,ownership_released:true,reason:'runtime_health_failed',authority_effect:false});
        child.emit('exit', 2);
      });
      return child;
    },
  }), /local_runtime_host_exited_before_ready/);
  assert.equal((await stopOwnedLocalRuntimeHost({ timeoutMs: 100 })).state, 'NO_OWNED_HOST');
});

test('host shutdown during bootstrap health cannot overwrite BLOCKED with stale READY', async t => {
  const f = await fixture(t);
  const previousArgv = process.argv;
  let bootstrapPersistentLocalProvider;
  try {
    // Import the callable bootstrap without running this test process's real
    // profile; diagnostic mode is already a production entrypoint boundary.
    process.argv = [...previousArgv, '--metaengine-version-probe'];
    ({ bootstrapPersistentLocalProvider } = await import('../src/local-state-provider-bootstrap.mjs'));
  } finally { process.argv = previousArgv; }
  await startConfiguredLocalRuntimeHost({ ...f, startupTimeoutMs: FIXTURE_START_TIMEOUT_MS, stopTimeoutMs: 2000 });
  const ownerFile = path.join(path.dirname(f.evidenceFile), 'owner.json');
  await fs.writeFile(ownerFile, JSON.stringify(f.config));
  const health = { ok: true, instance_id: instance, state_provider: 'LOCAL_POSTGRES', runtime_ready: true,
    hosted_supabase_required: false, capability_health: { state: 'ATTESTED', authority_effect: false } };
  await fs.writeFile(f.config.runtime_identity_file, JSON.stringify({ ...health,
    schema: 'metaengine.client-state.runtime-status.v1', state: 'READY', endpoint: f.config.base_url,
    automatic_cloud_fallback: false, authority_effect: false }));
  let requests = 0;
  await assert.rejects(bootstrapPersistentLocalProvider({ env: f.env, ownerFile,
    fetchImpl: async () => ({ ok: true, json: async () => {
      requests++;
      const stopped = await stopOwnedLocalRuntimeHost({ timeoutMs: 2000 });
      assert.equal(stopped.cleanup_confirmed, true);
      return health;
    } }),
  }), /local_state_provider_owned_host_not_ready/);
  assert.equal(requests, 1);
  assert.equal(f.env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE, 'BLOCKED');
  assert.equal(f.env.METAENGINE_LOCAL_PROVIDER_BOOT_REASON, 'local_state_provider_owned_host_not_ready');
  assert.equal(f.env.METAENGINE_STATE_PROVIDER, 'LOCAL_POSTGRES');
  assert.equal(f.verifications(), 1);
});
test('stale packaged Owner pin leaves the old profile intact and exits without a second uncaught dialog (source contract)', async () => {
  const source = await fs.readFile(new URL('../src/main-entry.mjs', import.meta.url), 'utf8');
  const reject = source.indexOf("const staleOwnerBinding = reason === 'packaged_local_runtime_owner_digest_mismatch'");
  const stop = source.indexOf('if (staleOwnerBinding) {', reject);
  const rethrow = source.indexOf('throw error;', stop);
  assert.ok(reject >= 0 && stop > reject && rethrow > stop, 'mismatch remains an explicit fail-closed admission error');
  assert.match(source.slice(stop, rethrow), /app\.exit\(1\);\s*return;/);
  assert.match(source, /Do not delete the Owner profile or PostgreSQL database/);
});

test('owned native scope cleanup joins exact verified Host shutdown, never stops live Host on its own',async t=>{
 const f=await fixture(t);await startConfiguredLocalRuntimeHost({...f,startupTimeoutMs:FIXTURE_START_TIMEOUT_MS,stopTimeoutMs:2000});
 const summary=readOwnedLocalRuntimeHostSummary(),cap=createOwnedNativeCodingHostCapability(summary);
 const pending=cap.readScope();pending.catch(()=>{});cap.close();await assert.rejects(pending);
 await assert.rejects(cap.drainPhysical({wait:false}),e=>e.reason==='PHYSICAL_CLEANUP_UNCONFIRMED');assert.equal(readOwnedLocalRuntimeHostSummary(),summary);
 assert.equal(f.children[0].child.connected,true);assert.equal(cap.snapshot().physical_inflight,1);
 const stopped=await stopOwnedLocalRuntimeHost({timeoutMs:2000});assert.equal(stopped.cleanup_confirmed,true);
 assert.equal((await cap.drainPhysical()).cleanup_confirmed,true);assert.equal(cap.snapshot().physical_inflight,0);
});
test('concurrent owned shutdown requests share one exact-child stop send and wait for exit',async t=>{
 const f=await fixture(t,{holdExit:true});await startConfiguredLocalRuntimeHost({...f,startupTimeoutMs:FIXTURE_START_TIMEOUT_MS,stopTimeoutMs:2000});
 const child=f.children[0].child,send=child.send.bind(child);let stops=0;
 child.send=(message,...args)=>{if(message?.schema==='compute.runtime-host-control.v1'&&message.command==='stop')stops++;return send(message,...args);};
 const observed=new Promise(resolve=>{const read=m=>{if(m?.schema==='fixture.stop-observed'){child.off('message',read);resolve();}};child.on('message',read);});
 const a=stopOwnedLocalRuntimeHost({timeoutMs:2000}),b=stopOwnedLocalRuntimeHost({timeoutMs:2000});await observed;assert.equal(stops,1);
 send({schema:'fixture.control',command:'release-exit'});assert.equal((await a).cleanup_confirmed,true);assert.equal((await b).cleanup_confirmed,true);assert.equal(stops,1);
});

test('synchronous stopping-generation observer reentry shares already-owned shutdown work',async t=>{
 const f=await fixture(t,{holdExit:true});await startConfiguredLocalRuntimeHost({...f,startupTimeoutMs:FIXTURE_START_TIMEOUT_MS,stopTimeoutMs:2000});
 const child=f.children[0].child,send=child.send.bind(child);let stops=0,reentrant;
 child.send=(message,...args)=>{if(message?.schema==='compute.runtime-host-control.v1'&&message.command==='stop')stops++;return send(message,...args);};
 const unsubscribe=subscribeOwnedLocalRuntimeHostGeneration(snapshot=>{if(snapshot.stopping&&!reentrant)reentrant=stopOwnedLocalRuntimeHost({timeoutMs:2000});});t.after(unsubscribe);
 const observed=new Promise(resolve=>{const read=m=>{if(m?.schema==='fixture.stop-observed'){child.off('message',read);resolve();}};child.on('message',read);});
 const first=stopOwnedLocalRuntimeHost({timeoutMs:2000});await observed;assert.ok(reentrant);assert.equal(stops,1);
 send({schema:'fixture.control',command:'release-exit'});assert.equal((await first).cleanup_confirmed,true);assert.equal((await reentrant).cleanup_confirmed,true);assert.equal(stops,1);
});
