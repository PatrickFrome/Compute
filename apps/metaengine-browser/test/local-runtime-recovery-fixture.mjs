import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LOCAL_STATE_PROVIDER_CONFIG_SCHEMA, LOCAL_STATE_PROVIDER_PROFILE } from '../src/local-state-provider-policy.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

// Inert child fixture: no database, API server, service, external command or
// installed profile. Evidence uses a file because arbitrary IPC during startup
// correctly fails the production descriptor protocol.
const childSource = String.raw`
import fs from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
const config = JSON.parse(fs.readFileSync(process.env.COMPUTE_RUNTIME_HOST_CONFIG, 'utf8'));
if (config.fixture_only !== true || !process.send) process.exit(90);
const plan = JSON.parse(process.argv[2]);
const instance = randomUUID();
let ready = false, stopping = false, stopRequested = false;
const pending = [];
const record = (type, extra = {}) => fs.appendFileSync(config.evidence_file, JSON.stringify({
  type, generation: plan.generation, pid: process.pid, instance_id: instance, ...extra,
}) + '\n');
const health = () => ({ ok: true, instance_id: instance, state_provider: 'LOCAL_POSTGRES',
  runtime_ready: true, hosted_supabase_required: false,
  capability_health: { state: 'ATTESTED', authority_effect: false } });
const publishReady = () => {
  if (ready || stopping) return;
  ready = true;
  fs.writeFileSync(config.identity_file, JSON.stringify({ ...health(),
    schema: 'metaengine.client-state.runtime-status.v1', state: 'READY', endpoint: config.endpoint,
    automatic_cloud_fallback: false, authority_effect: false }));
  record('READY');
  process.send({ schema: 'compute.runtime-host-provider.v1', provider: 'LOCAL_POSTGRES',
    endpoint: config.endpoint, instance_id: instance, status_file: config.identity_file,
    runtime_ready: true, automatic_cloud_fallback: false, hosted_supabase_required: false,
    authority_effect: false });
};
const terminal = reason => {
  if (stopping) return;
  stopping = true;
  record('TERMINAL', { reason, omitted: plan.omitTerminal === true });
  if (plan.omitTerminal) process.exit(0);
  const value = { schema: 'compute.runtime-host-terminal.v1',
    launch_nonce: plan.wrongNonce ? randomUUID() : process.env.COMPUTE_RUNTIME_HOST_LAUNCH_NONCE,
    host_pid: plan.wrongPid ? process.pid + 1 : process.pid,
    instance_id: plan.wrongInstance ? randomUUID() : ready ? instance : null,
    state: 'STOPPED', children_stopped: true, ownership_released: true, reason,
    authority_effect: false, ...(plan.terminalPatch || {}) };
  process.send(value, () => {
    record('TERMINAL_SENT');
    if (!plan.holdExit) process.exit(0);
  });
};
const invalidTerminal = () => process.send({ schema: 'compute.runtime-host-terminal.v1',
  launch_nonce: randomUUID(), host_pid: process.pid, instance_id: ready ? instance : null,
  state: 'STOPPED', children_stopped: true, ownership_released: true, reason: 'requested',
  authority_effect: false }, () => record('INVALID_TERMINAL_SENT'));
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value !== null && typeof value === 'object' ? '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const reply = request => process.send({ schema: 'metaengine.native-coding.host-ipc.response.v1',
  instance_id: instance, host_pid: process.pid, request_id: request.request_id, action: request.action,
  request_sha256: createHash('sha256').update(canonical(request)).digest('hex'), outcome: 'OK',
  value: { fixture_only: true, generation: plan.generation, instance_id: instance, host_pid: process.pid }, reason: null });
process.on('message', value => {
  if (value?.schema === 'compute.runtime-host-control.v1' && value.command === 'stop') {
    stopRequested = true;
    record('STOP_REQUEST');
    if (!plan.holdStop) terminal('requested');
  } else if (value?.schema === 'metaengine.fixture.runtime-control.v1') {
    if (value.command === 'ready') publishReady();
    else if (value.command === 'crash') { record('CRASH'); process.exit(23); }
    else if (value.command === 'release-stop' && stopRequested) terminal('requested');
    else if (value.command === 'terminal-stop') terminal('runtime_health_failed');
    else if (value.command === 'invalid-terminal') invalidTerminal();
    else if (value.command === 'invalid-terminal-then-ready') { invalidTerminal(); publishReady(); }
    else if (value.command === 'release-exit' && stopping) process.exit(0);
    else if (value.command === 'reply-native') { for (const request of pending.splice(0)) reply(request); }
    else if (value.command === 'dispose') { record('DISPOSE'); process.exit(0); }
  } else if (value?.schema === 'metaengine.native-coding.host-ipc.request.v1') {
    record('NATIVE_REQUEST', { request_id: value.request_id, action: value.action });
    if (plan.holdNativeReads) pending.push(value); else reply(value);
  }
});
process.once('disconnect', () => { record('DISCONNECT'); process.exit(0); });
record('STARTED');
if (!plan.holdReady) publishReady();
`;

