import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspaceReservation,
  freezeWorkspace,
  normalizeMutationClaimBinding,
  planWorkspaceMaterialization,
  planWorkspaceRetirement,
  recordWorkspaceMaterializationReadback,
} from '../src/workspace-manager.mjs';

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

function reservation(overrides = {}) {
  return createWorkspaceReservation({
    claim: { ...claim, ...(overrides.claim || {}) },
    trusted_repo: {
      repo_id: 'github:PatrickFrome/Compute',
      repo_root: '/trusted/compute',
      ...(overrides.trusted_repo || {}),
    },
    workspace_root: overrides.workspace_root || '/managed/workspaces',
    workspace_id: overrides.workspace_id || '11111111-2222-4333-8444-555555555555',
    worktree_id: overrides.worktree_id || 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    workspace_generation: overrides.workspace_generation || 1,
  });
}

test('reservation binds exact task/agent/lease identity and derives manager-owned path', () => {
  const result = reservation();
  assert.equal(result.state, 'RESERVED');
  assert.equal(result.base_sha, claim.base_sha);
  assert.equal(result.task_id, claim.task_id);
  assert.equal(result.agent_id, claim.agent_id);
  assert.equal(result.lease_generation, 1);
  assert.match(result.worktree_path, /managed[\\/]workspaces/);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.page_data_authority, false);
  assert.equal(result.authority_effect, false);
});

test('advisory claims, branch traversal and malformed exact bindings fail closed', () => {
  assert.throws(
    () => normalizeMutationClaimBinding({ ...claim, claim_class: 'ADVISORY' }),
    /workspace_claim_class_not_mutating/,
  );
  assert.throws(
    () => normalizeMutationClaimBinding({ ...claim, branch_name: 'work\/..\/escape' }),
    /workspace_branch_name_invalid/,
  );
  assert.throws(
    () => normalizeMutationClaimBinding({ ...claim, base_sha: 'deadbeef' }),
    /workspace_base_sha_invalid/,
  );
  assert.throws(
    () => normalizeMutationClaimBinding({ ...claim, lease_generation: 0 }),
    /workspace_lease_generation_invalid/,
  );
});

test('materialization plan is fixed argv, shell-free and exact-base anchored', () => {
  const binding = reservation();
  const plan = planWorkspaceMaterialization(binding);
  assert.equal(plan.executable, 'git');
  assert.equal(plan.shell, false);
  assert.deepEqual(plan.argv.slice(0, 4), ['worktree', 'add', '-b', claim.branch_name]);
  assert.equal(plan.argv.at(-1), claim.base_sha);
  assert.equal(plan.expected_initial_head_sha, claim.base_sha);
  assert.equal(plan.automatic_retry_allowed, false);
  assert.equal(plan.authority_effect, false);
  assert.throws(
    () => planWorkspaceMaterialization(binding, { branch_exists: true }),
    /workspace_branch_preexists_requires_rehydrate/,
  );
});

test('ambiguous materialization freezes without blind retry', () => {
  const binding = reservation();
  const frozen = recordWorkspaceMaterializationReadback(binding, { effect_state: 'AMBIGUOUS' });
  assert.equal(frozen.state, 'FROZEN');
  assert.equal(frozen.ambiguity_code, 'MATERIALIZATION_EFFECT_AMBIGUOUS');
  assert.equal(frozen.automatic_retry_allowed, false);
  assert.throws(() => planWorkspaceRetirement(frozen), /workspace_retire_state_invalid/);
});

test('proven materialization still freezes on initial-head or realpath drift', () => {
  const binding = reservation();
  const wrongHead = recordWorkspaceMaterializationReadback(binding, {
    effect_state: 'PROVEN',
    initial_head_sha: '1111111111111111111111111111111111111111',
    worktree_realpath: binding.worktree_path,
  });
  assert.equal(wrongHead.state, 'FROZEN');
  assert.equal(wrongHead.ambiguity_code, 'INITIAL_HEAD_MISMATCH');

  const wrongPath = recordWorkspaceMaterializationReadback(binding, {
    effect_state: 'PROVEN',
    initial_head_sha: claim.base_sha,
    worktree_realpath: '/outside/worktree',
  });
  assert.equal(wrongPath.state, 'FROZEN');
  assert.equal(wrongPath.ambiguity_code, 'WORKTREE_REALPATH_MISMATCH');
});

test('exact readback activates READY while cleanup remains referenced/dirty/ambiguity fenced', () => {
  const binding = reservation();
  const ready = recordWorkspaceMaterializationReadback(binding, {
    effect_state: 'PROVEN',
    initial_head_sha: claim.base_sha,
    worktree_realpath: binding.worktree_path,
  });
  assert.equal(ready.state, 'READY');
  assert.equal(ready.initial_head_sha, claim.base_sha);
  assert.equal(ready.authority_effect, false);

  assert.throws(
    () => planWorkspaceRetirement(ready, { durable_reference_count: 1 }),
    /workspace_cleanup_referenced/,
  );
  assert.throws(
    () => planWorkspaceRetirement(ready, { dirty: true }),
    /workspace_cleanup_dirty/,
  );
  assert.throws(
    () => planWorkspaceRetirement(ready, { branch_ambiguous: true }),
    /workspace_cleanup_ambiguous/,
  );

  const plan = planWorkspaceRetirement(ready);
  assert.equal(plan.executable, 'git');
  assert.equal(plan.shell, false);
  assert.equal(plan.delete_branch, false);
  assert.deepEqual(plan.argv.slice(0, 2), ['worktree', 'remove']);
  assert.equal(plan.argv.at(-1), ready.worktree_path);
  assert.equal(plan.automatic_retry_allowed, false);
});

test('explicit freeze is terminal for mutable continuation until separately resolved', () => {
  const ready = recordWorkspaceMaterializationReadback(reservation(), {
    effect_state: 'PROVEN',
    initial_head_sha: claim.base_sha,
    worktree_realpath: reservation().worktree_path,
  });
  const frozen = freezeWorkspace(ready, 'LEASE_LOST_AFTER_EFFECT');
  assert.equal(frozen.state, 'FROZEN');
  assert.equal(frozen.ambiguity_code, 'LEASE_LOST_AFTER_EFFECT');
  assert.equal(frozen.automatic_retry_allowed, false);
});
