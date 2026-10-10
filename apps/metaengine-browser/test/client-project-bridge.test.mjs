import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { NativeSupervisorClient, NATIVE_SUPERVISOR_RUNTIME_PATH } from '../src/native-supervisor-client.mjs';
import { readProjectHistoryPage, readProjectOverview } from '../../me2-ui/src/lib/client-project-history.ts';

const projectId = '11111111-1111-4111-8111-111111111111';
const taskId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const task = () => ({ task_id: taskId, parent_task_id: null, depth: 0, state: 'RUNNING', role: 'CODER', task_seq: 1,
  claim_id: 99, lease_generation: 7, worktree_path: 'PRIVATE_PATH' });
const snapshot = () => ({ schema: 'metaengine.devos.project-snapshot.v1', found: true, project_id: projectId,
  root_task_id: taskId, request_id: requestId, state: 'ACTIVE', goal: 'Restore project continuity', last_seq: 20, total_tasks: 1,
  tasks: [task()], selected_task: task(), immediate_children: [], children_truncated: false,
  task_cursor: { after_seq: 0, next_seq: 1, has_more: false }, authority_effect: false });
const history = request => ({ schema: 'metaengine.devos.project-history.v1', project_id: projectId, authority_effect: false,
  entries: [{ seq: 20, causal_parent_seq: 19, task_id: taskId, attempt: 0, actor: 'agent_fixture',
    event_type: 'TASK_ACTIVITY', source: 'AGENT', content: { note: 'Progress reported' },
    created_at: '2026-10-10T12:00:00.000Z', verified_evidence: false, receipt_reference_verified: true,
    device_grant: 'PRIVATE_GRANT' }], cursor: { after_seq: request.after_seq, through_seq: 20, next_seq: 20,
    has_more: false, commit_ordered: true } });

test('actual NativeSupervisor typed methods sign inherited project routes and sanitize payloads for the UI', async () => {
  const signed = [], calls = [];
  const client = new NativeSupervisorClient({ identity: { snapshot: () => ({}), deviceHeaders: async (...args) => {
    signed.push(args); return { 'x-a2-device-signature': 'fixture' };
  } }, getState: async () => ({}), executeCommand: async () => assert.fail('project read executed an OS command'),
  fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ path: new URL(url).pathname, init, body });
    if (url.endsWith('/project/register')) return Response.json({ schema: 'metaengine.devos.project-registration.v1',
      project_id: projectId, root_task_id: taskId, request_id: requestId, replayed: false, authority_effect: false, worktree_path: 'PRIVATE_PATH' });
    if (url.endsWith('/project/snapshot')) return Response.json(snapshot());
    return Response.json(history(body));
  } });
  try {
    const registered = await client.projectRegister({ request_id: requestId });
    const overview = await client.projectSnapshot({ task_id: taskId });
    const request = { project_id: projectId, after_seq: 0, through_seq: null, limit: 128,
      task_id: taskId, attempt: 0, event_type: 'TASK_ACTIVITY' };
    const page = await client.projectHistory(request);
    assert.equal(registered.project_id, projectId); assert.equal(readProjectOverview(overview, taskId).selected_task.task_id, taskId);
    assert.equal(readProjectHistoryPage(page, request).entries[0].receipt_reference_verified, true);
    assert.deepEqual(calls.map(row => row.path.split('/').slice(-2).join('/')), ['project/register', 'project/snapshot', 'project/history']);
    assert.deepEqual(calls[0].body, { request_id: requestId });
    assert.deepEqual(calls[1].body, { project_id: null, task_id: taskId, task_after_seq: 0, limit: 128 });
    assert.deepEqual(calls[2].body, request);
    signed.forEach((row, index) => { assert.equal(row[0], 'POST');
      assert.equal(row[1], `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1/devos/project/${['register', 'snapshot', 'history'][index]}`);
      assert.equal(row[2], calls[index].init.body); assert.equal(calls[index].init.cache, 'no-store'); });
    assert.equal(JSON.stringify([registered, overview, page]).includes('PRIVATE_'), false);
    for (const request of [{ task_id: taskId, claim_id: 99 }, { task_id: taskId, worktree_path: 'x' },
      { project_id: projectId, task_id: taskId }, { task_id: taskId, limit: 129 }]) {
      await assert.rejects(client.projectSnapshot(request), /request_invalid/);
    }
    await assert.rejects(client.projectHistory({ project_id: projectId, device_grant: 'x' }), /request_invalid/);
    await assert.rejects(client.projectRegister({ request_id: requestId, claim: {} }), /request_invalid/);
    assert.equal(calls.length, 3);
  } finally { client.stop(); }
});

