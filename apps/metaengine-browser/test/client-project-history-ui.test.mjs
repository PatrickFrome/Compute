import assert from 'node:assert/strict';
import test from 'node:test';
import { readProjectHistoryPage, readProjectOverview, createProjectHistoryView, getClientProjectHistoryView } from '../../me2-ui/src/lib/client-project-history.ts';
import { normalizeClientProjectSnapshot, normalizeClientProjectHistory } from '../src/client-project-continuity.mjs';

const projectId = '11111111-1111-4111-8111-111111111111';
const taskId = '22222222-2222-4222-8222-222222222222';
const overview = () => ({ schema: 'metaengine.devos.project-snapshot.v1', found: true, project_id: projectId,
  root_task_id: taskId, request_id: '33333333-3333-4333-8333-333333333333', state: 'ACTIVE', goal: 'Implement continuity',
  last_seq: 3, total_tasks: 1, tasks: [{ task_id: taskId, parent_task_id: null, depth: 0, state: 'READY', role: 'CODER' }],
  task_cursor: { after_seq: 0, next_seq: 1, has_more: false }, authority_effect: false, automatic_retry_allowed: false,
  scheduler_authority: false });
const entry = (seq, type = 'TASK_STARTED') => ({ project_id: projectId, seq, causal_parent_seq: seq === 1 ? null : seq - 1,
  task_id: taskId, attempt: 1, actor: 'agent_a', event_type: type, content: { seq }, source: 'NATIVE_SUPERVISOR',
  created_at: new Date(1_700_000_000_000 + seq * 1000).toISOString(), verified_evidence: false,
  receipt_reference_verified: seq === 3 });
const page = (after, through, rows, hasMore) => ({ schema: 'metaengine.devos.project-history.v1', project_id: projectId,
  root_task_id: taskId, entries: rows, cursor: { after_seq: after, through_seq: through, next_seq: hasMore ? rows.at(-1)?.seq ?? after : through,
    has_more: hasMore, commit_ordered: true }, content_is_authority: false, authority_effect: false,
  automatic_retry_allowed: false, scheduler_authority: false });
const request = (after = 0, through = null) => ({ project_id: projectId, after_seq: after, through_seq: through, limit: 2,
  task_id: null, attempt: null, event_type: null });

test('history parser requires project binding, monotone causal rows and commit ordered cursor', () => {
  assert.equal(readProjectOverview(overview()).project_id, projectId);
  assert.deepEqual(readProjectHistoryPage(page(0, 3, [entry(1), entry(2)], true), request()), {
    entries: [entry(1), entry(2)].map((row) => ({ ...row, tool: null, artifact: null })),
    cursor: { after_seq: 0, through_seq: 3, next_seq: 2, has_more: true, commit_ordered: true },
  });
  const badProject = page(0, 3, [entry(1)], false); badProject.project_id = '44444444-4444-4444-8444-444444444444';
  const badCursor = page(0, 3, [entry(1)], true); badCursor.cursor.next_seq = 3;
  const badEvidence = page(0, 3, [entry(1)], false); badEvidence.entries[0].verified_evidence = true;
  const badSeq = page(0, 3, [entry(1), entry(1)], true);
  for (const [value, req] of [[badProject, request()], [badCursor, request()], [badEvidence, request()], [badSeq, request()]]) {
    assert.throws(() => readProjectHistoryPage(value, req), /project_history_/);
  }
});

test('history resource retains rows through reconnect, pins through_seq and catches up incrementally', async () => {
  let calls = 0; const requests = [];
  const bridge = { projectOverview: async () => overview(), projectHistory: async (req) => {
    requests.push(req); calls++;
    if (calls === 1) return page(0, 2, [entry(1), entry(2)], false);
    if (calls === 2) return page(2, 3, [entry(3, 'TASK_COMPLETED')], false);
    return page(3, 4, [entry(4, 'VERIFICATION_RECORDED')], false);
  }};
  const resource = createProjectHistoryView({ bridge: () => bridge, maxRows: 128, maxPages: 4 });
  await resource.refresh();
  assert.deepEqual(resource.getSnapshot().entries.map((row) => row.seq), [1, 2]);
  await resource.refresh();
  assert.deepEqual(resource.getSnapshot().entries.map((row) => row.seq), [1, 2, 3]);
  assert.equal(requests[1].after_seq, 2); assert.equal(requests[1].through_seq, null);
  assert.equal(await resource.refresh(), undefined);
  assert.deepEqual(resource.getSnapshot().entries.map((row) => row.seq), [1, 2, 3, 4]);
  assert.equal(requests[2].after_seq, 3); assert.equal(requests[2].through_seq, null);
});

