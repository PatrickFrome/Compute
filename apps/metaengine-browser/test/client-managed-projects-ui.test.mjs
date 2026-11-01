import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createManagedProjectsView, validateManagedProjectStatus } from '../../me2-ui/src/lib/client-managed-projects.ts';
import { createManagedTaskProjectClientControl } from '../src/managed-task-project-client-control.mjs';

const timestamp = Date.parse('2026-10-10T08:00:00Z');
const status = () => ({
  schema: 'metaengine.client.managed-project-status.v1', state: 'AVAILABLE', host_state: 'READY',
  observed_at: new Date(timestamp).toISOString(), reason: null, authority_effect: false,
  projects: [{ workspace_id: 'workspace-a', task_id: 'task-a', agent_id: 'agent-a', state: 'RESERVED',
    workspace_generation: 1, repo_id: 'repo-a', branch_name: 'task/a', can_create: true, can_open: false,
    in_flight: false, reason: null }],
});
const proven = (action = 'PROJECT_CREATE') => ({
  schema: 'metaengine.client.managed-project-result.v1', ok: true, state: 'PROVEN', action,
  workspace_id: 'workspace-a', task_id: 'task-a', workspace_generation: 1,
  head_sha: 'a'.repeat(40), replayed: false,
  opened: action === 'PROJECT_OPEN', authority_effect: false, automatic_retry_allowed: false,
});
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('UI accepts only a fresh bounded native projection with consistent action capabilities', () => {
  assert.equal(validateManagedProjectStatus(status(), timestamp), true);
  const stale = status(); stale.observed_at = new Date(timestamp - 45_001).toISOString();
  const future = status(); future.observed_at = new Date(timestamp + 5_001).toISOString();
  const authority = status(); authority.authority_effect = true;
  const frozen = status(); frozen.projects[0].state = 'FROZEN';
  const inflight = status(); inflight.projects[0].in_flight = true;
  const duplicate = status(); duplicate.projects.push({ ...duplicate.projects[0] });
  const reservedOpen = status(); reservedOpen.projects[0].can_open = true;
  for (const payload of [stale, future, authority, frozen, inflight, duplicate, reservedOpen]) {
    assert.equal(validateManagedProjectStatus(payload, timestamp), false);
  }
  frozen.projects[0].can_create = false;
  assert.equal(validateManagedProjectStatus(frozen, timestamp), true);
});

test('explicit creation sends only the selected native workspace and blocks duplicate clicks', async () => {
  let complete; const calls = [];
  const bridge = { projectStatus: async () => status(),
    createProject: request => { calls.push(request); return new Promise(resolve => { complete = resolve; }); },
    openProject: async () => { throw new Error('unexpected open'); } };
  const view = createManagedProjectsView({ bridge: () => bridge, now: () => timestamp });
  await view.refresh();
  const pending = view.create('workspace-a');
  assert.equal(await view.create('workspace-a'), false);
  assert.equal(await view.open('workspace-a'), false);
  assert.deepEqual(calls, [{ workspace_id: 'workspace-a' }]);
  assert.equal(view.getSnapshot().pending.action, 'create');
  complete(proven());
  assert.equal(await pending, true);
  assert.equal(view.getSnapshot().pending, null);
  assert.deepEqual(view.getSnapshot().completed, { action: 'create', workspaceId: 'workspace-a' });
});

test('unknown selection and expired status cannot invoke native effects', async () => {
  let time = timestamp; let calls = 0;
  const view = createManagedProjectsView({ now: () => time, bridge: () => ({ projectStatus: async () => status(),
    createProject: async () => { calls++; return proven(); }, openProject: async () => { calls++; return proven('PROJECT_OPEN'); } }) });
  await view.refresh();
  assert.equal(await view.create('unregistered'), false);
  assert.equal(await view.open('workspace-a'), false);
  time += 45_001;
  assert.equal(await view.create('workspace-a'), false);
  assert.equal(calls, 0);
});