test('actual preload exposes bounded history reads to the primary renderer and rejects caller authority', async () => {
  const source = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
  function load(location) {
    const exposed = {}, calls = [];
    const electron = { contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } },
      ipcRenderer: { on() {}, invoke: (...args) => { calls.push(args); return Promise.resolve(null); } } };
    new vm.Script(source).runInContext(vm.createContext({ require: name => { assert.equal(name, 'electron'); return electron; }, location, process: { env: {} } }));
    return { exposed, calls };
  }
  const { exposed, calls } = load({ protocol: 'http:', hostname: '127.0.0.1', port: '8137' });
  const api = exposed.metaengineClient;
  await api.projectOverview(); await api.projectSnapshot({ task_id: taskId, limit: 128 });
  await api.projectHistory({ project_id: projectId, after_seq: 2, through_seq: 20, attempt: 0, event_type: 'TASK_ACTIVITY' });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['metaengine:client:project-overview'],
    ['metaengine:client:project-snapshot', { task_id: taskId, limit: 128 }],
    ['metaengine:client:project-history', { project_id: projectId, after_seq: 2, through_seq: 20, attempt: 0, event_type: 'TASK_ACTIVITY' }]]);
  for (const extra of [{ path: 'PRIVATE_PATH' }, { claim_id: 1 }, { device_grant: 'x' }, { scheduler_authority: true }]) {
    assert.throws(() => api.projectSnapshot({ task_id: taskId, ...extra }), /read_request_invalid/);
    assert.throws(() => api.projectHistory({ project_id: projectId, ...extra }), /read_request_invalid/);
  }
  for (const bad of [{ project_id: projectId, after_seq: -1 }, { project_id: projectId, limit: 129 },
    { project_id: projectId, after_seq: 10, through_seq: 9 }, { project_id: projectId, attempt: 1.5 },
    { project_id: projectId, event_type: 'task activity' }]) assert.throws(() => api.projectHistory(bad), /read_request_invalid/);
  assert.equal(calls.length, 3); assert.equal(api.projectRegister, undefined); assert.equal(api.projectSpawn, undefined);
  assert.equal(api.command, undefined);
  assert.equal(load({ protocol: 'https:', hostname: 'example.test', port: '' }).exposed.metaengineClient, undefined);
});

test('actual dedicated main handlers enforce sender identity and reject extra IPC arguments before a read', async () => {
  const source = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const handlers = new Map(), reads = [];
  const context = vm.createContext({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    assertShellSender: event => { if (event.sender !== 'shell') throw new Error('shell_sender_invalid'); },
    nativeSupervisor: { projectSnapshot: async input => { reads.push(input); return snapshot(); },
      projectHistory: async input => { reads.push(input); return history(input); } },
    latestClientGoal: async () => ({ project: { project_id: projectId } }) });
  for (const name of ['project-snapshot', 'project-history', 'project-overview']) {
    const start = source.indexOf(`ipcMain.handle('metaengine:client:${name}'`);
    assert.ok(start > 0); const end = source.indexOf('\n});', start) + 4;
    new vm.Script(source.slice(start, end)).runInContext(context);
  }
  for (const [name, handler] of handlers) {
    await assert.rejects(handler({ sender: 'remote' }), /shell_sender_invalid/);
    const args = name.endsWith('overview') ? [1] : [{ task_id: taskId }, 1];
    await assert.rejects(handler({ sender: 'shell' }, ...args), /params_forbidden/);
  }
  assert.equal(reads.length, 0);
  await handlers.get('metaengine:client:project-snapshot')({ sender: 'shell' }, { task_id: taskId });
  await handlers.get('metaengine:client:project-history')({ sender: 'shell' }, { project_id: projectId, after_seq: 0 });
  await handlers.get('metaengine:client:project-overview')({ sender: 'shell' });
  assert.equal(reads.length, 3); assert.equal(reads[2].project_id, projectId);
});
