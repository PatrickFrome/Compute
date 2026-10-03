import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { assertClientAdmissionRecoverySender } from '../src/client-admission-recovery.mjs';

const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
const systemPage = await readFile(new URL('../../me2-ui/src/components/me2/pages/system.tsx', import.meta.url), 'utf8');
const STATUS_CHANNEL = 'metaengine:client:admission-recovery-status';
const RESUME_CHANNEL = 'metaengine:client:resume-admission';

function sourceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `source section missing: ${start}`);
  return source.slice(from, to);
}

function executePreload({ url = 'http://127.0.0.1:8137/#settings', port } = {}) {
  const exposed = new Map();
  const invocations = [];
  const response = Object.freeze({ state: 'READBACK_REQUIRED', authority_effect: false });
  const context = vm.createContext({
    require(name) {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (name, value) => exposed.set(name, value) },
        ipcRenderer: {
          on() {},
          invoke(...args) {
            invocations.push(args);
            assert.ok([STATUS_CHANNEL, RESUME_CHANNEL].includes(args[0]), `unexpected IPC: ${args[0]}`);
            return Promise.resolve(response);
          },
        },
      };
    },
    location: url === null ? undefined : new URL(url),
    process: { env: port === undefined ? {} : { ME2_UI_GATEWAY_PORT: port } },
    Object, Array, Number, String, Set, Promise,
  });
  new vm.Script(preload, { filename: 'preload-shell.cjs' }).runInContext(context);
  return { exposed, invocations, response };
}

test('primary Client recovery status is read-only and resume uses a dedicated IPC only after a call', async () => {
  const harness = executePreload();
  const client = harness.exposed.get('metaengineClient');
  const shell = harness.exposed.get('metaengineShell');
  assert.equal(Object.isFrozen(client), true);
  assert.equal(typeof client.admissionRecoveryStatus, 'function');
  assert.equal(typeof client.resumeAdmission, 'function');
  assert.equal('command' in client, false);
  assert.equal('command' in shell, false);
  assert.equal('ipcRenderer' in client, false);
  assert.equal('invoke' in client, false);
  assert.equal(client.generic_command_exposed, false);
  assert.equal(client.automatic_retry_allowed, false);
  assert.equal(client.scheduler_authority, false);
  assert.equal(client.admission_resume_requires_explicit_user_action, true);
  assert.deepEqual(harness.invocations, [], 'loading the primary document must not request recovery');

  assert.equal(await client.admissionRecoveryStatus(), harness.response);
  assert.deepEqual(harness.invocations, [[STATUS_CHANNEL]]);
  await client.admissionRecoveryStatus();
  assert.deepEqual(harness.invocations, [[STATUS_CHANNEL], [STATUS_CHANNEL]], 'status cannot implicitly resume');

  const request = Object.freeze({ confirm: true, expected_generation_floor: 28 });
  assert.equal(await client.resumeAdmission(request), harness.response);
  assert.equal(harness.invocations.length, 3);
  assert.deepEqual(harness.invocations.at(-1), [RESUME_CHANNEL, request]);
  assert.equal(harness.invocations.at(-1)[1], request);
});

test('preload leaves malformed confirmation and generation values unchanged for the owner to reject', async () => {
  const harness = executePreload();
  const client = harness.exposed.get('metaengineClient');
  const cannotCoerce = Object.freeze({
    valueOf() { throw new Error('generation_must_not_be_coerced'); },
    toString() { throw new Error('generation_must_not_be_coerced'); },
  });
  for (const request of [
    Object.freeze({ confirm: 'true', expected_generation_floor: '28' }),
    Object.freeze({ confirm: true, expected_generation_floor: cannotCoerce }),
    Object.freeze({ confirm: true, expected_generation_floor: null }),
    undefined,
  ]) {
    await client.resumeAdmission(request);
    assert.equal(harness.invocations.at(-1)[0], RESUME_CHANNEL);
    assert.equal(harness.invocations.at(-1)[1], request);
    assert.equal(harness.invocations.at(-1).length, 2);
  }
  assert.equal(harness.invocations.length, 4, 'forwarding does not retry or manufacture a second request');
});

