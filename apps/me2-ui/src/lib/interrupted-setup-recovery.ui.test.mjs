import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const file = new URL('../components/me2/interrupted-setup-recovery.tsx', import.meta.url);
const source = ts.createSourceFile(file.pathname, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'InterruptedSetupRecovery');
const declarations = component.body.statements.filter(ts.isVariableStatement).flatMap(n => [...n.declarationList.declarations]);
function callback(name) {
  const item = declarations.find(n => ts.isIdentifier(n.name) && n.name.text === name);
  assert.ok(item?.initializer, `missing actual callback ${name}`);
  const node = ts.isCallExpression(item.initializer) ? item.initializer.arguments[0] : item.initializer;
  assert.ok(ts.isArrowFunction(node));
  return ts.transpileModule(`(${node.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
}
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
function fixture(read) {
  const statusWrites = [], busyWrites = [], messages = [], sends = [];
  const mounted = { current: true }, observationGeneration = { current: 1 }, operation = { current: true };
  const status = { schema: 'metaengine.client.interrupted-setup-status.v1', eligible: true, previous_effect_outcome: 'UNKNOWN', expected_recovery_sha256: 'a'.repeat(64) };
  const api = { inspectInterruptedSetupRecovery: read, startFreshSetup: async request => { sends.push(request); return { state: 'FRESH_SETUP_PREPARED', previous_effect_outcome: 'UNKNOWN', previous_effect_replayed: false }; } };
  const bindings = { mounted, observationGeneration, operation, status, bridge: () => api,
    setStatus: x => statusWrites.push(x), setBusy: x => busyWrites.push(x), setMessage: x => messages.push(x), refreshClientRuntimeStatus: async () => {} };
  return { mounted, observationGeneration, operation, status, api, statusWrites, busyWrites, messages, sends,
    readStatus: vm.runInNewContext(callback('readStatus'), bindings), start: vm.runInNewContext(callback('start'), bindings) };
}
test('initial recovery read publishes only after asynchronous native response', async () => {
  const pending = deferred(), started = deferred(); const h = fixture(() => { started.resolve(); return pending.promise; });
  const run = h.readStatus(1); assert.deepEqual(h.statusWrites, []); assert.deepEqual(h.busyWrites, []);
  await started.promise; pending.resolve(h.status); await run;
  assert.equal(h.statusWrites[0], h.status); assert.deepEqual(h.busyWrites, [false]); assert.equal(h.operation.current, false);
});
test('late recovery observation cannot publish or release a remounted operation', async () => {
  const pending = deferred(), started = deferred(); const h = fixture(() => { started.resolve(); return pending.promise; });
  const run = h.readStatus(1); await started.promise; h.mounted.current = false; h.observationGeneration.current = 2;
  h.mounted.current = true; pending.resolve(h.status); await run;
  assert.deepEqual(h.statusWrites, []); assert.deepEqual(h.busyWrites, []); assert.equal(h.operation.current, true);
});
test('synchronous bridge refusal is settled asynchronously with opaque UI error', async () => {
  const h = fixture(() => { throw Error('private credential value must not leak'); });
  const run = h.readStatus(1); assert.deepEqual(h.messages, []); await run;
  assert.deepEqual(h.statusWrites, [null]); assert.equal(h.messages.length, 1); assert.ok(!h.messages[0].includes('credential'));
});
test('unmounted recovery callback cannot dispatch a new setup', async () => {
  const h = fixture(async () => null); h.operation.current = false; h.mounted.current = false;
  await h.start(); assert.equal(h.sends.length, 0); assert.deepEqual(h.busyWrites, []);
});
test('late completed mutation never publishes into the next observation lifetime', async () => {
  const pending = deferred(); const h = fixture(async () => null); h.operation.current = false;
  h.api.startFreshSetup = request => { h.sends.push(request); return pending.promise; };
  const run = h.start(); assert.equal(h.sends.length, 1); h.observationGeneration.current = 2;
  pending.resolve({ state: 'FRESH_SETUP_PREPARED', previous_effect_outcome: 'UNKNOWN', previous_effect_replayed: false }); await run;
  assert.equal(h.operation.current, true); assert.deepEqual(h.statusWrites, []); assert.deepEqual(h.messages, [null]);
  assert.deepEqual(h.busyWrites, [true]); assert.equal(h.sends.length, 1);
});
