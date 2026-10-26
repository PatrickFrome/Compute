import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the callbacks actually mounted by GoalComposer. These inert bridge
// observations exercise UI correlation and failures, not installed Owner proof.
const url = new URL('../components/me2/shell/me2-shell.tsx', import.meta.url);
const source = ts.createSourceFile(url.pathname, await readFile(url, 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const composer = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'GoalComposer');
assert.ok(composer?.body);
const declarations = composer.body.statements.filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations]);
function callback(name, context) {
  const declaration = declarations.find(node => ts.isIdentifier(node.name) && node.name.text === name);
  assert.ok(declaration && ts.isCallExpression(declaration.initializer)
    && ts.isIdentifier(declaration.initializer.expression) && declaration.initializer.expression.text === 'useCallback'
    && ts.isArrowFunction(declaration.initializer.arguments[0]), `${name} must be an actual useCallback arrow`);
  const executable = ts.transpileModule(`(${declaration.initializer.arguments[0].getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return vm.runInContext(executable, context);
}

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROOT = '11111111-1111-4111-8111-111111111111';
function receipt(requestId = A) {
  return { schema: 'metaengine.native-coding.goal-admission.v1', request_id: requestId,
    state: 'ADMITTED', root_task_id: ROOT, project_id: '11111111-2222-4333-8444-555555555555',
    physical_execution_proven: false, production_qualified: false, automatic_retry_allowed: false, authority_effect: false };
}
function entry(requestId = A, admitted = receipt(requestId)) {
  return { schema: 'metaengine.client.goal-journal-entry.v1', request_id: requestId,
    kind: 'NATIVE_CODING', goal: 'An isolated UI observation', state: admitted ? 'ADMITTED' : 'FAILED',
    receipt: admitted, progress: null, execution_proof: null,
    last_error: admitted ? null : 'native_goal_rejected_before_dispatch',
    automatic_retry_allowed: false, authority_effect: false };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}
function fixture(initial = entry()) {
  const observations = { errors: [], statusRequests: [], submissions: [], pending: [] };
  const mode = { schema: 'metaengine.client.goal-submission-mode.v1', kind: 'NATIVE_CODING',
    state: 'HOST_VERIFICATION_REQUIRED', reason: null, authority_effect: false, automatic_retry_allowed: false };
  const bridge = {
    latestGoal: async () => initial,
    goalStatus: async requestId => { observations.statusRequests.push(requestId); return {}; },
    goalSubmissionMode: async () => mode,
    workReadiness: async () => ({ execution_ready: true }),
    submitGoal: async goal => { observations.submissions.push(goal); throw new Error('native_goal_rejected_before_dispatch'); },
    typed_positive_api: true, generic_command_exposed: false,
  };
  const context = vm.createContext({
    receipt: initial?.receipt ?? null, journalEntry: initial, error: null, goal: 'Next isolated goal',
    mounted: { current: true }, loadSequence: { current: 0 }, operation: { current: null },
    clientControlBridge: () => bridge,
    modeObserver: { refresh: async () => mode },
    loadReadiness: async () => ({ execution_ready: true }),
    setJournalEntry(value) { context.journalEntry = value; },
    setReceipt(value) { context.receipt = value; },
    setError(value) { context.error = value; observations.errors.push(value); },
    setRefreshing() {},
    setPending(value) { observations.pending.push(value); },
    setGoal(value) { context.goal = value; },
  });
  context.loadLatest = callback('loadLatest', context);
  return { context, bridge, observations, load: context.loadLatest,
    refresh: callback('refreshProgress', context), submit: callback('submit', context) };
}

test('a newer admitted goal replaces its receipt and journal together', async () => {
  const f = fixture(), latest = entry(B);
  f.bridge.latestGoal = async () => latest;
  await f.load();
  assert.equal(f.context.journalEntry, latest);
  assert.equal(f.context.receipt, latest.receipt);
  assert.deepEqual(f.observations.submissions, []);
});

test('a newer pre-dispatch rejection clears the older task and project receipt', async () => {
  const f = fixture(), rejected = entry(B, null);
  f.bridge.latestGoal = async () => rejected;
  await f.load();
  assert.equal(f.context.journalEntry, rejected);
  assert.equal(f.context.receipt, null, 'a failed new request cannot inherit the previous project');
  await f.refresh();
  assert.deepEqual(f.observations.statusRequests, [B]);
  assert.deepEqual(f.observations.submissions, []);
});

test('an observed empty journal clears both the previous entry and its receipt', async () => {
  const f = fixture();
  f.bridge.latestGoal = async () => null;
  await f.load();
  assert.equal(f.context.journalEntry, null);
  assert.equal(f.context.receipt, null);
  await f.refresh();
  assert.deepEqual(f.observations.statusRequests, []);
  assert.deepEqual(f.observations.submissions, []);
});

for (const [name, change] of [
  ['receipt from another request', value => { value.receipt.request_id = A; }],
  ['progress from another request', value => { value.progress = { schema: 'metaengine.client.native-coding-goal-progress.v1', request_id: A }; }],
  ['result proof from another request', value => { value.execution_proof = { schema: 'metaengine.client.goal-execution-proof.v1', request_id: A, user_goal_to_result_readback: true }; }],
  ['unknown journal schema', value => { value.schema = 'unrecognized'; }],
  ['unknown receipt schema', value => { value.receipt.schema = 'unrecognized'; }],
]) test(`journal rejects ${name} and reports that retained details may be stale`, async () => {
  const original = entry(), f = fixture(original), malformed = entry(B);
  change(malformed);
  f.bridge.latestGoal = async () => malformed;
  await f.load();
  assert.equal(f.context.journalEntry, original);
  assert.equal(f.context.receipt, original.receipt);
  assert.match(f.context.error || '', /unavailable|invalid|stale/i);
  assert.deepEqual(f.observations.submissions, []);
});

test('a rejected journal read settles the fire-and-forget mount path with an explicit error', async () => {
  const original = entry(), f = fixture(original);
  f.bridge.latestGoal = async () => { throw new Error('IPC unavailable'); };
  await assert.doesNotReject(f.load());
  assert.equal(f.context.journalEntry, original);
  assert.equal(f.context.receipt, original.receipt);
  assert.match(f.context.error || '', /unavailable|stale/i);
});

test('a status refresh cannot clear the error from its failed journal readback', async () => {
  const f = fixture();
  f.bridge.latestGoal = async () => { throw new Error('IPC unavailable'); };
  await f.refresh();
  assert.match(f.context.error || '', /unavailable|stale/i);
  assert.equal(f.context.operation.current, null);
  assert.deepEqual(f.observations.statusRequests, [A]);
  assert.deepEqual(f.observations.submissions, []);
});

test('status refresh follows the newest journal request even when a previous receipt remains', async () => {
  const f = fixture();
  f.context.journalEntry = entry(B, null);
  f.bridge.latestGoal = async () => f.context.journalEntry;
  await f.refresh();
  assert.deepEqual(f.observations.statusRequests, [B]);
  assert.equal(f.context.receipt, null);
  assert.deepEqual(f.observations.submissions, []);
});

test('a later successful status read clears the prior observation error', async () => {
  const f = fixture();
  f.bridge.latestGoal = async () => { throw new Error('IPC unavailable'); };
  await f.refresh();
  assert.match(f.context.error || '', /unavailable|stale/i);
  f.bridge.latestGoal = async () => entry(B);
  await f.refresh();
  assert.equal(f.context.error, null);
  assert.equal(f.context.journalEntry.request_id, B);
  assert.equal(f.context.receipt.request_id, B);
});

for (const reject of [false, true]) test(`a superseded ${reject ? 'rejection' : 'read'} cannot replace a newer observation`, async () => {
  const f = fixture(), old = deferred();
  f.bridge.latestGoal = () => old.promise;
  const first = f.load();
  f.bridge.latestGoal = async () => entry(B, null);
  await f.load();
  if (reject) old.reject(new Error('late IPC failure')); else old.resolve(entry(A));
  await first;
  assert.equal(f.context.journalEntry.request_id, B);
  assert.equal(f.context.receipt, null);
  assert.equal(f.context.error, null);
});

for (const reject of [false, true]) test(`an unmounted ${reject ? 'rejection' : 'read'} cannot publish presentation state`, async () => {
  const original = entry(), f = fixture(original), pending = deferred();
  f.bridge.latestGoal = () => pending.promise;
  const reading = f.load();
  f.context.mounted.current = false;
  f.context.loadSequence.current++;
  if (reject) pending.reject(new Error('late IPC failure')); else pending.resolve(entry(B));
  await reading;
  assert.equal(f.context.journalEntry, original);
  assert.equal(f.context.receipt, original.receipt);
  assert.deepEqual(f.observations.errors, []);
});

test('a failed submit plus failed readonly reconciliation settles without resending the effect', async () => {
  const f = fixture();
  f.bridge.latestGoal = async () => { throw new Error('IPC unavailable'); };
  await assert.doesNotReject(f.submit());
  assert.deepEqual(f.observations.submissions, ['Next isolated goal']);
  assert.deepEqual(f.observations.pending, [true, false]);
  assert.equal(f.context.operation.current, null);
  assert.match(f.context.error || '', /unavailable|stale/i);
  await f.refresh();
  assert.deepEqual(f.observations.submissions, ['Next isolated goal']);
});
