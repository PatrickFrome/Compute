import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SupervisorLoopbackRpcServer } from '../src/supervisor-loopback-rpc-server.mjs';
import { managedProjectCommand, callManagedProject } from '../scripts/run-managed-project.mjs';
import { managedProjectEffectKey } from '../src/managed-task-project-authority-resolver.mjs';

const payload = { idempotency_key: 'client:project:once', coordination_workspace_id: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
  task_id: 'cc891801-2adf-4561-8f7a-8091162032ff', agent_id: 'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510',
  claim_id: 46, lease_generation: 1, workspace_id: '11111111-2222-4333-8444-555555555555', workspace_generation: 1 };

function provenResult(command) {
  const head = 'b'.repeat(40); const worktreePath = '/private/project';
  return { schema: 'metaengine.devos.managed-task-project-runtime.v1', state: 'PROVEN', action: command.action,
    idempotency_key: command.payload.idempotency_key,
    reservation: { ...command.payload, state: 'READY', repo_root: '/private/root', worktree_path: worktreePath,
      base_sha: head, authority_effect: false },
    proof: { schema: 'metaengine.devos.workspace-git-inventory-proof.v1', workspace_id: payload.workspace_id,
      workspace_generation: payload.workspace_generation, task_id: payload.task_id, lease_generation: payload.lease_generation,
      head_sha: head, worktree_path: worktreePath, locked: true, prunable: false, automatic_retry_allowed: false, authority_effect: false },
    replayed: true, opened: command.action === 'PROJECT_OPEN', secret: 'private-value', automatic_retry_allowed: false, authority_effect: false };
}

test('project CLI submits identity-only commands to the real authenticated loopback server', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-cli-'));
  const manifestPath = path.join(root, 'discovery.json'); let seen;
  const token = 'a'.repeat(64);
  const server = new SupervisorLoopbackRpcServer({ token, manifestPath, executeCommand: async command => {
    seen = command;
    return provenResult(command);
  } });
  await server.start();
  t.after(async () => { await server.stop(); await fs.rm(root, { recursive: true, force: true }); });
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const command = managedProjectCommand('open', payload);
  const result = await callManagedProject(manifest, command);
  assert.deepEqual(seen.payload, { ...payload, idempotency_key: managedProjectEffectKey(payload) });
  assert.equal(result.opened, true);
  assert.equal(result.replayed, true);
  assert.equal(JSON.stringify(result).includes('private-'), false);
  await assert.rejects(callManagedProject({ ...manifest, token: 'c'.repeat(64) }, command), /transport_failed/);
});

test('project CLI refuses caller paths and unsafe discovery without dispatch', async () => {
  assert.throws(() => managedProjectCommand('create', { ...payload, repo_root: '/caller/root' }), /request_invalid/);
  assert.throws(() => managedProjectCommand('create', { ...payload, lease_generation: '1' }), /identity_invalid/);
  let calls = 0;
  for (const url of ['https://127.0.0.1:2000/rpc', 'http://attacker.invalid:2000/rpc', 'http://127.0.0.1:2000/rpc?token=private', 'http://user:password@127.0.0.1:2000/rpc']) {
    await assert.rejects(callManagedProject({ schema: 'metaengine.supervisor.loopback-rpc.v1', token: 'a'.repeat(64), url },
      managedProjectCommand('create', payload), { fetchImpl: async () => { calls++; } }), /discovery_invalid/);
  }
  assert.equal(calls, 0);
});

test('project CLI cannot turn ambiguous or wrong-task receipts into completion', async () => {
  const manifest = { schema: 'metaengine.supervisor.loopback-rpc.v1', token: 'a'.repeat(64), url: 'http://127.0.0.1:2000/rpc' };
  const command = managedProjectCommand('create', payload);
  for (const state of ['AMBIGUOUS', 'PROVEN']) {
    const result = { schema: 'metaengine.devos.managed-task-project-runtime.v1', state, action: command.action,
      reservation: { workspace_id: payload.workspace_id, task_id: 'bbbbbbbb-2222-4333-8444-555555555555' },
      proof: { head_sha: 'b'.repeat(40) }, authority_effect: false };
    await assert.rejects(callManagedProject(manifest, command, { fetchImpl: async () => new Response(JSON.stringify({
      schema: manifest.schema, ok: true, result, authority_effect: false,
    })) }), /effect_not_proven/);
  }
});

test('project CLI rejects current-task receipts from another claim, attempt or physical proof', async () => {
  const manifest = { schema: 'metaengine.supervisor.loopback-rpc.v1', token: 'a'.repeat(64), url: 'http://127.0.0.1:2000/rpc' };
  const command = managedProjectCommand('create', payload);
  const drift = [
    result => { result.idempotency_key = 'another:request:key'; },
    result => { result.reservation.coordination_workspace_id = 'bbbbbbbb-2222-4333-8444-555555555555'; },
    result => { result.reservation.agent_id = 'agent_another-physical-owner'; },
    result => { result.reservation.claim_id++; },
    result => { result.reservation.lease_generation++; },
    result => { result.reservation.workspace_generation++; },
    result => { result.proof.head_sha = 'c'.repeat(40); },
    result => { result.proof.locked = false; },
    result => { result.proof.lease_generation++; },
    result => { result.proof.worktree_path = '/private/other-project'; },
  ];
  for (const mutate of drift) {
    const result = provenResult(command); mutate(result);
    await assert.rejects(callManagedProject(manifest, command, { fetchImpl: async () => new Response(JSON.stringify({
      schema: manifest.schema, ok: true, result, authority_effect: false,
    })) }), /effect_not_proven/);
  }
});
