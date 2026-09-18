import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planLockedWorkspaceMaterialization,
  planLockedWorkspaceRetirement,
  planWorkspaceInventory,
  verifyWorkspaceInventory,
} from '../src/workspace-git-hardening.mjs';
import { createWorkspaceReservation, recordWorkspaceMaterializationReadback } from '../src/workspace-manager.mjs';

const claim = {
  coordination_workspace_id: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
  task_id: 'cc891801-2adf-4561-8f7a-8091162032ff',
  claim_id: 46,
  point_id: 'devbrowser.workspace.implement.v1',
  claim_class: 'MUTATING',
  base_sha: 'ebb5963a376fa5d8bb53a345457d298594d7b590',
  branch_name: 'work/devbrowser-workspace-manager-v1',
  agent_id: 'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510',
  tab_id: 'tab_dcfb4a80-ca6d-4614-ad5f-4877391ab12d',
  target_id: 'webcontents:7',
  agent_generation_epoch: 9,
  lease_generation: 1,
  lease_expires_at: '2026-08-31T14:30:00Z',
};

function reserved() {
  return createWorkspaceReservation({
    claim,
    trusted_repo: { repo_id: 'github:PatrickFrome/Compute', repo_root: '/trusted/compute' },
    workspace_root: '/managed/workspaces',
    workspace_id: '11111111-2222-4333-8444-555555555555',
    worktree_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  });
}

function ready() {
  const binding = reserved();
  return recordWorkspaceMaterializationReadback(binding, {
    effect_state: 'PROVEN',
    initial_head_sha: claim.base_sha,
    worktree_realpath: binding.worktree_path,
  });
}

function porcelain(binding, overrides = {}) {
  const head = overrides.head || claim.base_sha;
  const branch = overrides.branch || `refs/heads/${claim.branch_name}`;
  const locked = overrides.locked === false ? '' : `locked ${overrides.lock_reason || 'METAENGINE test'}\0`;
  const detached = overrides.detached ? 'detached\0' : '';
  const prunable = overrides.prunable ? 'prunable missing gitdir\0' : '';
  return `worktree ${binding.worktree_path}\0HEAD ${head}\0branch ${branch}\0${locked}${detached}${prunable}\0`;
}

test('materialization is atomically locked at git worktree add', () => {
  const binding = reserved();
  const plan = planLockedWorkspaceMaterialization(binding);
  assert.equal(plan.executable, 'git');
  assert.equal(plan.shell, false);
  assert.deepEqual(plan.argv.slice(0, 5), ['worktree', 'add', '--lock', '--reason', `METAENGINE:${binding.workspace_id}:task:${binding.task_id}:lease:${binding.lease_generation}`]);
  assert.equal(plan.argv.at(-1), claim.base_sha);
  assert.equal(plan.lock_required, true);
  assert.equal(plan.automatic_retry_allowed, false);
});

test('inventory uses stable porcelain-z machine format', () => {
  const plan = planWorkspaceInventory(reserved());
  assert.deepEqual(plan.argv, ['worktree', 'list', '--porcelain', '-z']);
  assert.equal(plan.shell, false);
  assert.equal(plan.authority_effect, false);
});

test('exact locked worktree inventory proves path, branch and head', () => {
  const binding = reserved();
  const proof = verifyWorkspaceInventory(binding, porcelain(binding));
  assert.equal(proof.head_sha, claim.base_sha);
  assert.equal(proof.branch_ref, `refs/heads/${claim.branch_name}`);
  assert.equal(proof.locked, true);
  assert.equal(proof.prunable, false);
  assert.equal(proof.authority_effect, false);
});

test('unlocked, prunable, detached, wrong-head and wrong-branch inventories fail closed', () => {
  const binding = reserved();
  assert.throws(() => verifyWorkspaceInventory(binding, porcelain(binding, { locked: false })), /workspace_git_inventory_not_locked/);
  assert.throws(() => verifyWorkspaceInventory(binding, porcelain(binding, { prunable: true })), /workspace_git_inventory_prunable/);
  assert.throws(() => verifyWorkspaceInventory(binding, porcelain(binding, { detached: true })), /workspace_git_inventory_detached/);
  assert.throws(() => verifyWorkspaceInventory(binding, porcelain(binding, { head: '1111111111111111111111111111111111111111' })), /workspace_git_inventory_head_mismatch/);
  assert.throws(() => verifyWorkspaceInventory(binding, porcelain(binding, { branch: 'refs/heads/work/other' })), /workspace_git_inventory_branch_mismatch/);
});

test('retirement keeps core cleanup fences and requires one executor lease across unlock/remove', () => {
  const binding = ready();
  assert.throws(() => planLockedWorkspaceRetirement(binding, { durable_reference_count: 1 }), /workspace_cleanup_referenced/);
  const sequence = planLockedWorkspaceRetirement(binding);
  assert.equal(sequence.same_executor_lease_required, true);
  assert.equal(sequence.steps.length, 2);
  assert.deepEqual(sequence.steps[0].argv, ['worktree', 'unlock', binding.worktree_path]);
  assert.deepEqual(sequence.steps[1].argv, ['worktree', 'remove', binding.worktree_path]);
  assert.equal(sequence.automatic_retry_allowed, false);
});