test('an unproven or mismatched receipt is reported without an automatic retry', async () => {
  for (const patch of [{ state: 'AMBIGUOUS' }, { workspace_id: 'foreign' }, { task_id: 'other-task' },
    { workspace_generation: 2 }, { head_sha: '' }, { replayed: undefined }, { authority_effect: true }, { automatic_retry_allowed: true }]) {
    let calls = 0;
    const view = createManagedProjectsView({ bridge: () => ({ projectStatus: async () => status(),
      createProject: async () => { calls++; return { ...proven(), ...patch }; }, openProject: async () => null }), now: () => timestamp });
    await view.refresh();
    assert.equal(await view.create('workspace-a'), false);
    assert.equal(view.getSnapshot().completed, null);
    assert.equal(view.getSnapshot().error, 'managed_project_client_result_invalid');
    assert.equal(calls, 1);
  }
});

test('OPEN requires a READY row and a confirmed native open result', async () => {
  const ready = status(); Object.assign(ready.projects[0], { state: 'READY', can_open: true });
  let opened = false;
  const view = createManagedProjectsView({ bridge: () => ({ projectStatus: async () => ready, createProject: async () => null,
    openProject: async () => ({ ...proven('PROJECT_OPEN'), opened }) }), now: () => timestamp });
  await view.refresh();
  assert.equal(await view.open('workspace-a'), false);
  opened = true;
  assert.equal(await view.open('workspace-a'), true);
});

test('status deadline clears positive actions and a late read cannot overwrite fresh state', async () => {
  let fail = false; let late; let expire; let calls = 0;
  const view = createManagedProjectsView({ bridge: () => ({
    projectStatus: () => { calls++; return fail ? new Promise(resolve => { late = resolve; }) : Promise.resolve(status()); },
    createProject: async () => proven(), openProject: async () => null,
  }), now: () => timestamp, schedule: fn => { expire = fn; return 1; }, cancel: () => {} });
  await view.refresh(); assert.ok(view.getSnapshot().status);
  fail = true;
  const hung = view.refresh(); const coalesced = view.refresh();
  assert.equal(hung, coalesced);
  assert.equal(view.getSnapshot().status, null);
  await flush(); expire(); await hung;
  assert.equal(view.getSnapshot().loading, false);
  fail = false; await view.refresh();
  assert.equal(calls, 2, 'a UI deadline does not release the physical status read');
  assert.equal(view.getSnapshot().status, null);
  late({}); await flush();
  assert.equal(view.getSnapshot().status, null, 'late data cannot restore a timed-out observation');
  await view.refresh();
  assert.ok(view.getSnapshot().status);
  assert.equal(calls, 3);
});

for (const outcome of ['resolve', 'reject']) test(`a timed-out status read retains its physical slot until ${outcome}`, async () => {
  let settle; let expire; let calls = 0;
  const view = createManagedProjectsView({ now: () => timestamp,
    bridge: () => ({
      projectStatus: () => {
        calls++;
        return calls === 1 ? new Promise((resolve, reject) => { settle = outcome === 'resolve' ? resolve : reject; }) : Promise.resolve(status());
      }, createProject: async () => proven(), openProject: async () => proven('PROJECT_OPEN'),
    }),
    schedule: fn => { expire = fn; return 1; }, cancel: () => {},
  });
  const observation = view.refresh(); await flush(); expire(); await observation;
  for (let n = 0; n < 10; n++) await view.refresh();
  assert.equal(calls, 1, 'polling and explicit refresh must not abandon unresolved native reads');
  assert.equal(view.getSnapshot().status, null);
  assert.equal(view.getSnapshot().loading, false);
  settle(outcome === 'resolve' ? status() : new Error('late private native failure')); await flush();
  assert.equal(view.getSnapshot().status, null, 'a late success or rejection never publishes');
  await view.refresh();
  assert.equal(calls, 2);
  assert.ok(view.getSnapshot().status);
});

