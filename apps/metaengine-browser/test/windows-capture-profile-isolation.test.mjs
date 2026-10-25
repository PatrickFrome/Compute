import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { captureFixtureSource, CAPTURE_FIXTURE_FILE_POLL_INTERVAL_MS } from './helpers/windows-capture-fixture.mjs';

async function subjectSource() {
  if (!process.env.METAENGINE_CAPTURE_PROFILE_SUBJECT_SOURCE) return captureFixtureSource;
  return (await import(pathToFileURL(process.env.METAENGINE_CAPTURE_PROFILE_SUBJECT_SOURCE).href)).captureFixtureSource;
}

// Execute the real generated Electron main source with controlled Electron API
// doubles, not a different Node IPC fixture. This proves portable source/order
// and physical filesystem boundaries, NOT real Windows/Electron behavior.
function fixtureModel(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'metaengine-capture-profile-')));
  const app = new EventEmitter(), events = [], paths = new Map(), created = [], timers = new Map();
  let releaseReady;
  const initialized = new Promise(resolve => { releaseReady = resolve; });
  app.setPath = (name, directory) => {
    assert.equal(path.dirname(directory), root, 'profile must be an immediate child of the canonical owned root');
    assert.equal(fs.realpathSync(directory), directory);
    paths.set(name, directory); events.push('setPath:' + name);
  };
  app.whenReady = () => { events.push('whenReady'); return initialized; };
  app.commandLine = { appendSwitch() {} };
  app.quit = () => { events.push('quit'); app.emit('before-quit'); };
  app.exit = code => { throw new Error('unexpected_fixture_exit:' + code); };
  class BrowserWindow extends EventEmitter {
    constructor() { super(); events.push('BrowserWindow'); }
    async loadURL() { this.emit('ready-to-show'); }
    setTitle() {}
    show() {}
    focus() {}
    destroy() { events.push('destroy'); }
    getNativeWindowHandle() { const handle = Buffer.alloc(8); handle.writeBigUInt64LE(0x1234n); return handle; }
  }
  const boundedFs = { ...fs, mkdirSync(directory, options) {
    // A regressed source cannot make this portable test write outside its root.
    assert.equal(path.dirname(path.resolve(directory)), root);
    created.push(directory); return fs.mkdirSync(directory, options);
  } };
  const readyPath = path.join(root, 'fixture.cjs.ready.json'), stopPath = path.join(root, 'fixture.cjs.stop');
  const context = {
    __dirname: root + path.sep + '.', Buffer,
    require(name) {
      if (name === 'electron') return { app, BrowserWindow };
      if (name === 'node:fs') return boundedFs;
      if (name === 'node:path') return path;
      throw new Error('unexpected_fixture_require:' + name);
    },
    process: { pid: 123, env: { METAENGINE_CAPTURE_READY_PATH: readyPath,
      METAENGINE_CAPTURE_STOP_PATH: stopPath, METAENGINE_CAPTURE_NONCE: 'owned-launch-nonce' } },
    setTimeout(callback, delay) { const timer = { unref() {} }; timers.set(timer, { callback, delay }); return timer; },
    clearTimeout(timer) { timers.delete(timer); }, console: { error(error) { throw error; } },
  };
  // One ordered hook closes the generated source's timers before directory rm,
  // including an assertion failure or startup exception.
  t.after(() => { app.emit('before-quit'); fs.rmSync(root, { recursive: true, force: true }); });
  const readStop = () => {
    const entry = [...timers].find(([, value]) => value.delay === CAPTURE_FIXTURE_FILE_POLL_INTERVAL_MS);
    assert.ok(entry, 'one bounded stop read must be scheduled');
    timers.delete(entry[0]); entry[1].callback();
  };
  return { root, events, paths, created, context, readyPath, stopPath, timers, readStop, releaseReady };
}