test('invalid duplicate sequence is rejected and filters are sent as explicit scope', async () => {
  let calls = 0; let captured;
  const bridge = { projectOverview: async () => overview(), projectHistory: async (req) => {
    captured = req; calls++;
    if (calls === 1) return page(0, 2, [entry(1), entry(2)], false);
    const conflicting = entry(1); conflicting.content = { tampered: true };
    return page(0, 2, [entry(1), conflicting], false);
  }};
  const resource = createProjectHistoryView({ bridge: () => bridge });
  await resource.refresh();
  await resource.setFilters({ task_id: taskId, attempt: 1, event_type: 'TASK_STARTED' });
  assert.equal(captured.task_id, taskId); assert.equal(captured.attempt, 1); assert.equal(captured.event_type, 'TASK_STARTED');
  assert.equal(resource.getSnapshot().state, 'DEGRADED');
  assert.equal(resource.getSnapshot().entries.length, 0);
});

test('2000-row capacity stops automatic pagination and the next window resumes the pinned history', async () => {
  const requests = [];
  const bridge = { projectOverview: async () => overview(), projectHistory: async (req) => {
    requests.push(req);
    const rows = Array.from({ length: Math.min(req.limit, 3000 - req.after_seq) }, (_, index) => entry(req.after_seq + index + 1));
    return page(req.after_seq, 3000, rows, rows.at(-1)?.seq < 3000);
  }};
  const resource = createProjectHistoryView({ bridge: () => bridge });
  for (let index = 0; index < 4; index++) await resource.refresh();
  assert.equal(requests.length, 16); assert.equal(requests[15].limit, 80);
  assert.equal(resource.getSnapshot().entries.length, 2000); assert.equal(resource.getSnapshot().entries[0].seq, 1);
  assert.equal(resource.getSnapshot().entries.at(-1).seq, 2000); assert.equal(resource.getSnapshot().capacityReached, true);
  assert.equal(resource.getSnapshot().cursor.has_more, true);
  assert.ok(requests.slice(1).every(req => req.through_seq === 3000));
  await resource.refresh(); assert.equal(requests.length, 16); assert.equal(resource.getSnapshot().entries.length, 2000);
  await resource.nextWindow();
  assert.equal(requests[16].after_seq, 2000); assert.equal(requests[16].through_seq, 3000);
  assert.equal(resource.getSnapshot().entries[0].seq, 2001); assert.equal(resource.getSnapshot().windowStart, 2000);
});

test('invalid filters and unbound snapshot never invoke history effects', async () => {
  let calls = 0;
  const resource = createProjectHistoryView({ bridge: () => ({ projectOverview: async () => ({ schema: 'metaengine.devos.project-snapshot.v1', found: false,
    authority_effect: false, automatic_retry_allowed: false }), projectHistory: async () => { calls++; return null; } }) });
  await resource.refresh(); assert.equal(resource.getSnapshot().state, 'UNBOUND'); assert.equal(calls, 0);
  assert.throws(() => resource.setFilters({ task_id: 'bad', attempt: null, event_type: null }), /project_history_filter_invalid/);
});

test('failed overview and history reads retain the last good rows and can recover', async () => {
  let broken = '', through = 1;
  const bridge = { projectOverview: async () => { if (broken === 'overview') throw new Error('offline'); return overview(); },
    projectHistory: async req => { if (broken === 'history') throw new Error('offline'); return page(req.after_seq, through,
      req.after_seq < through ? [entry(through)] : [], false); } };
  const view = createProjectHistoryView({ bridge: () => bridge }); await view.refresh();
  const rows = view.getSnapshot().entries, cursor = view.getSnapshot().cursor;
  for (broken of ['overview', 'history']) {
    await view.refresh(); assert.equal(view.getSnapshot().state, 'DEGRADED');
    assert.equal(view.getSnapshot().entries, rows); assert.equal(view.getSnapshot().cursor, cursor); assert.equal(view.getSnapshot().busy, false);
  }
  broken = ''; through = 2; await view.refresh();
  assert.equal(view.getSnapshot().state, 'READY'); assert.deepEqual(view.getSnapshot().entries.map(row => row.seq), [1, 2]);
});

