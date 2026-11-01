import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, deferred, element, flush, harness, loadUi } from './ui-reliability-harness.mjs';
import * as mode from './goal-submission-mode-observer.mjs';
import * as readFlight from './ui-read-flight.mjs';

// Execute the complete shipped GoalComposer with deterministic hooks and inert
// IPC reads. This verifies presentation/lifecycle, not native execution or stop.
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ROOT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const MISSING = Symbol('legacy-v1-without-control-state');

function entry(control = 'PAUSED', { requestId = A, taskState = 'RUNNING', projectState = 'ACTIVE', projectError = null } = {}) {
  const receipt = { schema: 'metaengine.native-coding.goal-admission.v1', state: 'ADMITTED', request_id: requestId,
    objective: 'Observe the existing project', project_id: PROJECT, root_task_id: ROOT,
    physical_execution_proven: false, production_qualified: false, automatic_retry_allowed: false, authority_effect: false };
  return { schema: 'metaengine.client.goal-journal-entry.v1', request_id: requestId, kind: 'NATIVE_CODING',
    goal: receipt.objective, state: 'ADMITTED', receipt, execution_proof: null, project_error: projectError, last_error: null,
    progress: { schema: 'metaengine.client.native-coding-goal-progress.v1', request_id: requestId, found: true,
      project_id: PROJECT, task_id: ROOT, task_state: taskState, project_state: projectState,
      ...(control === MISSING ? {} : { control_state: control }), total_tasks: 3, last_seq: 7,
      source: 'OWN_PG_PROJECT_SNAPSHOT', observed_at: '2026-11-01T12:00:00.000Z', terminal: projectState === 'COMPLETED',
      reconciliation_required: false, physical_execution_proven: false, automatic_retry_allowed: false, authority_effect: false },
    automatic_retry_allowed: false, authority_effect: false };
}

const text = node => typeof node === 'string' || typeof node === 'number' ? String(node)
  : (node?.children?.flat(Infinity) ?? []).map(text).join('');

function fixture(t, initial = entry()) {
  const ui = harness(), time = clock(), reads = [], effects = [];
  let latest = async () => initial;
  const forbidden = name => async () => { effects.push(name); throw Error('observation must not dispatch an effect'); };
  const bridge = {
    typed_positive_api: true, generic_command_exposed: false,
    latestGoal: () => { reads.push('latestGoal'); return latest(); },
    goalStatus: async requestId => { reads.push(['goalStatus', requestId]); return {}; },
    goalSubmissionMode: async () => ({ schema: 'metaengine.client.goal-submission-mode.v1', kind: 'NATIVE_CODING',
      state: 'HOST_VERIFICATION_REQUIRED', reason: null, automatic_retry_allowed: false, authority_effect: false }),
    submitGoal: forbidden('submitGoal'), activatePreparedGoal: forbidden('activatePreparedGoal'),
    resumeAdmission: forbidden('resumeAdmission'), createProject: forbidden('createProject'), openProject: forbidden('openProject'),
  };
  const context = { ...ui, ...time, ...mode, ...readFlight, queueMicrotask,
    Date: class extends Date { static now = time.now; }, performance: { now: time.now },
    window: { ...time, metaengineClient: bridge }, document: { visibilityState: 'visible' },
    useMe2: selector => selector({ setPage() {} }), useToast: () => ({ toast() {} }),
    useClientRuntimeStatus: () => ({ state: 'UNAVAILABLE', readback: null }), refreshClientRuntimeStatus: async () => ({}),
    Dialog: 'dialog', DialogContent: 'content', DialogTitle: 'title', DialogDescription: 'description', InterruptedSetupRecovery: 'recovery',
  };
  const { GoalComposer } = loadUi('../components/me2/shell/me2-shell.tsx', ['GoalComposer'], context);
  const mount = () => ui.mount(GoalComposer, { detailOpen: true, onDetailOpenChange() {}, draft: {
    goal: '', setGoal() {}, acknowledgeGoal() {}, draftStorage: 'SAVED', isCurrent: () => true,
  } });
  const render = async () => { await flush(); ui.render(); await flush(); return ui.render(); };
  const refresh = async () => {
    const button = element(ui.render(), 'client-goal-refresh');
    assert.ok(button, 'existing goal must retain its read-only status control');
    assert.equal(button.props.disabled, false);
    button.props.onClick();
    return render();
  };
  t.after(() => { ui.unmount(); assert.deepEqual(effects, [], 'observing project control cannot dispatch native work'); });
  return { ui, time, reads, effects, mount, render, refresh, setLatest: read => { latest = read; } };
}

function control(tree, expected) {
  const compact = element(tree, 'client-native-project-control');
  const detail = element(tree, 'client-native-project-control-detail');
  assert.ok(compact, 'primary composer must show project control separately from task phase');
  assert.ok(detail, 'status dialog must show the same observed project control');
  for (const node of [compact, detail]) assert.match(text(node), new RegExp(`^Project control: ${expected}`));
  return { compact, detail };
}