/** Real ChildProcess lifecycle fixture, with isolated controller module state. */
export async function createLocalRuntimeRecoveryFixture(t) {
  const tempRoot = await fs.realpath(os.tmpdir());
  const directory = await fs.realpath(await fs.mkdtemp(path.join(tempRoot, 'metaengine-runtime-recovery-')));
  const bundleDirectory = path.join(directory, 'offline-bundle');
  await fs.mkdir(bundleDirectory);
  const entry = path.join(bundleDirectory, 'inert-host.mjs');
  const configFile = path.join(directory, 'private-fixture.json');
  const identityFile = path.join(directory, 'runtime-instance.json');
  const evidenceFile = path.join(directory, 'events.jsonl');
  const ownerFile = path.join(directory, 'owner.json');
  const endpoint = 'http://127.0.0.1:25433/a2-browser-native-supervisor-v1';
  await fs.writeFile(entry, childSource);
  await fs.writeFile(evidenceFile, '');
  await fs.writeFile(configFile, JSON.stringify({ fixture_only: true, identity_file: identityFile,
    evidence_file: evidenceFile, endpoint }));
  const config = {
    schema: LOCAL_STATE_PROVIDER_CONFIG_SCHEMA, version: 1, profile: LOCAL_STATE_PROVIDER_PROFILE,
    provider: 'LOCAL_POSTGRES', base_url: endpoint, runtime_identity_file: identityFile, authority_effect: false,
    runtime_host: { bundle_directory: bundleDirectory, expected_bundle_sha256: 'a'.repeat(64), config_file: configFile },
  };
  await fs.writeFile(ownerFile, JSON.stringify(config));
  const controllerUrl = new URL('../src/local-runtime-host-controller.mjs', import.meta.url);
  controllerUrl.searchParams.set('isolated_fixture', randomUUID());
  const controller = await import(controllerUrl.href);
  const env = { ...process.env, METAENGINE_STATE_PROVIDER: 'LOCAL_POSTGRES' };
  delete env.METAENGINE_LOCAL_STATE_INSTANCE_ID;
  const children = [], plans = [], healthGates = [];
  let verificationCount = 0, verificationGate = null;

  const events = async () => (await fs.readFile(evidenceFile, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
  const waitForEvent = async (type, { generation, timeoutMs = 30_000 } = {}) => {
    const deadline = Date.now() + timeoutMs;
    do {
      const found = (await events()).find(row => row.type === type && (generation === undefined || row.generation === generation));
      if (found) return found;
      await delay(10);
    } while (Date.now() < deadline);
    throw new Error(`runtime_fixture_event_timeout:${type}:${generation ?? 'any'}`);
  };
  const command = (generation, name) => {
    const row = children.find(value => value.generation === generation);
    assert.ok(row?.child.connected, 'fixture command requires its own connected child');
    return new Promise((resolve, reject) => row.child.send({ schema: 'metaengine.fixture.runtime-control.v1', command: name },
      error => error ? reject(error) : resolve()));
  };
  const startOptions = {
    config, env, startupTimeoutMs: 30_000, stopTimeoutMs: 2_000,
    verifyBundleImpl: async options => {
      verificationCount++;
      assert.deepEqual(options, { bundleDirectory, expectedBundleDigest: 'a'.repeat(64) });
      if (verificationGate) { const gate = verificationGate; gate.entered.resolve(); await gate.released.promise; }
      return { paths: { nodeExecutable: process.execPath, sourceRoot: bundleDirectory, hostEntry: entry } };
    },
    spawnImpl: (executable, args, options) => {
      const generation = children.length + 1;
      const child = spawn(executable, [...args, JSON.stringify({ ...plans.shift(), generation })], options);
      const ended = deferred();
      const row = { generation, child, ended: ended.promise, exited: false };
      children.push(row);
      child.once('exit', (code, signal) => { row.exited = true; ended.resolve({ code, signal }); });
      child.once('error', () => { if (!child.pid) { row.exited = true; ended.resolve({ spawn_failed: true }); } });
      return child;
    },
  };
  t.after(async () => {
    verificationGate?.released.resolve();
    for (const gate of healthGates) gate.resolve();
    // Intentionally unknown controller state is not reset. Each test imports a
    // new module; cleanup addresses only captured inert ChildProcess objects.
    for (const row of children) {
      if (row.exited) continue;
      if (row.child.connected) await command(row.generation, 'dispose').catch(() => {});
      const stopped = await Promise.race([row.ended.then(() => true), delay(2_000).then(() => false)]);
      if (!stopped) { row.child.kill(); await row.ended; }
    }
    const relative = path.relative(tempRoot, directory);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative)
      && path.basename(directory).startsWith('metaengine-runtime-recovery-'));
    assert.equal(await fs.realpath(directory), directory);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return {
    controller, config, env, startOptions, directory, ownerFile, evidenceFile, children, events, waitForEvent, command,
    verifications: () => verificationCount,
    queueGeneration: plan => { plans.push({ ...plan }); },
    holdVerification() {
      assert.equal(verificationGate, null);
      const gate = { entered: deferred(), released: deferred() };
      verificationGate = gate;
      return { entered: gate.entered.promise, release: () => gate.released.resolve() };
    },
    createHealthGate() {
      const entered = deferred(), released = deferred();
      healthGates.push(released);
      return {
        entered: entered.promise, release: () => released.resolve(),
        fetchImpl: async () => {
          const captured = JSON.parse(await fs.readFile(identityFile, 'utf8'));
          entered.resolve(captured);
          return { ok: true, json: async () => { await released.promise; return { ...captured, ok: true }; } };
        },
      };
    },
  };
}
