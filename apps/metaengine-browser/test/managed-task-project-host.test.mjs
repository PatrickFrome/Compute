import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createManagedTaskProjectHost } from '../src/managed-task-project-host.mjs';
import { createManagedTaskProjectSqliteJournal } from '../src/managed-task-project-sqlite-journal.mjs';
import { createShellFreeGitExecutor } from '../src/managed-task-project-runtime.mjs';
import { MANAGED_PROJECT_ADMISSION_SCHEMA } from '../src/managed-task-project-command-adapter.mjs';
import { createWorkspaceReservation } from '../src/workspace-manager.mjs';
import { SupervisorLoopbackRpcServer } from '../src/supervisor-loopback-rpc-server.mjs';
import { configureManagedTaskProjectRepository, MANAGED_TASK_PROJECT_REPOSITORY_CONFIG_SCHEMA } from '../src/managed-task-project-repository.mjs';
import { managedProjectEffectKey } from '../src/managed-task-project-authority-resolver.mjs';

const exec = promisify(execFile);
const verified = async (_target, { operation = 'VERIFY_FILE' } = {}) => ({ owner_dacl_verified: true, operation });
const unitStorage = { protectStorage: () => verified(null, { operation: 'PROTECT_DIRECTORY' }), verifyStorage: verified };

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-project-host-')));
  const userDataPath = path.join(root, 'user-data'); const repo = path.join(root, 'repo'); const managed = path.join(root, 'projects');
  await fs.mkdir(userDataPath); await fs.mkdir(repo); await fs.mkdir(managed);
  const git = argv => exec('git', argv, { cwd: repo, shell: false, windowsHide: true });
  await git(['init', '-q']);
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'seed']);
  const { stdout } = await git(['rev-parse', 'HEAD']);
  const claim = { coordination_workspace_id: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4', task_id: 'cc891801-2adf-4561-8f7a-8091162032ff',
    claim_id: 46, point_id: 'task.project.v1', claim_class: 'MUTATING', base_sha: stdout.trim(), branch_name: 'work/host-test',
    agent_id: 'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510', tab_id: 'tab_dcfb4a80-ca6d-4614-ad5f-4877391ab12d', target_id: 'webcontents:7',
    agent_generation_epoch: 9, lease_generation: 1, lease_expires_at: new Date(Date.now() + 600000).toISOString() };
  const reservation = createWorkspaceReservation({ claim, trusted_repo: { repo_id: 'github:test/repo', repo_root: repo },
    workspace_root: managed, workspace_id: '11111111-2222-4333-8444-555555555555', worktree_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
  const request = Object.fromEntries(['coordination_workspace_id', 'task_id', 'agent_id', 'claim_id', 'lease_generation', 'workspace_id', 'workspace_generation'].map(key => [key, reservation[key]]));
  request.idempotency_key = 'host:task:create:v1';
  const h = { root, userDataPath, repo, managed, claim, reservation, request, adds: 0, opens: 0, finalized: [] };
  const executor = createShellFreeGitExecutor();
  h.options = { userDataPath, executeCommand: async command => ({ delegated: command.action }),
    resolveProjectBinding: async () => ({ schema: MANAGED_PROJECT_ADMISSION_SCHEMA, authoritative: true, active: true,
      claim: h.claim, workspace_binding: h.reservation, authority_effect: false }),
    reserveBinding: async row => assert.equal(row.state, 'RESERVED'),
    finalizeBinding: async entry => { h.finalized.push(entry.state); h.reservation = entry.reservation; },
    gitExecutor: { execute: plan => { if (plan.effect === 'WORKTREE_CREATE_LOCKED') h.adds++; return executor.execute(plan); } },
    openProject: async ({ path: projectPath, reservation: current }) => { assert.equal(projectPath, await fs.realpath(projectPath)); assert.equal(current.lease_expires_at, h.claim.lease_expires_at); h.opens++; },
  };
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return h;
}

async function loopback(host, root) {
  const token = 'host-test-token-private';
  const server = new SupervisorLoopbackRpcServer({ executeCommand: host.executeCommand, token, manifestPath: path.join(root, 'loopback.json') });
  await server.start();
  return { stop: () => server.stop(), async command(action, payload, authorized = true) {
    const response = await fetch(`http://127.0.0.1:${server.snapshot().port}/rpc`, { method: 'POST',
      headers: { 'content-type': 'application/json', ...(authorized ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ method: 'supervisor.command', params: { command: { action, payload } } }) });
    return { status: response.status, body: await response.json() };
  } };
}

test('private durable host shares one effect across arbitrary CLI key and UI key after restart', async t => {
  const h = await fixture(t);
  // Default storage functions exercise real Windows DACL setup and readback.
  let host = await createManagedTaskProjectHost(h.options); let rpc = await loopback(host, h.root);
  try {
    assert.equal((await rpc.command('PROJECT_CREATE', h.request, false)).status, 401); assert.equal(h.adds, 0);
    const created = await rpc.command('PROJECT_CREATE', h.request);
    assert.equal(created.body.ok, true); assert.equal(created.body.result.state, 'PROVEN'); assert.equal(h.adds, 1);
    assert.notEqual(created.body.result.idempotency_key, h.request.idempotency_key);
    assert.equal(created.body.result.idempotency_key, managedProjectEffectKey(h.request));
    assert.equal(host.snapshot().private_storage_verified, true); assert.equal(host.snapshot().durable_journal, true);
    assert.equal((await rpc.command('POLL', {})).body.result.delegated, 'POLL');
    await rpc.stop(); await host.close();
    h.claim = { ...h.claim, lease_expires_at: new Date(Date.now() + 900000).toISOString() };
    h.reservation = { ...h.reservation, lease_expires_at: h.claim.lease_expires_at };
    host = await createManagedTaskProjectHost(h.options); rpc = await loopback(host, h.root);
    const opened = await rpc.command('PROJECT_OPEN', { ...h.request, idempotency_key: managedProjectEffectKey(h.request) });
    assert.equal(opened.body.ok, true); assert.equal(opened.body.result.replayed, true); assert.equal(opened.body.result.opened, true);
    assert.equal(opened.body.authority_effect, false); assert.equal(opened.body.result.scheduler_authority, false);
    assert.equal(h.opens, 1); assert.equal(h.adds, 1); assert.deepEqual(h.finalized, ['PROVEN', 'PROVEN']);
    await rpc.stop(); await host.close();
    const journal = createManagedTaskProjectSqliteJournal({ filePath: path.join(h.userDataPath, 'managed-task-projects-v1', 'effects.sqlite') });
    try {
      assert.equal((await journal.find(managedProjectEffectKey(h.request))).state, 'PROVEN');
      assert.equal(await journal.find(h.request.idempotency_key), null);
    } finally { await journal.close(); }
  } finally { await rpc.stop(); await host.close(); }
});

test('host restart reconciles committed reservation after terminal journal failure without replaying physical creation', async t => {
  const h = await fixture(t);
  const host = await createManagedTaskProjectHost({ ...h.options, ...unitStorage,
    createJournal(options) {
      const journal = createManagedTaskProjectSqliteJournal(options);
      return { ...journal, append: entry => entry.state === 'PROVEN' ? Promise.reject(new Error('test_terminal_commit_lost')) : journal.append(entry) };
    },
  });
  await assert.rejects(host.executeCommand({ action: 'PROJECT_CREATE', payload: h.request }), /test_terminal_commit_lost/);
  assert.equal(h.adds, 1); await host.close();
  const restarted = await createManagedTaskProjectHost({ ...h.options, ...unitStorage }); const rpc = await loopback(restarted, h.root);
  try {
    const recovered = await rpc.command('PROJECT_OPEN', h.request);
    assert.equal(recovered.body.ok, true); assert.equal(recovered.body.result.state, 'PROVEN'); assert.equal(recovered.body.result.replayed, true);
    assert.equal(h.adds, 1); assert.equal(h.opens, 1);
  } finally { await rpc.stop(); await restarted.close(); }
});

test('host refuses forged payloads and stale authoritative bindings without local effects', async t => {
  const h = await fixture(t); const host = await createManagedTaskProjectHost({ ...h.options, ...unitStorage });
  const rpc = await loopback(host, h.root);
  try {
    assert.equal((await rpc.command('PROJECT_CREATE', { ...h.request, repo_root: h.repo })).body.ok, false);
    h.claim = { ...h.claim, lease_expires_at: '2020-01-01T00:00:00.000Z' };
    h.reservation = { ...h.reservation, lease_expires_at: h.claim.lease_expires_at };
    assert.equal((await rpc.command('PROJECT_CREATE', h.request)).body.ok, false);
    assert.equal(h.adds, 0); assert.equal(h.opens, 0); assert.deepEqual(h.finalized, []);
  } finally { await rpc.stop(); await host.close(); }
});

test('closing stops project intake and drains an in-flight command before journal close', async t => {
  const h = await fixture(t); let release; let entered; let closed = false;
  const paused = new Promise(resolve => { entered = resolve; });
  const block = new Promise(resolve => { release = resolve; });
  const host = await createManagedTaskProjectHost({ ...h.options, ...unitStorage,
    resolveProjectBinding: async input => { entered(); await block; return h.options.resolveProjectBinding(input); },
    createJournal(options) { const journal = createManagedTaskProjectSqliteJournal(options); return { ...journal, close: async () => { closed = true; await journal.close(); } }; },
  });
  const effect = host.executeCommand({ action: 'PROJECT_CREATE', payload: h.request }); await paused;
  const close = host.close(); assert.equal(host.close(), close); assert.equal(host.snapshot().state, 'CLOSING'); assert.equal(closed, false);
  await assert.rejects(host.executeCommand({ action: 'PROJECT_OPEN', payload: h.request }), /host_closed/);
  release(); assert.equal((await effect).state, 'PROVEN'); await close;
  assert.equal(closed, true); assert.equal(host.snapshot().state, 'CLOSED'); assert.equal(h.adds, 1);
});

test('unverified private storage cannot open SQLite or execute Git', async t => {
  const h = await fixture(t); let journals = 0;
  await assert.rejects(createManagedTaskProjectHost({ ...h.options, platform: 'win32',
    protectStorage: async () => ({ owner_dacl_verified: false, operation: 'PROTECT_DIRECTORY' }),
    createJournal() { journals++; throw new Error('unreachable'); },
  }), /storage_unverified/);
  assert.equal(journals, 0); assert.equal(h.adds, 0);
});

test('an existing private directory must be verified without silently rewriting its ACL', async t => {
  const h = await fixture(t); await fs.mkdir(path.join(h.userDataPath, 'managed-task-projects-v1'));
  let protectedAgain = 0; let journals = 0;
  await assert.rejects(createManagedTaskProjectHost({ ...h.options, platform: 'win32',
    protectStorage: async () => { protectedAgain++; return { owner_dacl_verified: true, operation: 'PROTECT_DIRECTORY' }; },
    verifyStorage: async () => { throw new Error('private_test_acl_broadened'); },
    createJournal() { journals++; throw new Error('unreachable'); },
  }), /private_test_acl_broadened/);
  assert.equal(protectedAgain, 0); assert.equal(journals, 0); assert.equal(h.adds, 0);
});

test('host provisions only its validated private operator configuration before asking for authoritative admission', async t => {
  const h = await fixture(t);
  const configuration = { schema: MANAGED_TASK_PROJECT_REPOSITORY_CONFIG_SCHEMA,
    coordination_workspace_id: h.claim.coordination_workspace_id, repo_id: h.reservation.repo_id, repo_root: h.repo, managed_root: h.managed };
  await configureManagedTaskProjectRepository({ userDataPath: h.userDataPath, repository: configuration, ...unitStorage });
  let provisioned = false;
  const host = await createManagedTaskProjectHost({ ...h.options, ...unitStorage,
    provisionRepository: async value => { assert.deepEqual(value, configuration); provisioned = true; },
    resolveProjectBinding: async request => { assert.equal(provisioned, true); return h.options.resolveProjectBinding(request); },
  });
  const rpc = await loopback(host, h.root);
  try {
    const forged = await rpc.command('PROJECT_CREATE', { ...h.request, repository: { repo_root: h.repo } });
    assert.equal(forged.body.ok, false); assert.equal(h.adds, 0); assert.equal(provisioned, false);
    const result = await rpc.command('PROJECT_CREATE', h.request);
    assert.equal(result.body.ok, true); assert.equal(host.snapshot().repository_state, 'PROVISIONED'); assert.equal(h.adds, 1);
  } finally { await rpc.stop(); await host.close(); }
});