for (const [taskState, projectState, phase] of [
  ['RUNNING', 'ACTIVE', 'Working'],
  ['SUSPENDED', 'WAITING_CHILDREN', 'Waiting for child tasks'],
  ['BLOCKED', 'BLOCKED', 'Blocked'],
]) test(`PAUSED project control stays separate from ${taskState}/${projectState} task phase`, async t => {
  const f = fixture(t, entry('PAUSED', { taskState, projectState })); f.mount();
  const tree = await f.render(); const nodes = control(tree, 'Paused');
  assert.equal(text(element(tree, 'client-goal-readback')), phase);
  assert.doesNotMatch(text(nodes.compact) + text(nodes.detail), /stopped|cleanup confirmed|execution proven/i);
});

for (const [value, label] of [['ACTIVE', 'Active'], ['COMPLETED', 'Completed'], [null, 'Unknown'], [MISSING, 'Unknown']])
  test(`whole composer renders ${String(value)} control without borrowing task or admission state`, async t => {
    // Even ACTIVE-looking task/admission fields cannot fill an absent control.
    const f = fixture(t, entry(value)); f.mount(); const tree = await f.render();
    control(tree, label); assert.equal(text(element(tree, 'client-goal-readback')), 'Working');
    assert.match(text(element(tree, 'client-goal-status-dialog')), /Execution, independent review, checkpoint and continuation require separate runtime evidence/);
  });

for (const value of ['PAUSED ', 'paused', 'STOPPED', true, 1, {}, ['ACTIVE']])
  test(`malformed control ${JSON.stringify(value)} cannot become positive project readiness`, async t => {
    const f = fixture(t, entry(value)); f.mount(); const tree = await f.render();
    const { compact, detail } = control(tree, 'Unknown');
    assert.doesNotMatch(text(compact) + text(detail), /Project control: (Paused|Active|Completed)/);
  });

for (const [name, change] of [
  ['wrong schema', { schema: 'metaengine.client.goal-progress.v1' }],
  ['wrong source', { source: 'CACHED_AGENT_REPORT' }],
  ['missing timestamp', { observed_at: undefined }],
  ['malformed timestamp', { observed_at: 'not-a-timestamp' }],
  ['unrelated project', { project_id: ROOT }],
  ['unrelated task', { task_id: PROJECT }],
  ['unrelated request', { request_id: B }],
  ['execution assertion', { physical_execution_proven: true }],
  ['retry assertion', { automatic_retry_allowed: true }],
  ['authority assertion', { authority_effect: true }],
]) test(`control needs native read provenance and exact correlation: ${name}`, async t => {
  const observed = entry('PAUSED'); Object.assign(observed.progress, change);
  const f = fixture(t, observed); f.mount(); control(await f.render(), 'Unknown');
});

test('project_error makes a retained control observation historical, without promoting it as current', async t => {
  const f = fixture(t, entry('PAUSED', { projectError: 'native_project_read_unavailable' })); f.mount();
  const tree = await f.render(); const { compact, detail } = control(tree, 'Unknown');
  assert.equal(text(element(tree, 'client-goal-readback')), 'Native observation unavailable');
  assert.match(text(compact) + String(compact.props.title ?? '') + text(detail), /last observed|historical|stale|previous/i);
});

test('failed latest read keeps old control historical and matching successful read restores current control', async t => {
  const f = fixture(t); f.mount(); control(await f.render(), 'Paused');
  f.setLatest(async () => { throw Error('private transport error'); });
  let tree = await f.refresh(); const { compact, detail } = control(tree, 'Unknown');
  assert.equal(text(element(tree, 'client-goal-readback')), 'Check task status');
  assert.match(text(compact) + String(compact.props.title ?? '') + text(detail), /last observed|historical|stale|previous/i);
  assert.doesNotMatch(text(tree), /private transport error/);
  f.setLatest(async () => entry('ACTIVE')); tree = await f.refresh();
  control(tree, 'Active'); assert.equal(text(element(tree, 'client-goal-readback')), 'Working');
});

for (const rejects of [false, true]) test(`late old request ${rejects ? 'failure' : 'reply'} cannot replace new request control after remount`, async t => {
  const old = deferred(), f = fixture(t); f.setLatest(() => old.promise); f.mount(); await f.render();
  f.ui.unmount(); f.setLatest(async () => entry('ACTIVE', { requestId: B })); f.mount();
  control(await f.render(), 'Active');
  if (rejects) old.reject(Error('obsolete private read')); else old.resolve(entry('PAUSED', { requestId: A }));
  const tree = await f.render(); control(tree, 'Active');
  assert.equal(text(element(tree, 'client-goal-readback')), 'Working');
  assert.match(text(element(tree, 'client-goal-status-dialog')), new RegExp(B));
  assert.doesNotMatch(text(tree), /obsolete private read|Project control: Paused/);
});
