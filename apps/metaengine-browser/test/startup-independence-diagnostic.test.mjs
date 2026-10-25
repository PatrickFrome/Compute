import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

// Diagnostic characterization, NOT an Electron integration test or proposed fix.
// Execute unchanged production function bodies; replace only effect boundaries.
const source = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function runDegradableStartupStep(');
const end = source.indexOf('\nasync function createWindow()', start);
assert.ok(start >= 0 && end > start);
function harness(overrides = {}) {
  const calls = [], scheduled = [];
  const context = vm.createContext({
    runtimeGenesisState: { initial_tabs: 0 }, ownerSafetyGates: null, fleet: null,
    initOwnerSafetyGates: async () => calls.push('owner'),
    configureUserSession: () => calls.push('session'),
    initFleet: async () => calls.push('fleet'),
    initDevelopmentPlane: async () => calls.push('development'),
    initRsiRuntime: async () => calls.push('rsi'),
    initNativeSupervisor: async () => calls.push('native'),
    publishSnapshot: async () => calls.push('snapshot'),
    recordStartupSubsystemReady: name => calls.push(`ready:${name}`),
    recordStartupSubsystemDegraded: name => calls.push(`degraded:${name}`),
    setImmediate: callback => scheduled.push(callback), ...overrides,
  });
  vm.runInContext(source.slice(start, end), context);
  return { calls, scheduled, context, run: () => context.bootstrapDegradableSubsystems() };
}
async function flushMicrotasks() { for (let i = 0; i < 20; ++i) await Promise.resolve(); }

test('diagnosis: permanently pending Fleet blocks all later runtime scheduling', async () => {
  const h = harness({ initFleet: () => new Promise(() => {}) });
  let settled = false;
  void h.run().then(() => { settled = true; });
  await flushMicrotasks();
  assert.ok(h.calls.includes('ready:USER_SESSION'));
  assert.equal(settled, false);
  assert.deepEqual(h.scheduled, []);
  assert.ok(!h.calls.includes('native'));
});

test('diagnosis: Fleet rejection degrades and permits later scheduling', async () => {
  const h = harness({ initFleet: async () => { throw Error('injected storage failure'); } });
  await h.run();
  assert.ok(h.calls.includes('degraded:FLEET'));
  assert.equal(h.context.fleet, null);
  assert.equal(h.scheduled.length, 3);
  h.scheduled.forEach(callback => callback());
  await flushMicrotasks();
  assert.ok(h.calls.includes('native'));
});

test('owner safety initialization is a real ordering prerequisite', async () => {
  let release;
  const h = harness({ initOwnerSafetyGates: () => new Promise(resolve => { release = resolve; }) });
  const running = h.run();
  await flushMicrotasks();
  assert.ok(!h.calls.includes('session'));
  assert.deepEqual(h.scheduled, []);
  release();
  await running;
  const ownerReadyAt = h.calls.indexOf('ready:OWNER_SAFETY_GATES');
  const sessionAt = h.calls.indexOf('session');
  assert.ok(ownerReadyAt >= 0 && sessionAt > ownerReadyAt);
});

test('diagnosis: pending shell snapshot also prevents native scheduling after Fleet settles', async () => {
  const h = harness({ publishSnapshot: () => new Promise(() => {}) });
  void h.run();
  await flushMicrotasks();
  assert.ok(h.calls.includes('ready:FLEET'));
  assert.equal(h.scheduled.length, 2);
  h.scheduled.forEach(callback => callback());
  await flushMicrotasks();
  assert.ok(h.calls.includes('development'));
  assert.ok(h.calls.includes('rsi'));
  assert.ok(!h.calls.includes('native'));
});

test('native startup has Fleet recovery and protected permit dependencies, not unconditional independence', () => {
  const nativeStart = source.indexOf('async function initNativeSupervisor()');
  const nativeEnd = source.indexOf('\nfunction destroyWindowContents()', nativeStart);
  const recoveryStart = source.indexOf('async function ensureInterruptedSetupRecovery()');
  const recoveryEnd = source.indexOf("ipcMain.handle('metaengine:client:interrupted-setup-inspect'", recoveryStart);
  assert.ok(nativeStart >= 0 && nativeEnd > nativeStart, 'native function boundaries must exist');
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, 'recovery function boundaries must exist');
  const native = source.slice(nativeStart, nativeEnd);
  const recovery = source.slice(recoveryStart, recoveryEnd);
  assert.match(recovery, /if \(!nativeSupervisor \|\| !fleet\) throw/);
  assert.match(recovery, /fleet: fleet.snapshot\(\)/);
  assert.match(recovery, /applyFleet: binding => fleet.archiveInterruptedBootstrapAgents\(binding\)/);
  const recoveryAt = native.indexOf('await ensureInterruptedSetupRecovery()');
  const startAt = native.indexOf('await nativeSupervisor.start()');
  assert.ok(recoveryAt >= 0 && startAt > recoveryAt, 'recovery must precede native start');
  assert.match(native, /catch \(error\) \{\s*nativeSupervisor.setInterruptedSetupRecoveryFence\(true\)/);
  assert.match(native, /if\(permits.length===0\|\|hashes.length!==1\) throw new Error\('native_coding_protected_permits_required'\)/);
});
