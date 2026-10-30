import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { createGoalSubmissionModeObserver, goalSubmissionModeText } from './goal-submission-mode-observer.mjs';

// Execute the actual callback from GoalComposer. Parsing the TSX keeps these
// tests coupled to the shipped submit behavior without copying its control flow.
const shellUrl = new URL('../components/me2/shell/me2-shell.tsx', import.meta.url);
const source = ts.createSourceFile(shellUrl.pathname, await readFile(shellUrl, 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const composer = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'GoalComposer');
assert.ok(composer?.body, 'GoalComposer function must exist');
const submit = composer.body.statements.filter(ts.isVariableStatement)
  .flatMap(statement => [...statement.declarationList.declarations])
  .find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'submit');
assert.ok(submit && ts.isCallExpression(submit.initializer)
  && ts.isIdentifier(submit.initializer.expression) && submit.initializer.expression.text === 'useCallback'
  && ts.isArrowFunction(submit.initializer.arguments[0]), 'submit must be a useCallback arrow');
const executable = ts.transpileModule(`(${submit.initializer.arguments[0].getText(source)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;

function deferred() {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  return { promise, resolve };
}

function fixture(t) {
  const readiness = deferred(), readinessStarted = deferred();
  const sent = [], errors = [], pending = [], receipts = [], goals = [];
  const mounted = { current: true }, loadSequence = { current: 0 }, operation = { current: null };
  let draftCurrent = true;
  const bridge = {
    typed_positive_api: true,
    generic_command_exposed: false,
    goalSubmissionMode: async () => ({
      schema: 'metaengine.client.goal-submission-mode.v1', kind: 'BROWSER',
      state: 'HOST_VERIFICATION_REQUIRED', reason: null,
      authority_effect: false, automatic_retry_allowed: false,
    }),
    workReadiness: async () => readiness.promise,
    submitGoal: async value => {
      sent.push(value);
      return { schema: 'metaengine.client.goal-submission.v1', exact_activation_readback: true };
    },
  };
  const modeObserver = createGoalSubmissionModeObserver({ read: bridge.goalSubmissionMode, publish() {} });
  let stop = modeObserver.start();
  t.after(() => stop());
  const invoke = vm.runInNewContext(executable, {
    goal: '  Verify the browser goal  ', journalEntry: null, mounted, loadSequence, operation,
    clientControlBridge: () => bridge, modeObserver,
    loadReadiness: () => { readinessStarted.resolve(); return bridge.workReadiness(); },
    loadLatest: async () => {},
    setError: value => errors.push(value), setPending: value => pending.push(value),
    setReceipt: value => receipts.push(value), setGoal: value => goals.push(value),
    acknowledgeGoal: () => goals.push(''), setJournalEntry() {},
    isDraftCurrent: () => draftCurrent,
  });
  return {
    invoke, readiness, readinessStarted, sent, errors, pending, receipts, goals, operation,
    invalidateDraft() { draftCurrent = false; },
    unmount() { mounted.current = false; loadSequence.current += 1; stop(); },
    remount() { mounted.current = true; stop = modeObserver.start(); },
  };
}

test('navigation during Browser readiness cannot submit after composer unmount', async t => {
  const state = fixture(t);
  const pendingSubmit = state.invoke();
  await state.readinessStarted.promise;
  state.unmount();
  state.readiness.resolve({ execution_ready: true });
  await pendingSubmit;
  assert.deepEqual(state.sent, []);
  assert.deepEqual(state.receipts, []);
  assert.equal(state.operation.current, null);
});

test('scope generation loss during fresh readiness fences the earlier user intent', async t => {
  const state = fixture(t), pending = state.invoke();
  await state.readinessStarted.promise;
  state.invalidateDraft();
  state.readiness.resolve({ execution_ready: true });
  await pending;
  assert.deepEqual(state.sent, []); assert.deepEqual(state.goals, []); assert.deepEqual(state.errors, [null]);
});

test('a new mount cannot revive a submit waiting on an earlier readiness read', async t => {
  const state = fixture(t);
  const pendingSubmit = state.invoke();
  await state.readinessStarted.promise;
  state.unmount();
  state.remount();
  state.readiness.resolve({ execution_ready: true });
  await pendingSubmit;
  assert.deepEqual(state.sent, []);
  assert.deepEqual(state.goals, []);
  assert.equal(state.operation.current, null);
});

test('mounted Browser submit sends exactly once after readiness despite a concurrent click', async t => {
  const state = fixture(t);
  const pendingSubmit = state.invoke();
  await state.readinessStarted.promise;
  await state.invoke();
  assert.deepEqual(state.sent, [], 'no effect is sent before readiness');
  state.readiness.resolve({ execution_ready: true });
  await pendingSubmit;
  assert.deepEqual(state.sent, ['Verify the browser goal']);
  assert.equal(state.receipts.length, 1);
  assert.deepEqual(state.goals, ['']);
  assert.deepEqual(state.errors, [null]);
  assert.deepEqual(state.pending, [true, false]);
  assert.equal(state.operation.current, null);
});


test('actual composer initial mode label renders before any admission response',()=>{
 const declarations=composer.body.statements.filter(ts.isVariableStatement).flatMap(s=>[...s.declarationList.declarations]);
 const initial=declarations.find(d=>ts.isArrayBindingPattern(d.name)&&d.name.elements[0]?.name?.getText(source)==='goalMode');
 assert.equal(initial.initializer.arguments[0].kind,ts.SyntaxKind.NullKeyword);
 const text=declarations.find(d=>ts.isIdentifier(d.name)&&d.name.text==='modeText');
 const expression=ts.transpileModule(`(${text.initializer.getText(source)})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const label=vm.runInNewContext(expression,{goalMode:null,goalSubmissionModeText});assert.equal(label.label,'Admission not checked');assert.doesNotMatch(label.label,/Codex CLI|Chat planner/);
});
