import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createManagedTaskProjectCommandAdapter, MANAGED_PROJECT_ADMISSION_SCHEMA } from '../src/managed-task-project-command-adapter.mjs';
import { createManagedTaskProjectMemoryJournal, createShellFreeGitExecutor } from '../src/managed-task-project-runtime.mjs';
import { createWorkspaceReservation } from '../src/workspace-manager.mjs';
import { SupervisorLoopbackRpcServer } from '../src/supervisor-loopback-rpc-server.mjs';

const exec = promisify(execFile);

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-command-adapter-'));
  const repo = path.join(root, 'repo'); const managed = path.join(root, 'projects'); await fs.mkdir(repo); await fs.mkdir(managed);
  const git = args => exec('git', args, { cwd: repo, windowsHide: true }); await git(['init', '-q']);
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'seed']);
  const { stdout } = await git(['rev-parse', 'HEAD']);
  const claim = {
    coordination_workspace_id: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4', task_id: 'cc891801-2adf-4561-8f7a-8091162032ff', claim_id: 46,
    point_id: 'task.project.v1', claim_class: 'MUTATING', base_sha: stdout.trim(), branch_name: 'work/task-adapter-test',
    agent_id: 'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510', tab_id: 'tab_dcfb4a80-ca6d-4614-ad5f-4877391ab12d', target_id: 'webcontents:7',
    agent_generation_epoch: 9, lease_generation: 1, lease_expires_at: new Date(Date.now() + 600000).toISOString(),
  };
  const reservation = createWorkspaceReservation({ claim, trusted_repo: { repo_id: 'github:test/repo', repo_root: await fs.realpath(repo) }, workspace_root: await fs.realpath(managed), workspace_id: '11111111-2222-4333-8444-555555555555', worktree_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, claim, reservation, request: { idempotency_key: 'adapter:create:v1', coordination_workspace_id: claim.coordination_workspace_id, task_id: claim.task_id, agent_id: claim.agent_id, claim_id: claim.claim_id, lease_generation: claim.lease_generation, workspace_id: reservation.workspace_id, workspace_generation: reservation.workspace_generation }, git };
}

test('project commands require authoritative active MUTATING binding and delegate through existing executor', async t => {
  const h = await setup(t); const journal = createManagedTaskProjectMemoryJournal(); const git = createShellFreeGitExecutor(); const calls = [];
  const admission = { schema: MANAGED_PROJECT_ADMISSION_SCHEMA, authoritative: true, active: true, claim: h.claim, workspace_binding: h.reservation, authority_effect: false };
  const adapter = createManagedTaskProjectCommandAdapter({
    executeCommand: async command => ({ delegated: command.action }), resolveProjectBinding: async () => admission,
    journal, reserveBinding: async binding => { assert.equal(binding.state, 'RESERVED'); calls.push(binding.state); }, finalizeBinding: async entry => { calls.push(entry.state); },
    executePlan: async plan => { calls.push(plan.effect); return git.execute(plan); },
  });
  const result = await adapter({ action: 'PROJECT_CREATE', payload: h.request });
  assert.equal(result.state, 'PROVEN'); assert.equal(result.authority_effect, false); assert.equal(calls.filter(value => value === 'WORKTREE_CREATE_LOCKED').length, 1);
  assert.deepEqual(calls.filter(value => ['RESERVED', 'PROVEN'].includes(value)), ['RESERVED', 'PROVEN']);
  assert.deepEqual(await adapter({ action: 'CAPTURE', payload: {} }), { delegated: 'CAPTURE' });
});

test('existing authenticated loopback supervisor.command composes the project adapter', async t => {
  const h = await setup(t); const git = createShellFreeGitExecutor(); let adds = 0;
  const adapter = createManagedTaskProjectCommandAdapter({
    executeCommand: async () => { throw new Error('unexpected_fallback'); },
    resolveProjectBinding: async () => ({ schema: MANAGED_PROJECT_ADMISSION_SCHEMA, authoritative: true, active: true, claim: h.claim, workspace_binding: h.reservation, authority_effect: false }),
    journal: createManagedTaskProjectMemoryJournal(), reserveBinding: async () => {}, finalizeBinding: async () => {},
    executePlan: async plan => { if (plan.effect === 'WORKTREE_CREATE_LOCKED') adds++; return git.execute(plan); },
  });
  const server = new SupervisorLoopbackRpcServer({ executeCommand: adapter, token: 'test-only-project-token', manifestPath: path.join(h.root, 'loopback.json') });
  await server.start();
  try {
    const url = `http://127.0.0.1:${server.snapshot().port}/rpc`;
    const body = JSON.stringify({ method: 'supervisor.command', params: { command: { action: 'PROJECT_CREATE', payload: h.request } } });
    assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 401);
    assert.equal(adds, 0);
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-only-project-token' }, body });
    const result = await response.json();
    assert.equal(result.ok, true); assert.equal(result.result.state, 'PROVEN'); assert.equal(result.authority_effect, false); assert.equal(adds, 1);
  } finally { await server.stop(); }
});

test('loopback project payload cannot provide its own claim or paths', async t => {
  const h = await setup(t); let effects = 0;
  const adapter = createManagedTaskProjectCommandAdapter({ executeCommand: async () => ({ ok: true }), resolveProjectBinding: async () => ({ schema: MANAGED_PROJECT_ADMISSION_SCHEMA, authoritative: false }), journal: createManagedTaskProjectMemoryJournal(), reserveBinding: async () => {}, finalizeBinding: async () => {}, executePlan: async () => { effects++; } });
  await assert.rejects(adapter({ action: 'PROJECT_CREATE', payload: { ...h.request, claim: h.claim, repo_root: h.reservation.repo_root } }), /payload_invalid/);
  assert.equal(effects, 0);
});

test('stale, advisory or changed admission is fail closed before executor', async t => {
  const h = await setup(t); let effects = 0;
  const invalid = [
    { ...h.claim, claim_class: 'ADVISORY' },
    { ...h.claim, task_id: '11111111-2222-4333-8444-555555555555' },
  ];
  for (const claim of invalid) {
    const adapter = createManagedTaskProjectCommandAdapter({ executeCommand: async () => ({ ok: true }), resolveProjectBinding: async () => ({ schema: MANAGED_PROJECT_ADMISSION_SCHEMA, authoritative: true, active: true, claim, workspace_binding: h.reservation, authority_effect: false }), journal: createManagedTaskProjectMemoryJournal(), reserveBinding: async () => {}, finalizeBinding: async () => {}, executePlan: async () => { effects++; } });
    await assert.rejects(adapter({ action: 'PROJECT_OPEN', payload: h.request }), /authoritative|claim_class/);
  }
  assert.equal(effects, 0);
});
