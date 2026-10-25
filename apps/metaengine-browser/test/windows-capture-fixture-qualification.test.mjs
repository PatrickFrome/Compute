import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { resolveQualifiedElectron } from '../scripts/qualified-electron-runtime.mjs';
import {
  CAPTURE_FIXTURE_READY_SCHEMA, CAPTURE_FIXTURE_TITLE, CAPTURE_FIXTURE_TIMEOUT_MS,
  captureExactFixtureWindow, captureFixtureSource, startCaptureFixture,
} from './helpers/windows-capture-fixture.mjs';

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-capture-contract-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function fakeElectron(t, { version = '44.0.0', resolver = '' } = {}) {
  const root = await temporary(t);
  const module = path.join(root, 'node_modules', 'electron');
  await fs.mkdir(module, { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { electron: '44.0.0' } }));
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ packages: {
    'node_modules/electron': { version: '44.0.0', resolved: 'https://registry.npmjs.org/electron/-/electron-44.0.0.tgz', integrity: 'sha512-YQ==' },
  } }));
  await fs.writeFile(path.join(module, 'package.json'), JSON.stringify({ name: 'electron', version, main: 'index.cjs' }));
  await fs.writeFile(path.join(module, 'index.cjs'), resolver || `const fs=require('node:fs'),path=require('node:path');
    fs.writeFileSync(path.join(__dirname,'resolver-called'),'yes');
    fs.mkdirSync(path.join(__dirname,'dist'),{recursive:true});
    fs.writeFileSync(path.join(__dirname,'path.txt'),'electron.exe');
    fs.writeFileSync(path.join(__dirname,'dist','electron.exe'),'synthetic-not-a-runtime');
    module.exports=path.join(__dirname,'dist','electron.exe');`);
  return { root, module };
}