test('sparse filtered pages advance to the history highwater rather than the last displayed row', async () => {
  const requests = [];
  const view = createProjectHistoryView({ bridge: () => ({ projectOverview: async () => overview(), projectHistory: async req => {
    requests.push(req); return requests.length === 1 ? page(0, 900, [entry(15)], false) : page(900, 1200, [], false);
  } }) });
  await view.setFilters({ task_id: taskId, attempt: 1, event_type: 'TASK_STARTED' });
  await view.refresh(); assert.equal(requests[1].after_seq, 900); assert.equal(requests[1].through_seq, null);
  assert.equal(view.getSnapshot().cursor.next_seq, 1200); assert.deepEqual(view.getSnapshot().entries.map(row => row.seq), [15]);
});

test('filter reset rejects an old in-flight page without overwriting the new scope', async () => {
  let finishOld; let reads = 0;
  const view = createProjectHistoryView({ bridge: () => ({ projectOverview: async () => overview(), projectHistory: req => {
    reads++;
    if (reads === 1) return new Promise(resolve => { finishOld = resolve; });
    assert.equal(req.event_type, 'TASK_COMPLETED'); return Promise.resolve(page(0, 5, [entry(5, 'TASK_COMPLETED')], false));
  } }) });
  const oldRead = view.refresh();
  while (!finishOld) await Promise.resolve();
  await view.setFilters({ task_id: taskId, attempt: 1, event_type: 'TASK_COMPLETED' });
  finishOld(page(0, 1, [entry(1)], false)); await oldRead;
  assert.deepEqual(view.getSnapshot().entries.map(row => row.seq), [5]);
  assert.equal(view.getSnapshot().filters.event_type, 'TASK_COMPLETED'); assert.equal(view.getSnapshot().busy, false);
});

test('actual native normalizers feed the UI and reject a claim of independent evidence', () => {
  const expected = request();
  const sanitized = normalizeClientProjectHistory(page(0, 3, [entry(1), entry(2)], true), expected);
  assert.equal(readProjectHistoryPage(sanitized, expected).entries.length, 2);
  assert.equal(readProjectOverview(normalizeClientProjectSnapshot(overview(), { project_id: projectId })).project_id, projectId);
  const unverified = page(0, 3, [entry(1)], false); unverified.entries[0].verified_evidence = true;
  assert.throws(() => normalizeClientProjectHistory(unverified, expected), /history_entry_invalid/);
});

test('exact Task Sheet binding uses selected_task even when it is beyond the first task page', async () => {
  const childId = '44444444-4444-4444-8444-444444444444';
  const snapshot = overview(); snapshot.selected_task = { task_id: childId, parent_task_id: taskId, depth: 1, state: 'RUNNING', role: 'CODER' };
  snapshot.immediate_children = []; snapshot.total_tasks = 500; snapshot.task_cursor.has_more = true;
  assert.equal(readProjectOverview(normalizeClientProjectSnapshot(snapshot, { task_id: childId }), childId).selected_task.task_id, childId);
  assert.throws(() => normalizeClientProjectSnapshot(snapshot, { task_id: taskId }), /task_binding_invalid/);
  let snapshots = 0, latest = 0;
  globalThis.window = { metaengineClient: { projectOverview: async () => { latest++; return overview(); },
    projectSnapshot: async req => { snapshots++; assert.equal(req.task_id, childId); return normalizeClientProjectSnapshot(snapshot, req); },
    projectHistory: async req => page(req.after_seq, 0, [], false) } };
  try {
    const first = getClientProjectHistoryView(childId), second = getClientProjectHistoryView(childId);
    assert.equal(first, second); await first.refresh();
    assert.equal(first.getSnapshot().overview.selected_task.task_id, childId); assert.equal(snapshots, 1); assert.equal(latest, 0);
  } finally { delete globalThis.window; }
});
