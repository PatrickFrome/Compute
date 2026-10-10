import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, access } from 'node:fs/promises';
import { normalizeWorkspaceBindingSnapshot } from '../src/workspace-binding-observer.mjs';
import { createManagedTaskProjectClientControl } from '../src/managed-task-project-client-control.mjs';

const now = Date.now();
const binding = () => ({ workspace_id: '33333333-3333-4333-8333-333333333333', workspace_generation: 1,
  coordination_workspace_id: '11111111-1111-4111-8111-111111111111', task_id: '22222222-2222-4222-8222-222222222222',
  claim_id: 17, agent_id: 'agent_project-client-001', point_id: 'project.client', repo_id: 'github:test/project',
  base_sha: 'a'.repeat(40), branch_name: 'work/project-client', tab_id: 'tab_project-client-001', target_id: 'webcontents:9',
  agent_generation_epoch: 4, lease_generation: 2, lease_expires_at: new Date(now + 600000).toISOString(),
  lease_current: true, state: 'RESERVED', last_verified_head_sha: null, ambiguity_code: null, dirty_hold: false,
  updated_at: new Date(now).toISOString(), automatic_retry_allowed: false, scheduler_authority: false,
  browser_actuation_authority: false, page_data_authority: false, authority_effect: false });
const snapshot = rows => normalizeWorkspaceBindingSnapshot({ schema: 'metaengine.devos.workspace-binding-snapshot.v1',
  state: 'AVAILABLE', coordination_workspace_id: binding().coordination_workspace_id, observed_at: new Date(now).toISOString(),
  bindings: rows || [binding()], filesystem_paths_exposed: false, scheduler_authority: false,
  browser_actuation_authority: false, automatic_retry_allowed: false, authority_effect: false });
const host = () => ({ schema: 'metaengine.devos.managed-task-project-host.v1', state: 'READY',
  durable_journal: true, private_storage_verified: true, authority_effect: false });
const proven = (command, row = binding()) => ({ schema: 'metaengine.devos.managed-task-project-runtime.v1',
  state: 'PROVEN', action: command.action, idempotency_key: command.payload.idempotency_key,
  automatic_retry_allowed: false, authority_effect: false, replayed: false,
  opened: command.action === 'PROJECT_OPEN', reservation: { ...row, schema: 'metaengine.devos.workspace-binding.v1',
    state: 'READY', repo_root: 'PRIVATE_ROOT', worktree_path: 'PRIVATE_PATH' },
  proof: { schema: 'metaengine.devos.workspace-git-inventory-proof.v1', workspace_id: row.workspace_id,
    workspace_generation: row.workspace_generation, task_id: row.task_id, lease_generation: row.lease_generation,
    head_sha: row.base_sha, branch_ref: `refs/heads/${row.branch_name}`, locked: true, prunable: false,
    worktree_path: 'PRIVATE_PATH', automatic_retry_allowed: false, authority_effect: false } });
const control = options => createManagedTaskProjectClientControl({ getObservation: () => snapshot(),
  getHostSnapshot: host, executeCommand: async command => proven(command), now: () => now, ...options });
const request = { workspace_id: binding().workspace_id };

test('product control derives current identities and keeps a stable key across restart and open', async () => {
  const calls = [];
  let observation = snapshot();
  const deps = { getObservation: () => observation, executeCommand: async command => { calls.push(command); return proven(command); } };
  const first = control(deps);
  const status = await first.status();
  assert.equal(status.state, 'AVAILABLE'); assert.equal(status.projects[0].can_create, true);
  assert.equal(status.projects[0].can_open, false);
  const created = await first.create(request);
  assert.equal(created.state, 'PROVEN'); assert.equal(created.head_sha, binding().base_sha);
  observation = snapshot([{ ...binding(), state: 'READY' }]);
  const restarted = control(deps);
  const opened = await restarted.open(request);
  assert.equal(opened.opened, true);
  assert.equal(calls[0].payload.idempotency_key, calls[1].payload.idempotency_key);
  assert.deepEqual(Object.keys(calls[0].payload).sort(), ['idempotency_key', 'coordination_workspace_id', 'task_id', 'agent_id', 'claim_id', 'lease_generation', 'workspace_id', 'workspace_generation'].sort());
  assert.equal(calls[0].payload.claim_id, binding().claim_id);
  assert(!JSON.stringify([status, created, opened]).includes('PRIVATE_'));
  assert(!Object.hasOwn(status.projects[0], 'claim_id'));
});

test('renderer cannot inject claims, paths, actions or unknown project identifiers', async () => {
  let calls = 0;
  const client = control({ executeCommand: async () => { calls++; } });
  for (const input of [null, [], {}, { ...request, claim_id: 1 }, { ...request, repo_root: '/tmp' },
    { ...request, action: 'DELETE' }, { workspace_id: 42 }]) {
    await assert.rejects(client.create(input), /request_invalid/);
  }
  await assert.rejects(client.create({ workspace_id: '55555555-5555-4555-8555-555555555555' }), /binding_missing/);
  assert.equal(calls, 0);
});

