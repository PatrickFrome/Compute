import assert from 'node:assert/strict';
import test from 'node:test';
import { projectActionFeed, projectFeedBinding, taskEventRowsConflict, validateTaskEventPage } from '../../me2-ui/src/lib/project-action-feed.mjs';

test('task feed is exact, bounded, ordered, and exposes an observed sequence watermark', () => {
  const feed = projectActionFeed({
    taskId: 'task-a',
    events: [
      { seq: 4, task_id: 'task-a', type: 'TASK_DONE' },
      { seq: 2, task_id: 'task-a', type: 'TASK_START' },
      { seq: 3, task_id: 'task-b', type: 'TASK_START' },
      { seq: 2, task_id: 'task-a', type: 'TASK_START' },
    ],
    limit: 10,
  });
  assert.deepEqual(feed.events.map((event) => [event.seq, event.type]), [[2, 'TASK_START'], [4, 'TASK_DONE']]);
  assert.deepEqual(feed.cursor, { after_seq: 4, latest_seq: 4 });
  assert.equal(feed.state, 'READY');
  assert.equal(feed.scope, 'task');
});

test('only explicit server resync signals invalidate a task cursor', () => {
  const feed = projectActionFeed({
    taskId: 'task-a',
    afterSeq: 5,
    resyncRequired: true,
    events: [{ seq: 9, task_id: 'task-a', type: 'TASK_DONE' }],
  });
  assert.equal(feed.events.length, 1);
  assert.equal(feed.resyncRequired, true);
  assert.equal(feed.state, 'RESYNC_REQUIRED');
});

test('unavailable transport is distinct from an empty feed', () => {
  const unavailable = projectActionFeed({ taskId: 'task-a', available: false });
  assert.equal(unavailable.state, 'UNAVAILABLE');
  assert.equal(unavailable.cursor, null);
  const empty = projectActionFeed({ taskId: 'task-a', events: [] });
  assert.equal(empty.state, 'READY');
  assert.deepEqual(empty.events, []);
  assert.equal(empty.cursor, null);
});

test('failed resync retains known events and a watermark never regresses on older rows', () => {
  const unavailable = projectActionFeed({ taskId: 'task-a', available: false, events: [{ seq: 8, task_id: 'task-a' }] });
  assert.equal(unavailable.state, 'UNAVAILABLE');
  assert.equal(unavailable.events[0].seq, 8);
  assert.equal(projectActionFeed({ afterSeq: 9, events: [{ seq: 4 }] }).cursor.latest_seq, 9);
});

test('contradictory duplicate sequences require resync', () => {
  const feed = projectActionFeed({ events: [{ seq: 1, data: 'before' }, { seq: 1, data: 'after' }] });
  assert.equal(feed.state, 'RESYNC_REQUIRED');
  assert.equal(feed.events[0].data, 'before');
  assert.equal(taskEventRowsConflict([{ seq: 1, data: 'before' }], [{ seq: 1, data: 'after' }]), true);
  assert.equal(taskEventRowsConflict([{ seq: 1, data: 'same' }], [{ data: 'same', seq: 1 }]), false);
});

test('sparse task sequence numbers do not imply missed actions without a server retention boundary', () => {
  const feed = projectActionFeed({
    taskId: 'task-a', afterSeq: 5,
    events: [{ seq: 40, task_id: 'task-a' }, { seq: null, task_id: 'task-a' }],
  });
  assert.equal(feed.resyncRequired, false);
  assert.deepEqual(feed.events.map((event) => event.seq), [40]);
});

test('project binding refuses to claim scope without server-provided identity', () => {
  assert.equal(projectFeedBinding({}).bound, false);
  assert.match(projectFeedBinding({}).reason, /not present/);
  assert.deepEqual(projectFeedBinding({ projectId: 'p-1' }), { bound: true, label: 'project p-1', reason: null });
});

const afterPage = () => ({
  ok: true, scope: { kind: 'task', task_id: 'task-a' },
  events: [{ seq: 9, task_id: 'task-a' }, { seq: 40, task_id: 'task-a' }],
  cursor: { mode: 'after', after_seq: 5, returned_through_seq: 40, latest_seq: 60, log_latest_seq: 99, has_more: true, has_earlier: false, resync_required: false, resync_reason: null },
});

test('validated server cursor advances through the returned page, not newest live event', () => {
  const result = validateTaskEventPage(afterPage(), { taskId: 'task-a', afterSeq: 5 });
  assert.equal(result.valid, true);
  assert.equal(result.cursor.returned_through_seq, 40);
  assert.equal(result.cursor.latest_seq, 60);
  assert.equal(result.cursor.has_more, true);
});

test('wire sequences and cursor watermarks must be numeric safe integers', () => {
  for (const mutate of [
    p => { p.events[0].seq = '9'; },
    p => { p.events[0].seq = null; },
    p => { p.cursor.returned_through_seq = '40'; },
    p => { p.cursor.latest_seq = '60'; },
    p => { p.cursor.log_latest_seq = '99'; },
    p => { p.cursor.latest_seq = Number.MAX_SAFE_INTEGER + 1; },
  ]) {
    const response = afterPage(); mutate(response);
    assert.equal(validateTaskEventPage(response, { taskId: 'task-a', afterSeq: 5 }).valid, false);
  }
  assert.equal(validateTaskEventPage({ ok: true, events: [{seq:'9',task_id:'task-a'}] }, {taskId:'task-a'}).valid, false);
});

test('rejects wrong task, regressing cursor and repeated continuation page', () => {
  for (const mutate of [
    (p) => { p.scope.task_id = 'task-b'; },
    (p) => { p.events[0].task_id = 'task-b'; },
    (p) => { p.cursor.after_seq = 4; },
    (p) => { p.cursor.returned_through_seq = 4; },
    (p) => { p.events[0].seq = 5; },
    (p) => { p.events = []; p.cursor.returned_through_seq = 5; },
    (p) => { p.cursor.has_more = false; },
  ]) {
    const response = afterPage();
    mutate(response);
    assert.equal(validateTaskEventPage(response, { taskId: 'task-a', afterSeq: 5 }).valid, false);
  }
});

test('server reset requires explicit latest-window resync and cannot advance cursor', () => {
  const response = afterPage();
  response.events = [];
  Object.assign(response.cursor, { after_seq: 100, returned_through_seq: 100, has_more: false, resync_required: true, resync_reason: 'CURSOR_AHEAD_OF_LOG' });
  const result = validateTaskEventPage(response, { taskId: 'task-a', afterSeq: 100 });
  assert.equal(result.valid, true);
  assert.equal(result.resyncRequired, true);
});

test('probe unavailability is never interpreted as a successful empty task history', () => {
  assert.equal(validateTaskEventPage({ ok: true, events: [], exact_task_history_available: false }, { taskId: 'task-a' }).valid, false);
  assert.equal(validateTaskEventPage({ ok: true, events: [] }, { taskId: 'task-a' }).valid, true);
  assert.equal(validateTaskEventPage({ ok: true, events: [] }, { taskId: 'task-a', afterSeq: 5 }).valid, false);
});