test('missing IPC and native rejection preserve truthful unavailable/error state', async () => {
  const unavailable = createManagedProjectsView({ bridge: () => null, now: () => timestamp });
  await unavailable.refresh(); await unavailable.refresh();
  assert.equal(unavailable.getSnapshot().status, null);
  assert.equal(unavailable.getSnapshot().loading, false);
  let calls = 0;
  const view = createManagedProjectsView({ bridge: () => ({ projectStatus: async () => status(),
    createProject: async () => { calls++; throw new Error('managed_project_client_claim_revoked'); }, openProject: async () => null }), now: () => timestamp });
  await view.refresh(); assert.equal(await view.create('workspace-a'), false);
  assert.equal(view.getSnapshot().error, 'managed_project_client_claim_revoked');
  assert.equal(view.getSnapshot().pending, null);
  assert.equal(calls, 1);
});

test('UI consumes the actual native control projection and sanitized receipt', async () => {
  const workspaceId = '33333333-3333-4333-8333-333333333333';
  const row = { workspace_id: workspaceId, workspace_generation: 1,
    coordination_workspace_id: '11111111-1111-4111-8111-111111111111', task_id: '22222222-2222-4222-8222-222222222222',
    claim_id: 17, agent_id: 'agent_project-client-001', point_id: 'project.client', repo_id: 'github:test/project',
    base_sha: 'a'.repeat(40), branch_name: 'work/project-client', tab_id: 'tab_project-client-001', target_id: 'webcontents:9',
    agent_generation_epoch: 4, lease_generation: 2, lease_expires_at: new Date(timestamp + 600_000).toISOString(),
    lease_current: true, state: 'RESERVED', last_verified_head_sha: null, ambiguity_code: null, dirty_hold: false,
    updated_at: new Date(timestamp).toISOString(), automatic_retry_allowed: false, scheduler_authority: false,
    browser_actuation_authority: false, page_data_authority: false, authority_effect: false };
  let effects = 0;
  const client = createManagedTaskProjectClientControl({ now: () => timestamp,
    getObservation: () => ({ schema: 'metaengine.browser.workspace-binding-observer.v1', state: 'AVAILABLE',
      coordination_workspace_id: row.coordination_workspace_id, observed_at: new Date(timestamp).toISOString(), bindings: [row],
      filesystem_paths_exposed: false, scheduler_authority: false, browser_actuation_authority: false,
      automatic_retry_allowed: false, authority_effect: false }),
    getHostSnapshot: () => ({ schema: 'metaengine.devos.managed-task-project-host.v1', state: 'READY',
      durable_journal: true, private_storage_verified: true, authority_effect: false }),
    executeCommand: async command => {
      effects++;
      return { schema: 'metaengine.devos.managed-task-project-runtime.v1', state: 'PROVEN', action: command.action,
        idempotency_key: command.payload.idempotency_key,
        automatic_retry_allowed: false, authority_effect: false, replayed: false, opened: false,
        reservation: { ...row, schema: 'metaengine.devos.workspace-binding.v1', state: 'READY', worktree_path: 'PRIVATE_TEST_PATH' },
        proof: { schema: 'metaengine.devos.workspace-git-inventory-proof.v1', workspace_id: workspaceId,
          workspace_generation: row.workspace_generation, task_id: row.task_id, lease_generation: row.lease_generation,
          head_sha: row.base_sha, branch_ref: `refs/heads/${row.branch_name}`, locked: true, prunable: false,
          worktree_path: 'PRIVATE_TEST_PATH', automatic_retry_allowed: false, authority_effect: false } };
    },
  });
  const view = createManagedProjectsView({ now: () => timestamp,
    bridge: () => ({ projectStatus: client.status, createProject: client.create, openProject: client.open }) });
  await view.refresh();
  assert.equal(view.getSnapshot().status.projects[0].can_create, true);
  assert.equal(await view.create(workspaceId), true);
  assert.equal(effects, 1);
  assert.equal(view.getSnapshot().completed.workspaceId, workspaceId);
});