test('locked Electron provisioning explicitly calls its package resolver once outside timed UI execution and is CWD-independent', async t => {
  const { root, module } = await fakeElectron(t);
  assert.throws(() => resolveQualifiedElectron({ root, environment: {} }), /binary_not_materialized_run_prerequisite/);
  await assert.rejects(fs.access(path.join(module, 'resolver-called')), { code: 'ENOENT' });
  const runtime = resolveQualifiedElectron({ root, environment: {}, materialize: true });
  assert.equal(runtime.package_version, '44.0.0');
  assert.equal(runtime.executable, path.join(module, 'dist', 'electron.exe'));
  assert.match(runtime.binary_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(resolveQualifiedElectron({ root, environment: { MIRROR: 'unrelated-non-electron-setting' } }), runtime);
});

test('Electron qualification rejects version and source overrides before invoking any package code', async t => {
  for (const environment of [{ ELECTRON_OVERRIDE_DIST_PATH: '/unknown' }, { ELECTRON_MIRROR: 'https://unknown.invalid/' },
    { npm_config_electron_custom_filename: 'unknown.zip' }, { ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
    { npm_package_config_electron_customDir: 'unknown' }, { electron_use_remote_checksums: '1' },
    { ELECTRON_INSTALL_PLATFORM: 'unknown' }, { ELECTRON_CUSTOM_VERSION: '45.0.0' }]) {
    const { root, module } = await fakeElectron(t);
    assert.throws(() => resolveQualifiedElectron({ root, environment, materialize: true }), /source_override_forbidden/);
    await assert.rejects(fs.access(path.join(module, 'resolver-called')), { code: 'ENOENT' });
  }
  const { root, module } = await fakeElectron(t, { version: '45.0.0' });
  assert.throws(() => resolveQualifiedElectron({ root, environment: {}, materialize: true }), /locked_version_invalid/);
  await assert.rejects(fs.access(path.join(module, 'resolver-called')), { code: 'ENOENT' });
});

test('Electron qualification refuses a resolver that leaves its locked dist or returns a missing binary', async t => {
  const { root } = await fakeElectron(t, { resolver: `const fs=require('node:fs'),path=require('node:path');
    fs.mkdirSync(path.join(__dirname,'dist'));fs.writeFileSync(path.join(__dirname,'path.txt'),'../outside.exe');
    module.exports=path.join(__dirname,'outside.exe');` });
  assert.throws(() => resolveQualifiedElectron({ root, environment: {}, materialize: true }), /path_invalid/);
  const missing = await fakeElectron(t, { resolver: `const fs=require('node:fs'),path=require('node:path');
    fs.mkdirSync(path.join(__dirname,'dist'));fs.writeFileSync(path.join(__dirname,'path.txt'),'electron.exe');
    module.exports=path.join(__dirname,'dist','electron.exe');` });
  assert.throws(() => resolveQualifiedElectron({ root: missing.root, environment: {}, materialize: true }), { code: 'ENOENT' });
});

const readyMessage = pid => ({ schema: CAPTURE_FIXTURE_READY_SCHEMA, process_id: pid,
  window_handle: '0x1234', title: CAPTURE_FIXTURE_TITLE });

async function nodeFixture(t, body, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-owned-capture-contract-'));
  const script = path.join(root, 'fixture.cjs');
  let fixture;
  // One ordered hook also covers failed assertions before explicit teardown.
  // If close cannot be confirmed, retain the directory rather than removing
  // files out from under an owned process.
  t.after(async () => {
    if (fixture) await fixture.stop();
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(script, `const fs=require('node:fs'),path=require('node:path');
    const readyPath=process.env.METAENGINE_CAPTURE_READY_PATH,stopPath=process.env.METAENGINE_CAPTURE_STOP_PATH;
    fs.watch(__dirname,(_event,filename)=>{if(String(filename)===path.basename(stopPath))process.emit('message','STOP_CAPTURE_FIXTURE');});
    function publishReady(message){message.nonce??=process.env.METAENGINE_CAPTURE_NONCE;
      fs.writeFileSync(readyPath+'.pending',JSON.stringify(message));fs.renameSync(readyPath+'.pending',readyPath);}
    ` + body);
  fixture = startCaptureFixture(process.execPath, script, { readyTimeoutMs: 5000, stopTimeoutMs: 3000, ...options });
  return { fixture, root };
}
const readySource = `publishReady(${JSON.stringify(readyMessage(0)).replace('"process_id":0', '"process_id":process.pid')});`;

test('owned atomic-file readiness drives one exact observation and capture, never a title-only or foreign HWND match', async t => {
  const { fixture } = await nodeFixture(t, readySource + `process.on('message',()=>process.exit(0));`);
  const ready = await fixture.ready;
  const identity = { process_id: ready.process_id, window_handle: ready.window_handle };
  const calls = [], phases = [];
  const result = await captureExactFixtureWindow(fixture, async request => {
    calls.push(request);
    if (request.action === 'CAPTURE_WINDOW') return { captured: request.target };
    return { result: { windows: [
      { title: ready.title, identity: { process_id: ready.process_id + 1, window_handle: ready.window_handle } },
      { title: ready.title, identity: { process_id: ready.process_id, window_handle: '0x5678' } },
      { title: ready.title, identity },
    ] } };
  }, async (phase, run) => { phases.push(phase); return run(); });
  assert.deepEqual(result, { captured: identity });
  assert.deepEqual(calls.map(row => row.action), ['OBSERVE_WINDOWS', 'CAPTURE_WINDOW']);
  assert.deepEqual(phases, ['window-ready', 'OBSERVE_WINDOWS', 'CAPTURE_WINDOW']);
});

test('a filename-less watch event checks only the nonce-bound owned readiness path and never enables Node IPC mode', async t => {
  const root = await temporary(t), script = path.join(root, 'fixture.cjs');
  const child = new EventEmitter(), watcher = new EventEmitter();
  Object.assign(child, { pid: 123, exitCode: null, signalCode: null, kill: () => true });
  watcher.close = () => {};
  let notify, options;
  const fixture = startCaptureFixture('synthetic-electron', script, {
    environment: { ELECTRON_RUN_AS_NODE: '1' },
    spawnImpl: (_executable, _argv, value) => { options = value; return child; },
    watchImpl: (_directory, callback) => { notify = callback; return watcher; },
  });
  await fs.writeFile(options.env.METAENGINE_CAPTURE_READY_PATH, JSON.stringify({ ...readyMessage(123), nonce: options.env.METAENGINE_CAPTURE_NONCE }));
  notify('rename', null);
  assert.equal((await fixture.ready).process_id, 123);
  assert.deepEqual(options.stdio, ['ignore', 'ignore', 'pipe']);
  assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
  const stopped = fixture.stop(); child.emit('close', 0, null); await stopped;
});

test('spawn ENOENT is handled immediately, causes zero observations, and close is awaited', async t => {
  const root = await temporary(t);
  const fixture = startCaptureFixture(path.join(root, 'no-electron.exe'), path.join(root, 'fixture.cjs'), { readyTimeoutMs: 1000 });
  let observations = 0;
  await assert.rejects(captureExactFixtureWindow(fixture, async () => { observations++; }), { code: 'ENOENT' });
  await fixture.stop();
  assert.equal(observations, 0);
  assert.equal(fixture.child.listenerCount('close'), 0, 'the owned child delivered close');
});

test('exit before readiness is terminal and performs no observation', async t => {
  const { fixture } = await nodeFixture(t, 'process.exit(17);');
  let observations = 0;
  await assert.rejects(captureExactFixtureWindow(fixture, async () => { observations++; }), /capture_fixture_exited:17/);
  await fixture.stop();
  assert.equal(observations, 0);
});

test('a ready fixture that exits during the observation cannot trigger capture or an observation retry', async t => {
  const { fixture } = await nodeFixture(t, readySource + `process.on('message',()=>process.exit(0));`);
  let observations = 0;
  await assert.rejects(captureExactFixtureWindow(fixture, async () => {
    observations++; fixture.child.kill();
    await new Promise(resolve => fixture.child.once('close', resolve));
    return { result: { windows: [] } };
  }), /capture_fixture_(?:exited|closed)/);
  assert.equal(observations, 1);
});

test('readiness timeout and an invalid owned identity cannot start a native observation', async t => {
  for (const body of ["setInterval(()=>{},1000);process.on('message',()=>process.exit(0));",
    `publishReady(${JSON.stringify(readyMessage(1))});setInterval(()=>{},1000);process.on('message',()=>process.exit(0));`,
    readySource.replace('publishReady({', 'publishReady({nonce:"foreign-launch",') + `process.on('message',()=>process.exit(0));`]) {
    const { fixture } = await nodeFixture(t, body, { readyTimeoutMs: body.startsWith('setInterval') ? 100 : 5000 });
    let observations = 0;
    await assert.rejects(captureExactFixtureWindow(fixture, async () => { observations++; }), /capture_fixture_(?:ready_timeout|ready_identity_invalid)/);
    await fixture.stop(); assert.equal(observations, 0);
  }
});

test('owned child close precedes fixture directory removal, including delayed graceful shutdown', async t => {
  const { fixture, root } = await nodeFixture(t, readySource + `process.on('message',()=>setTimeout(()=>{
    require('node:fs').writeFileSync(require('node:path').join(__dirname,'shutdown-marker'),'closed-after-request');process.exit(0);
  },60));`);
  await fixture.ready;
  await fixture.stop();
  assert.equal(await fs.readFile(path.join(root, 'shutdown-marker'), 'utf8'), 'closed-after-request');
  await fs.rm(root, { recursive: true });
});

test('automatic failure-path cleanup uses one stop-before-remove hook rather than FIFO early deletion', async t => {
  const hooks = [];
  const { fixture, root } = await nodeFixture({ after: callback => hooks.push(callback) },
    readySource + `process.on('message',()=>setTimeout(()=>process.exit(0),50));`);
  t.after(() => hooks[0]());
  await fixture.ready;
  assert.equal(hooks.length, 1);
  let directoryPresentAtClose = false;
  fixture.child.once('close', () => { directoryPresentAtClose = existsSync(root); });
  // This is exactly the hook the test runner invokes after an assertion fails.
  await hooks[0]();
  assert.equal(directoryPresentAtClose, true);
  await assert.rejects(fs.access(root), { code: 'ENOENT' });
});

test('test cancellation kills its owned fixture and prevents later native calls', async t => {
  const controller = new AbortController();
  const { fixture } = await nodeFixture(t, readySource + `setInterval(()=>{},1000);`, { signal: controller.signal });
  await fixture.ready;
  controller.abort(new Error('synthetic_test_cancelled'));
  let observations = 0;
  await assert.rejects(captureExactFixtureWindow(fixture, async () => { observations++; }), /synthetic_test_cancelled/);
  await fixture.stop(); assert.equal(observations, 0);
});

test('unconfirmed child close fails teardown instead of authorizing directory removal', async t => {
  const root = await temporary(t);
  const child = new EventEmitter();
  Object.assign(child, { pid: 123, exitCode: null, signalCode: null, connected: false, kill: () => true });
  const fixture = startCaptureFixture('synthetic-executable', path.join(root, 'synthetic-fixture.cjs'), {
    spawnImpl: () => child, readyTimeoutMs: 1000, stopTimeoutMs: 10,
  });
  await assert.rejects(fixture.stop(), /teardown_unconfirmed/);
  child.emit('close', null, 'SIGTERM');
});

test('physical capture fixture uses official preprovisioned resolution and retains raw digest, geometry and exact target assertions', async () => {
  const sourcePath = process.env.METAENGINE_CAPTURE_FIXTURE_SUBJECT_SOURCE
    || fileURLToPath(new URL('./windows-local-computer-executor.test.mjs', import.meta.url));
  const source = await fs.readFile(sourcePath, 'utf8');
  const physical = source.slice(source.indexOf("test('fixed Windows bridge physically captures"), source.indexOf("test('read-only observation carries"));
  assert.match(physical, /resolveQualifiedElectron\(\)/);
  assert.match(physical, /captureExactFixtureWindow/);
  assert.match(physical, /signal: t\.signal/);
  assert.match(physical, /await phase\('owned-child-teardown', \(\) => fixture\.stop\(\)\)/);
  assert.ok(physical.indexOf('fixture.stop()') < physical.indexOf('await fs.rm('));
  assert.match(physical, /pixel_sha256/); assert.match(physical, /png_sha256/);
  assert.match(physical, /geometry_stable, true/); assert.match(physical, /target_identity_sha256/);
  assert.doesNotMatch(physical, /process\.cwd\(\)|setTimeout|attempt\s*<\s*12/);
  assert.equal(CAPTURE_FIXTURE_TIMEOUT_MS, 320000);
  assert.match(captureFixtureSource, /ready-to-show/);
  assert.match(captureFixtureSource, /getNativeWindowHandle/);
  assert.match(captureFixtureSource, /fs\.renameSync/);
  assert.match(captureFixtureSource, /fs\.watch/);
  assert.match(captureFixtureSource, /filename != null/);
  assert.doesNotMatch(captureFixtureSource, /process\.send|process\.stdin/);
  assert.doesNotMatch(captureFixtureSource, /no-sandbox|disable-setuid-sandbox|webSecurity:\s*false/);
});
