import assert from 'node:assert/strict';
import test from 'node:test';
import { ClientGoalJournal } from '../src/client-goal-journal.mjs';
import { ensureClientGoalProject } from '../src/client-goal-project-link.mjs';

const requestId = '11111111-1111-4111-8111-111111111111';
const taskId = '22222222-2222-4222-8222-222222222222';
const projectId = '33333333-3333-4333-8333-333333333333';
const registration = (extra = {}) => ({ schema: 'metaengine.devos.project-registration.v1', request_id: requestId,
  root_task_id: taskId, project_id: projectId, replayed: false, authority_effect: false, ...extra });
function store() {
  let value = null, fail = false;
  return { loadState: async () => structuredClone(value), saveState: async next => {
    if (fail) { fail = false; throw new Error('disk_write_failed'); }
    value = structuredClone(next);
  }, failNext: () => { fail = true; }, raw: () => structuredClone(value) };
}
async function admitted(storage = store()) {
  const journal = new ClientGoalJournal(storage); await journal.load();
  await journal.begin({ request_id: requestId, goal: 'Preserve this project history' });
  await journal.recordSubmission({ schema: 'metaengine.client.goal-submission.v1', request_id: requestId,
    task_id: taskId, exact_request_correlation: true });
  return { journal, storage };
}

test('durable admission links once and completed project survives a restart', async () => {
  const { journal, storage } = await admitted(); let calls = 0;
  const supervisor = { projectRegister: async input => { calls++; assert.deepEqual(input, { request_id: requestId }); return registration(); } };
  await ensureClientGoalProject({ journal, supervisor, request_id: requestId });
  await journal.recordProgress({ schema: 'metaengine.client.goal-progress.v1', request_id: requestId,
    task_id: taskId, found: true, task_state: 'COMPLETED' });
  const restored = new ClientGoalJournal(storage); await restored.load();
  assert.equal(restored.latest().state, 'COMPLETED'); assert.equal(restored.latest().project.project_id, projectId);
  await ensureClientGoalProject({ journal: restored, supervisor, request_id: requestId });
  assert.equal(calls, 1); assert.equal(restored.latest().authority_effect, false);
});

test('registration response loss preserves admitted goal and reposts the original ID only', async () => {
  const { journal } = await admitted(); const ids = []; let goals = 0;
  const supervisor = { clientGoalSubmit: async () => { goals++; }, projectRegister: async input => {
    ids.push(input.request_id); if (ids.length === 1) throw new Error('response_lost'); return registration({ replayed: true });
  }};
  assert.equal(await ensureClientGoalProject({ journal, supervisor, request_id: requestId }), null);
  assert.equal(journal.latest().state, 'ADMITTED'); assert.equal(journal.latest().project_error, 'response_lost');
  await ensureClientGoalProject({ journal, supervisor, request_id: requestId });
  assert.deepEqual(ids, [requestId, requestId]); assert.equal(goals, 0); assert.equal(journal.latest().project_error, null);
});

test('crash after remote registration before durable link recovers by exact replay', async () => {
  const { journal, storage } = await admitted(); let calls = 0;
  const supervisor = { projectRegister: async () => { calls++; return registration({ replayed: calls > 1 }); } };
  storage.failNext();
  await ensureClientGoalProject({ journal, supervisor, request_id: requestId });
  assert.equal(journal.latest().project, null); assert.equal(journal.latest().state, 'ADMITTED');
  const restored = new ClientGoalJournal(storage); await restored.load();
  await ensureClientGoalProject({ journal: restored, supervisor, request_id: requestId });
  assert.equal(calls, 2); assert.equal(restored.latest().project.project_id, projectId);
});

test('unconfirmed goal is never registered and exact progress can recover a lost admission response', async () => {
  const journal = new ClientGoalJournal(store()); await journal.load();
  await journal.begin({ request_id: requestId, goal: 'Recover lost receipt' }); let calls = 0;
  const supervisor = { projectRegister: async () => { calls++; return registration(); } };
  await ensureClientGoalProject({ journal, supervisor, request_id: requestId }); assert.equal(calls, 0);
  await journal.recordProgress({ schema: 'metaengine.client.goal-progress.v1', request_id: requestId,
    found: true, task_id: taskId, task_state: 'RUNNING' });
  await ensureClientGoalProject({ journal, supervisor, request_id: requestId }); assert.equal(calls, 1);
  await journal.recordProgress({ schema: 'metaengine.client.goal-progress.v1', request_id: requestId, found: false });
  assert.equal(journal.latest().project.project_id, projectId);
});

test('cross-request, root-task drift and project replacement fail closed', async () => {
  const { journal, storage } = await admitted();
  await assert.rejects(() => journal.recordProject(registration({ root_task_id: projectId })), /project_task_drift/);
  await assert.rejects(() => journal.recordProject(registration({ request_id: projectId })), /request_missing/);
  await journal.recordProject(registration());
  await assert.rejects(() => journal.recordProject(registration({ project_id: taskId })), /project_collision/);
  const changed = storage.raw(); changed.entries[0].project.root_task_id = projectId;
  await assert.rejects(() => new ClientGoalJournal({ ...storage, loadState: async () => changed }).load(), /project_task_drift/);
});