test('capture main source creates canonical disposable userData and sessionData before readiness and BrowserWindow', async t => {
  const source = await subjectSource(), model = fixtureModel(t);
  vm.runInNewContext(source, model.context, { filename: 'capture-fixture-main.cjs' });
  assert.deepEqual(model.created, [path.join(model.root, 'userData'), path.join(model.root, 'sessionData')]);
  assert.deepEqual([...model.paths.keys()], ['userData', 'sessionData']);
  assert.deepEqual(model.events, ['setPath:userData', 'setPath:sessionData', 'whenReady']);
  for (const directory of model.paths.values()) {
    assert.equal(path.dirname(directory), model.root);
    assert.ok(fs.lstatSync(directory).isDirectory());
    assert.equal(fs.realpathSync(directory), directory);
  }
  model.releaseReady();
  await new Promise(setImmediate);
  assert.deepEqual(model.events, ['setPath:userData', 'setPath:sessionData', 'whenReady', 'BrowserWindow']);
  const ready = JSON.parse(fs.readFileSync(model.readyPath, 'utf8'));
  assert.equal(ready.nonce, 'owned-launch-nonce');
  assert.equal(ready.process_id, 123); assert.equal(ready.window_handle, '0x1234');
  assert.doesNotMatch(source, /process\.send|process\.stdin|--no-sandbox|webSecurity:\s*false/);
});

test('repeated capture fixtures cannot reuse each other\'s userData or sessionData', async t => {
  const source = await subjectSource(), first = fixtureModel(t), second = fixtureModel(t);
  for (const model of [first, second]) vm.runInNewContext(source, model.context);
  assert.notEqual(first.root, second.root);
  for (const name of ['userData', 'sessionData']) {
    assert.ok(first.paths.has(name)); assert.ok(second.paths.has(name));
    assert.notEqual(first.paths.get(name), second.paths.get(name));
  }
});

test('a pre-existing profile path is refused before app readiness rather than reusing or deleting state', async t => {
  const source = await subjectSource(), model = fixtureModel(t);
  const existing = path.join(model.root, 'userData');
  fs.mkdirSync(existing); fs.writeFileSync(path.join(existing, 'sentinel'), 'preserve');
  assert.throws(() => vm.runInNewContext(source, model.context), { code: 'EEXIST' });
  assert.deepEqual(model.events, []);
  assert.equal(fs.readFileSync(path.join(existing, 'sentinel'), 'utf8'), 'preserve');
  assert.equal(fs.existsSync(model.readyPath), false);
});

test('owned stop nonce cancels every timer and fences a later Electron readiness callback', async t => {
  const source = await subjectSource(), model = fixtureModel(t);
  vm.runInNewContext(source, model.context);
  fs.writeFileSync(path.join(model.root, 'unrelated.stop'), 'owned-launch-nonce');
  fs.writeFileSync(model.stopPath, 'other-launch-nonce');
  model.readStop();
  assert.equal(model.events.includes('quit'), false);
  fs.writeFileSync(model.stopPath + '.pending', 'owned-launch-nonce');
  fs.renameSync(model.stopPath + '.pending', model.stopPath);
  model.readStop();
  assert.deepEqual(model.events.slice(-1), ['quit']);
  assert.equal(model.timers.size, 0);
  model.releaseReady(); await new Promise(setImmediate);
  assert.equal(model.events.includes('BrowserWindow'), false);
  assert.equal(fs.existsSync(model.readyPath), false);
});

test('generated main destroys the exact ready fixture on its owned stop file without directory watchers', async t => {
  const source = await subjectSource(), model = fixtureModel(t);
  model.context.require = new Proxy(model.context.require, { apply(target, thisArg, args) {
    const value = Reflect.apply(target, thisArg, args);
    return args[0] === 'node:fs' ? { ...value, watch() { throw new Error('directory_notifications_forbidden'); } } : value;
  } });
  vm.runInNewContext(source, model.context);
  model.releaseReady(); await new Promise(setImmediate);
  assert.equal(JSON.parse(fs.readFileSync(model.readyPath, 'utf8')).process_id, 123);
  fs.writeFileSync(model.stopPath, 'owned-launch-nonce');
  model.readStop();
  assert.deepEqual(model.events.slice(-2), ['destroy', 'quit']);
  assert.equal(model.timers.size, 0);
});