test('stale, ambiguous, fenced and unavailable observations cannot authorize effects', async () => {
  let calls = 0;
  const cases = [
    { getObservation: () => ({ ...snapshot(), observed_at: new Date(now - 45001).toISOString() }), reason: 'OBSERVATION_STALE' },
    { getObservation: () => ({ ...snapshot(), observed_at: null }), reason: 'OBSERVATION_STALE' },
    { getObservation: () => snapshot([binding(), binding()]), reason: 'BINDING_AMBIGUOUS' },
    { getObservation: () => ({ ...snapshot(), bindings: [{ ...binding(), repo_root: '/private' }] }), reason: 'OBSERVATION_UNAVAILABLE' },
    { getHostSnapshot: () => ({ ...host(), state: 'CLOSING' }), reason: 'HOST_UNAVAILABLE' },
  ];
  for (const { reason, ...options } of cases) {
    const client = control({ ...options, executeCommand: async () => { calls++; } });
    assert.equal((await client.status()).reason, reason);
    await assert.rejects(client.create(request), new RegExp(reason.toLowerCase()));
  }
  for (const patch of [{ lease_current: false }, { lease_expires_at: new Date(now - 1).toISOString() },
    { state: 'FROZEN' }, { dirty_hold: true }, { ambiguity_code: 'AMBIGUOUS' }]) {
    const client = control({ getObservation: () => snapshot([{ ...binding(), ...patch }]), executeCommand: async () => { calls++; } });
    assert.equal((await client.status()).projects[0].can_create, false);
    await assert.rejects(client.create(request), /lease_stale|binding_fenced/);
  }
  assert.equal(calls, 0);
});

test('a previously displayed ready state is reread and lease revocation blocks the click', async () => {
  let current = snapshot(); let calls = 0;
  const client = control({ getObservation: () => current, executeCommand: async () => { calls++; } });
  assert.equal((await client.status()).projects[0].can_create, true);
  current = snapshot([{ ...binding(), lease_current: false }]);
  await assert.rejects(client.create(request), /lease_stale/);
  assert.equal(calls, 0);
});

test('concurrent clicks are coalesced by workspace and rejection drains pending state', async () => {
  let finish; let calls = 0;
  const client = control({ executeCommand: command => { calls++; return new Promise(resolve => { finish = () => resolve(proven(command)); }); } });
  const running = client.create(request);
  await assert.rejects(client.create(request), /command_in_flight/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await client.status()).projects[0].in_flight, true);
  finish(); await running;
  assert.equal(calls, 1); assert.equal((await client.status()).projects[0].in_flight, false);
  const broken = control({ executeCommand: async () => { throw new Error('PRIVATE database error'); } });
  await assert.rejects(broken.create(request), /^Error: managed_project_client_effect_failed$/);
  assert.equal((await broken.status()).projects[0].in_flight, false);
});

test('success requires exact identity and physical proof, and open requires opened receipt', async () => {
  for (const change of [result => { result.state = 'AMBIGUOUS'; }, result => { result.reservation.claim_id++; },
    result => { result.idempotency_key = 'foreign:key'; }, result => { result.reservation.repo_id = 'foreign/repo'; },
    result => { result.proof.worktree_path = 'FOREIGN_PATH'; }, result => { result.proof.automatic_retry_allowed = true; },
    result => { result.proof.locked = false; }, result => { result.proof.head_sha = 'b'.repeat(40); },
    result => { result.proof.lease_generation++; }, result => { result.authority_effect = true; }]) {
    const client = control({ executeCommand: async command => { const result = proven(command); change(result); return result; } });
    await assert.rejects(client.create(request), /effect_not_proven/);
  }
  await assert.rejects(control().open(request), /project_not_ready/);
  const client = control({ getObservation: () => snapshot([{ ...binding(), state: 'READY' }]),
    executeCommand: async command => ({ ...proven(command), opened: false }) });
  await assert.rejects(client.open(request), /effect_not_proven/);
});

test('main imports an existing product control and fences dedicated IPC to the shell', async () => {
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  await access(new URL('../src/managed-task-project-client-control.mjs', import.meta.url));
  assert.match(main, /getObservation: \(\) => nativeSupervisor\?\.snapshot\(\)\?\.workspace_bindings/);
  for (const action of ['status', 'create', 'open']) {
    assert.match(main, new RegExp(`ipcMain.handle\\('metaengine:client:project-${action}', async \\(event,[\\s\\S]*?assertShellSender\\(event\\);[\\s\\S]*?managedTaskProjectClientControl\\.${action}\\(`));
  }
});
