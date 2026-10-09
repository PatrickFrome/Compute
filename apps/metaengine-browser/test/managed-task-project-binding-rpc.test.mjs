import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceReservation } from '../src/workspace-manager.mjs';
import { createManagedTaskProjectBindingRpc } from '../src/managed-task-project-binding-rpc.mjs';

function reservation() {
  return createWorkspaceReservation({
    workspace_id: '4a27a3b1-384a-4e28-a99e-43e9cb62361c',
    worktree_id: '0bf659ab-1546-4c95-9fc0-8bdb82ecc2b2',
    trusted_repo: { repo_id: 'github:test/repo', repo_root: 'C:/repo' },
    workspace_root: 'C:/projects',
    claim: {
      coordination_workspace_id: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
      task_id: 'cc891801-2adf-4561-8f7a-8091162032ff', claim_id: 46,
      point_id: 'task.project.v1', claim_class: 'MUTATING', base_sha: 'a'.repeat(40),
      branch_name: 'work/task-project-test', agent_id: 'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510',
      tab_id: 'tab_dcfb4a80-ca6d-4614-ad5f-4877391ab12d', target_id: 'webcontents:7',
      agent_generation_epoch: 9, lease_generation: 1,
      lease_expires_at: new Date(Date.now() + 600000).toISOString(),
    },
  });
}

function result(operation, binding) {
  return { ok: true, operation, binding, automatic_retry_allowed: false, authority_effect: false };
}

test('reserve and exact proven readback use the existing workspace registry RPCs', async () => {
  const reserved = reservation();
  const calls = [];
  const rpc = async (name, params) => {
    calls.push({ name, params });
    return name.includes('_register_') ? result('register', { ...reserved }) : result('readback', {
      ...reserved, state: 'READY', initial_head_sha: reserved.base_sha,
      last_verified_head_sha: reserved.base_sha, worktree_realpath: reserved.worktree_path,
    });
  };
  const bridge = createManagedTaskProjectBindingRpc({ rpc });
  assert.equal((await bridge.reserveBinding(reserved)).state, 'RESERVED');
  const proof = { head_sha: reserved.base_sha, worktree_path: reserved.worktree_path, locked: true };
  const row = await bridge.finalizeBinding({ state: 'PROVEN', reservation: { ...reserved, state: 'READY' }, proof, automatic_retry_allowed: false, authority_effect: false });
  assert.equal(row.state, 'READY');
  assert.deepEqual(calls.map((call) => call.name), ['h205f22_a2_workspace_binding_register_v1', 'h205f22_a2_workspace_binding_readback_v1']);
  assert.equal(calls[0].params.p_claim_id, reserved.claim_id);
  assert.equal(calls[1].params.p_effect_state, 'PROVEN');
  assert.equal(calls[1].params.p_initial_head_sha, reserved.base_sha);
});

test('failed physical effect freezes the active DB binding', async () => {
  const reserved = reservation();
  const calls = [];
  const bridge = createManagedTaskProjectBindingRpc({ rpc: async (name, params) => {
    calls.push({ name, params });
    return result('readback', { ...reserved, state: 'FROZEN', ambiguity_code: 'PROJECT_FAILED' });
  } });
  const row = await bridge.finalizeBinding({ state: 'FAILED', reservation: reserved, reason: 'PROJECT_FAILED', automatic_retry_allowed: false, authority_effect: false });
  assert.equal(row.state, 'FROZEN');
  assert.equal(calls[0].params.p_effect_state, 'AMBIGUOUS');
});

test('drifted database identity and forged proven evidence fail closed', async () => {
  const reserved = reservation();
  const bridge = createManagedTaskProjectBindingRpc({ rpc: async () => result('register', { ...reserved, task_id: 'wrong' }) });
  await assert.rejects(() => bridge.reserveBinding(reserved), /managed_project_db_task_id_drift/);
  const noRpc = createManagedTaskProjectBindingRpc({ rpc: async () => { throw new Error('RPC should not run'); } });
  await assert.rejects(() => noRpc.finalizeBinding({ state: 'PROVEN', reservation: { ...reserved, state: 'READY' }, proof: { head_sha: 'b'.repeat(40), worktree_path: reserved.worktree_path, locked: true }, automatic_retry_allowed: false, authority_effect: false }), /managed_project_db_proof_invalid/);
});