test('recovery bridge follows the configured primary port and is absent on legacy or foreign documents', () => {
  const configured = executePreload({ url: 'http://127.0.0.1:8442/#settings', port: '8442' });
  assert.equal(typeof configured.exposed.get('metaengineClient')?.resumeAdmission, 'function');
  assert.deepEqual(configured.invocations, []);
  for (const options of [
    { url: null },
    { url: 'file:///legacy-shell.html' },
    { url: 'http://127.0.0.1:8138/' },
    { url: 'http://127.0.0.1:8137/', port: '8442' },
    { url: 'https://127.0.0.1:8137/' },
    { url: 'http://localhost:8137/' },
    { url: 'http://example.com:8137/' },
    { url: 'https://chat.z.ai/' },
  ]) {
    const harness = executePreload(options);
    assert.equal(harness.exposed.has('metaengineClient'), false, `unexpected Client bridge: ${options.url}`);
    assert.equal('resumeAdmission' in harness.exposed.get('metaengineShell'), false);
    assert.deepEqual(harness.invocations, []);
  }
});

function executeMainRecoveryHandlers() {
  const handlers = new Map();
  const calls = [];
  const frame = { url: 'http://127.0.0.1:8137/#settings', origin: 'http://127.0.0.1:8137', detached: false };
  const webContents = { id: 41, mainFrame: frame, isDestroyed: () => false };
  const context = vm.createContext({
    URL,
    shellView: { webContents },
    primaryShellMode: 'ME2_PRIMARY', primaryShellUrl: 'http://127.0.0.1:8137/',
    assertClientAdmissionRecoverySender,
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    ensureClientAdmissionRecovery() {
      calls.push({ kind: 'ensure' });
      return {
        status() { calls.push({ kind: 'status' }); return 'status'; },
        resume(request) { calls.push({ kind: 'resume', request }); return 'requested'; },
      };
    },
  });
  const guards = sourceBetween(main, 'function assertShellSender(event)', 'function startupDegradedSnapshot()');
  const registrations = sourceBetween(main, `ipcMain.handle('${STATUS_CHANNEL}'`, "ipcMain.handle('metaengine:shell:system-deltas'");
  new vm.Script(guards + '\n' + registrations).runInContext(context);
  return { handlers, calls, event: { sender: webContents, senderFrame: frame }, webContents, frame };
}

test('actual main IPC handlers reject foreign senders and frames before loading recovery state or reaching the owner', async () => {
  const harness = executeMainRecoveryHandlers();
  assert.deepEqual(harness.calls, [], 'registering handlers must not initiate recovery');
  const request = Object.freeze({ confirm: true, expected_generation_floor: 28 });
  for (const event of [
    { ...harness.event, sender: { ...harness.webContents } },
    { ...harness.event, senderFrame: { ...harness.frame } },
    { ...harness.event, senderFrame: { url: 'https://chat.z.ai/', origin: 'https://chat.z.ai' } },
    { ...harness.event, sender: { id: 99 } },
  ]) {
    await assert.rejects(() => harness.handlers.get(STATUS_CHANNEL)(event), /sender_not_trusted/);
    await assert.rejects(() => harness.handlers.get(RESUME_CHANNEL)(event, request), /sender_not_trusted/);
  }
  assert.deepEqual(harness.calls, []);

  assert.equal(await harness.handlers.get(STATUS_CHANNEL)(harness.event), 'status');
  assert.deepEqual(harness.calls.map((row) => row.kind), ['ensure', 'status']);
  assert.equal(await harness.handlers.get(RESUME_CHANNEL)(harness.event, request), 'requested');
  assert.equal(harness.calls.at(-1).kind, 'resume');
  assert.equal(harness.calls.at(-1).request, request);
});