test('real preload exposes typed workspace selection only to the primary ME2 renderer', async () => {
  const source = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
  function execute(location) {
    const exposed = {}; const calls = [];
    const electron = { contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } },
      ipcRenderer: { on() {}, invoke: (...args) => { calls.push(args); return Promise.resolve({ ok: true }); } } };
    const context = vm.createContext({ require: name => { assert.equal(name, 'electron'); return electron; }, location, process: { env: {} } });
    new vm.Script(source, { filename: 'preload-shell.cjs' }).runInContext(context);
    return { exposed, calls };
  }
  const h = execute({ protocol: 'http:', hostname: '127.0.0.1', port: '8137' });
  const api = h.exposed.metaengineClient;
  await api.projectStatus(); await api.createProject({ workspace_id: 'workspace-a' }); await api.openProject({ workspace_id: 'workspace-a' });
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [['metaengine:client:project-status'],
    ['metaengine:client:project-create', { workspace_id: 'workspace-a' }], ['metaengine:client:project-open', { workspace_id: 'workspace-a' }]]);
  for (const request of [null, 'workspace-a', [], {}, { workspace_id: '' }, { workspace_id: 'task\nother' },
    { workspace_id: 'workspace-a', claim: {} }, { workspace_id: 'workspace-a', path: 'C:/foreign' }]) {
    assert.throws(() => api.createProject(request), /managed_project_client_request_invalid/);
    assert.throws(() => api.openProject(request), /managed_project_client_request_invalid/);
  }
  assert.equal(h.calls.length, 3);
  assert.equal(api.generic_command_exposed, false);
  assert.equal(api.project_operations_accept_caller_claim, false);
  assert.equal(api.project_operations_accept_caller_path, false);
  assert.equal(execute({ protocol: 'https:', hostname: 'example.com', port: '' }).exposed.metaengineClient, undefined);
});

for (const action of ['create', 'open']) test(`an unsettled ${action} stays held after observation expiry and independent status reads`, async () => {
  let complete; let effects = 0; let reads = 0; let next = 0;
  const timers = new Map();
  const available = status(); Object.assign(available.projects[0], { state: 'READY', can_open: true });
  const dispatch = () => { effects++; return new Promise(resolve => { complete = resolve; }); };
  const view = createManagedProjectsView({ now: () => timestamp,
    bridge: () => ({ projectStatus: async () => { reads++; return available; }, createProject: dispatch, openProject: dispatch }),
    schedule: (fn, ms) => { timers.set(++next, { fn, ms }); return next; }, cancel: id => timers.delete(id),
  });
  await view.refresh(); const original = view[action]('workspace-a');
  const deadline = [...timers.values()].find(timer => timer.ms === 8_000);
  assert.ok(deadline); deadline.fn();
  assert.equal(view.getSnapshot().pending.outcomeUnknown, true);
  assert.equal(view.getSnapshot().completed, null);
  assert.equal(view.getSnapshot().error, 'managed_project_client_outcome_unknown');
  await view.refresh();
  assert.equal(reads, 2);
  assert.equal(view.getSnapshot().pending.outcomeUnknown, true, 'a status row cannot settle the original operation receipt');
  assert.equal(await view.create('workspace-a'), false);
  assert.equal(await view.open('workspace-a'), false);
  assert.equal(effects, 1);
  complete(proven(action === 'open' ? 'PROJECT_OPEN' : 'PROJECT_CREATE'));
  assert.equal(await original, true);
  assert.equal(view.getSnapshot().pending, null);
  assert.equal(view.getSnapshot().error, null);
  assert.equal(view.getSnapshot().completed.action, action);
  assert.equal(timers.size, 0);
});