test('actual main recovery constructor uses fixed durable storage and delegates unchanged to the existing owner', async () => {
  const calls = [];
  let dependencies;
  const userData = path.resolve('fixture-client-user-data');
  const state = Object.freeze({ state: 'PENDING', expected_generation_floor: 28 });
  const controller = Object.freeze({ status: () => state });
  const context = vm.createContext({
    clientAdmissionRecovery: null,
    path,
    app: { getPath: (kind) => { assert.equal(kind, 'userData'); return userData; } },
    readClientConnectionStatus: () => 'connection',
    readClientWorkReadiness: () => 'readiness',
    nativeSupervisor: {
      snapshot: () => 'snapshot',
      devosResumeAdmission(request) { calls.push({ kind: 'owner', request }); return 'receipt'; },
    },
    createClientAdmissionRecovery(options) { dependencies = options; return controller; },
    fs: {
      readFile: async (target, encoding) => { calls.push({ kind: 'read', target, encoding }); return JSON.stringify(state); },
      mkdir: async (target, options) => { calls.push({ kind: 'mkdir', target, options }); },
      writeFile: async (target, data, options) => { calls.push({ kind: 'write', target, data, options }); },
      rename: async (from, to) => { calls.push({ kind: 'rename', from, to }); },
    },
  });
  new vm.Script(sourceBetween(main, 'function ensureClientAdmissionRecovery()', 'async function initDevOSSessionLayouts()')).runInContext(context);
  assert.equal(vm.runInContext('ensureClientAdmissionRecovery()', context), controller);
  assert.equal(vm.runInContext('ensureClientAdmissionRecovery()', context), controller);
  assert.deepEqual(calls, [], 'construction cannot send resume or flush a fabricated attempt');
  assert.equal(dependencies.readConnection(), 'connection');
  assert.equal(dependencies.readWorkReadiness(), 'readiness');
  assert.equal(dependencies.readSnapshot(), 'snapshot');
  const request = Object.freeze({ expected_generation_floor: 28, signal: new AbortController().signal });
  assert.equal(dependencies.resumeAdmission(request), 'receipt');
  assert.equal(calls.at(-1).request, request, 'the existing owner receives the cancellation signal with the request');
  calls.length = 0;
  assert.equal((await dependencies.loadState()).expected_generation_floor, 28);
  await dependencies.saveState(state);
  const target = path.join(userData, 'metaengine-client-admission-recovery-v1.json');
  assert.deepEqual(calls.map((row) => row.kind), ['read', 'mkdir', 'write', 'rename']);
  assert.equal(calls[0].target, target);
  assert.equal(calls[0].encoding, 'utf8');
  assert.equal(calls[2].target, target + '.tmp');
  assert.equal(calls[2].data, JSON.stringify(state) + '\n');
  assert.equal(calls[2].options.flush, true);
  assert.equal(calls[2].options.mode, 0o600);
  assert.equal(calls[3].from, target + '.tmp');
  assert.equal(calls[3].to, target);
});

test('Settings resume acknowledgment cannot set execution readiness and overlapping clicks send once', async () => {
  let resolveResume;
  const pending = new Promise((resolve) => { resolveResume = resolve; });
  const admissionUpdates = [];
  const calls = [];
  const nativeRuntime = { state: 'LIVE', readback: { work: { execution_ready: false, state: 'PAUSED' } } };
  const originalReadback = nativeRuntime.readback;
  const context = vm.createContext({
    window: { metaengineClient: { resumeAdmission(request) { calls.push({ kind: 'resume', request }); return pending; } } },
    nativeRuntime,
    workReadiness: nativeRuntime.readback.work,
    useCallback: (callback) => callback,
    canResumeAdmission: true, resumeFloor: 28,
    admissionInFlight: { current: false }, admissionEpoch: { current: 0 },
    setAdmissionBusy: () => {}, setAdmissionRecovery: (value) => admissionUpdates.push(value),
    refreshClientRuntimeStatus: async () => { calls.push({ kind: 'refresh' }); },
    toast: () => { throw new Error('unexpected_toast'); },
  });
  const validation = sourceBetween(systemPage, 'function validAdmissionRecovery(', 'const suState =').replace(': AdmissionRecoveryT', '');
  const callback = sourceBetween(systemPage, '  const resumeAdmission = useCallback(', '  // ── загрузчики').replace(
    '(window as Window & { metaengineClient?: AdmissionBridge })', 'window',
  );
  new vm.Script(validation + '\n' + callback).runInContext(context);
  assert.deepEqual(calls, []);
  const first = vm.runInContext('resumeAdmission()', context);
  await vm.runInContext('resumeAdmission()', context);
  assert.equal(calls.filter((row) => row.kind === 'resume').length, 1);
  assert.equal(calls[0].request.confirm, true);
  assert.equal(calls[0].request.expected_generation_floor, 28);
  const receipt = Object.freeze({
    schema: 'metaengine.client.admission-recovery.v1', state: 'CONFIRMED', reason: 'INDEPENDENT_READBACK_CONFIRMED',
    fresh_readback_required: false, automatic_retry_allowed: false, scheduler_authority: false, authority_effect: false,
  });
  resolveResume(receipt);
  await first;
  assert.equal(admissionUpdates.at(-1), receipt);
  assert.deepEqual(calls.map((row) => row.kind), ['resume', 'refresh']);
  assert.equal(nativeRuntime.state, 'LIVE');
  assert.equal(nativeRuntime.readback, originalReadback);
  assert.equal(nativeRuntime.readback.work.state, 'PAUSED');
  assert.equal(nativeRuntime.readback.work.execution_ready, false);
});
